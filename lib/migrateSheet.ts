// lib/migrateSheet.ts — ย้ายข้อมูลจากระบบเดิม (Google Sheet / ไฟล์ .xlsx ที่ดาวน์โหลดจาก Sheet) → MySQL (CLAUDE.md §8)
// ใช้ร่วมกันระหว่าง scripts/import-from-sheet.ts และปุ่ม "ย้ายข้อมูลจากระบบเดิม" ในเว็บ (POST /api/migrate)
//
// - อ่าน DB_Patients / DB_Contacts / DB_Visits / DB_Log, แม็ปตามหัวคอลัมน์ภาษาไทย (ไม่ใช่ตำแหน่ง)
// - คง id เดิม, upsert ตาม id → รันซ้ำได้ (รอบสุดท้ายก่อน cutover รันทับได้เลย)
// - created_by = NULL + audit "migrate" เก็บ แก้ไขโดย/เมื่อ เดิม; ไม่ import DB_Users (PIN); ไม่แตะแท็บ ปีงบ 25xx
// - ทำทั้งหมดใน transaction เดียว — dry = ROLLBACK (ตัวเลขตรงกับตอนบันทึกจริง)
import type mysql from "mysql2/promise";
import { tbDb } from "./db.ts";
import { readWorkbook } from "./excel.ts";
import { SYSTEM_ACTOR, type Actor } from "./repo/common.ts";
import { importRecords, type ImportReport } from "./repo/importer.ts";
import { getSheets, readTab, spreadsheetId, toRecords } from "./sheets.ts";
import { toIso } from "./tb/dates.ts";

export const MIGRATE_TABS = { patient: "DB_Patients", contact: "DB_Contacts", visit: "DB_Visits", log: "DB_Log" } as const;
export type Tabs = Record<string, Record<string, unknown>[]>;

export async function tabsFromXlsx(buf: ArrayBuffer): Promise<Tabs> {
  const sheets = await readWorkbook(buf);
  const out: Tabs = {};
  for (const tab of Object.values(MIGRATE_TABS)) out[tab] = sheets.find((s) => s.name === tab)?.records ?? [];
  return out;
}

/** อ่านจาก Google Sheet ตรง (service account, สิทธิ์อ่านอย่างเดียว) — แท็บที่อ่านไม่ได้แจ้งใน warnings */
export async function tabsFromSheet(): Promise<{ tabs: Tabs; warnings: string[] }> {
  const sheets = getSheets(true);
  const id = spreadsheetId();
  const tabs: Tabs = {};
  const warnings: string[] = [];
  for (const tab of Object.values(MIGRATE_TABS)) {
    try {
      tabs[tab] = toRecords(await readTab(sheets, id, tab));
    } catch (err) {
      warnings.push(`อ่านแท็บ ${tab} ไม่ได้: ${(err as Error).message}`);
      tabs[tab] = [];
    }
  }
  return { tabs, warnings };
}

/** DB_Log เดิม → tb_audit_log (เวลาเดิม) — จำเวลาล่าสุดที่นำเข้าแล้วใน tb_settings กันซ้ำเมื่อรันซ้ำ */
async function importLog(conn: mysql.PoolConnection, rows: Record<string, unknown>[]): Promise<{ read: number; added: number }> {
  const [cur] = await conn.query<mysql.RowDataPacket[]>("SELECT v FROM tb_settings WHERE k = 'migrate.log_until'");
  const until = cur[0]?.v ?? "";
  let max = until;
  let added = 0;
  for (const r of rows) {
    const t = r["เวลา"];
    const at = t instanceof Date ? t.toISOString().slice(0, 19).replace("T", " ") : String(t ?? "").trim().slice(0, 19);
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(at) || !toIso(at)) continue;
    if (at <= until) continue;
    const id = String(r["รหัส"] ?? "").trim();
    const entity = id.startsWith("P") ? "patient" : id.startsWith("C") ? "contact" : id.startsWith("V") ? "visit" : "system";
    await conn.execute(
      "INSERT INTO tb_audit_log (at, user_id, action, entity, entity_id, changes) VALUES (?, NULL, ?, ?, ?, ?)",
      [at.replace("T", " "), `legacy:${String(r["การกระทำ"] ?? "").slice(0, 13)}`, entity, id.slice(0, 16) || null,
        JSON.stringify({ "ผู้ใช้ (ระบบเดิม)": [null, r["ผู้ใช้"] ?? null], "รายละเอียด": [null, String(r["รายละเอียด"] ?? "").slice(0, 500)] })],
    );
    added++;
    if (at > max) max = at;
  }
  if (max !== until) {
    await conn.execute(
      "INSERT INTO tb_settings (k, v) VALUES ('migrate.log_until', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
      [max],
    );
  }
  return { read: rows.length, added };
}

export interface MigrationResult {
  dry: boolean;
  reports: { tab: string; report: ImportReport }[];
  log: { read: number; added: number };
  /** จำนวนใน MySQL หลังนำเข้า เทียบกับจำนวนแถวในแหล่ง (ต้องเท่ากันตอน cutover) */
  inDb: { patients: number; contacts: number; visits: number };
  inSource: { patients: number; contacts: number; visits: number };
}

/** actor = ผู้สั่งย้าย (เป็นผู้บันทึกของ DB_Visits ซึ่ง created_by ห้ามว่าง) */
export async function runMigration(tabs: Tabs, actor: Actor, dry: boolean): Promise<MigrationResult> {
  const conn = await tbDb.getConnection();
  try {
    await conn.beginTransaction();
    const reports: MigrationResult["reports"] = [];
    // ผู้ป่วยก่อน (ผู้สัมผัสอ้างถึง), แล้วผู้สัมผัส, แล้ว visit (อ้างถึงทั้งสอง)
    for (const kind of ["patient", "contact", "visit"] as const) {
      const rows = tabs[MIGRATE_TABS[kind]] ?? [];
      const report = await importRecords(conn, kind, rows, kind === "visit" ? actor : { ...SYSTEM_ACTOR, ip: null }, "migrate");
      reports.push({ tab: MIGRATE_TABS[kind], report });
    }
    const log = await importLog(conn, tabs[MIGRATE_TABS.log] ?? []);
    const [[n]] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM tb_patients WHERE deleted_at IS NULL) p, (SELECT COUNT(*) FROM tb_contacts WHERE deleted_at IS NULL) c, (SELECT COUNT(*) FROM tb_visits WHERE deleted_at IS NULL) v",
    );
    if (dry) {
      await conn.rollback();
    } else {
      await conn.execute(
        "INSERT INTO tb_audit_log (user_id, action, entity, changes, ip) VALUES (?, 'migrate', 'system', ?, ?)",
        [actor.id, JSON.stringify(Object.fromEntries(reports.map(({ tab, report: r }) => [tab, [null, `เพิ่ม ${r.added} อัปเดต ${r.updated} ปฏิเสธ ${r.skipped.length}`]]))), actor.ip ?? null],
      );
      await conn.commit();
    }
    return {
      dry,
      reports,
      log,
      inDb: { patients: Number(n.p), contacts: Number(n.c), visits: Number(n.v) },
      inSource: {
        patients: (tabs[MIGRATE_TABS.patient] ?? []).length,
        contacts: (tabs[MIGRATE_TABS.contact] ?? []).length,
        visits: (tabs[MIGRATE_TABS.visit] ?? []).length,
      },
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
