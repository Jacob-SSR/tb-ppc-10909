// scripts/import-from-sheet.ts — ย้ายข้อมูลจาก Google Sheet เดิม → MySQL ครั้งแรก (CLAUDE.md §8)
//
//   docker compose run --rm cli node scripts/import-from-sheet.ts --dry          ดูรายงานก่อน (ไม่บันทึก)
//   docker compose run --rm cli node scripts/import-from-sheet.ts                 บันทึกจริง
//   ... --xlsx /path/to/Tuberculosis.xlsx                                         อ่านจากไฟล์ที่ดาวน์โหลดจาก Sheet แทน
//   ... --as <username>                                                           ผู้นำเข้าของ DB_Visits (created_by ห้ามว่าง)
//
// - อ่าน DB_Patients / DB_Contacts / DB_Visits / DB_Log, แม็ปตามหัวคอลัมน์ภาษาไทย (ไม่ใช่ตำแหน่ง)
// - คง id เดิม, upsert ตาม id → รันซ้ำได้ (รอบสุดท้ายก่อน cutover รันทับได้เลย)
// - created_by = NULL + audit "migrate" เก็บ แก้ไขโดย/เมื่อ เดิม; ไม่ import DB_Users (PIN); ไม่แตะแท็บ ปีงบ 25xx
// - ทำทั้งหมดใน transaction เดียว — ผิดพลาดระดับระบบ = rollback ทั้งหมด, แถวที่ไม่ผ่านถูกข้ามพร้อมเหตุผล
import type mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { closePools, tbDb } from "../lib/db.ts";
import { readWorkbook } from "../lib/excel.ts";
import { importRecords, type ImportReport } from "../lib/repo/importer.ts";
import { SYSTEM_ACTOR, type Actor } from "../lib/repo/common.ts";
import { getSheets, readTab, spreadsheetId, toRecords } from "../lib/sheets.ts";
import { toIso } from "../lib/tb/dates.ts";

const TABS = { patient: "DB_Patients", contact: "DB_Contacts", visit: "DB_Visits", log: "DB_Log" } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadTabs(): Promise<Record<string, Record<string, unknown>[]>> {
  const xlsx = arg("--xlsx");
  const out: Record<string, Record<string, unknown>[]> = {};
  if (xlsx) {
    const buf = await readFile(xlsx);
    const sheets = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    for (const tab of Object.values(TABS)) out[tab] = sheets.find((s) => s.name === tab)?.records ?? [];
    return out;
  }
  const sheets = getSheets(true);
  const id = spreadsheetId();
  for (const tab of Object.values(TABS)) {
    try {
      out[tab] = toRecords(await readTab(sheets, id, tab));
    } catch (err) {
      console.warn(`⚠ อ่านแท็บ ${tab} ไม่ได้: ${(err as Error).message}`);
      out[tab] = [];
    }
  }
  return out;
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

function print(r: ImportReport, tab: string) {
  console.log(`\n${tab}: อ่าน ${r.read} · เพิ่ม ${r.added} · อัปเดต ${r.updated} · ไม่เปลี่ยน ${r.unchanged} · ปฏิเสธ ${r.skipped.length}`);
  if (r.unknownHeaders.length) console.log(`  คอลัมน์ที่ไม่รู้จัก (ข้าม): ${r.unknownHeaders.join(", ")}`);
  for (const s of r.skipped) console.log(`  ✗ แถว ${s.row}: ${s.reason}`);
}

async function main() {
  const dry = process.argv.includes("--dry");
  const asUser = arg("--as");
  let actor: Actor = SYSTEM_ACTOR;
  if (asUser) {
    const [u] = await tbDb.query<mysql.RowDataPacket[]>(
      "SELECT u.id, u.unit_id FROM tb_users u JOIN tb_units un ON un.id = u.unit_id WHERE u.username = ? AND un.role = 'admin'",
      [asUser],
    );
    if (!u[0]) throw new Error(`ไม่พบผู้ดูแลชื่อ ${asUser}`);
    actor = { id: u[0].id, role: "admin", unitId: u[0].unit_id };
  }

  const tabs = await loadTabs();
  console.log(`แหล่งข้อมูล: ${arg("--xlsx") ?? `Google Sheet ${process.env.TB_SPREADSHEET_ID}`}${dry ? "  [DRY RUN — ไม่บันทึก]" : ""}`);

  const conn = await tbDb.getConnection();
  try {
    await conn.beginTransaction();
    const reports: [string, ImportReport][] = [];
    // ผู้ป่วยก่อน (ผู้สัมผัสอ้างถึง), แล้วผู้สัมผัส, แล้ว visit (อ้างถึงทั้งสอง)
    for (const kind of ["patient", "contact", "visit"] as const) {
      const rows = tabs[TABS[kind]];
      // visit ต้องมีผู้บันทึก — ถ้าไม่ระบุ --as ใช้ระบบ (ทุกแถวจะถูกปฏิเสธพร้อมเหตุผล)
      const r = await importRecords(conn, kind, rows, kind === "visit" ? actor : { ...SYSTEM_ACTOR, ip: null }, "migrate");
      reports.push([TABS[kind], r]);
    }
    const log = await importLog(conn, tabs[TABS.log]);

    for (const [tab, r] of reports) print(r, tab);
    console.log(`\n${TABS.log}: อ่าน ${log.read} · นำเข้าเป็นประวัติ ${log.added} (รายการที่นำเข้าแล้วในรอบก่อนถูกข้าม)`);
    console.log("ไม่นำเข้า: DB_Users (PIN), DB_Settings (ตั้งเป้าใหม่ในหน้า ตั้งเป้าหมาย), แท็บ ปีงบ 25xx (เก็บเป็น archive)");

    const [[n]] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM tb_patients WHERE deleted_at IS NULL) p, (SELECT COUNT(*) FROM tb_contacts WHERE deleted_at IS NULL) c, (SELECT COUNT(*) FROM tb_visits WHERE deleted_at IS NULL) v",
    );
    console.log(`\nใน MySQL หลังนำเข้า: ผู้ป่วย ${n.p} · ผู้สัมผัส ${n.c} · บันทึกรายครั้ง ${n.v}`);
    console.log(`เทียบ Sheet: ผู้ป่วย ${tabs[TABS.patient].length} · ผู้สัมผัส ${tabs[TABS.contact].length} · บันทึกรายครั้ง ${tabs[TABS.visit].length}`);

    if (dry) {
      await conn.rollback();
      console.log("\nDRY RUN — ยกเลิกทั้งหมด ไม่มีอะไรถูกบันทึก");
    } else {
      await conn.execute(
        "INSERT INTO tb_audit_log (user_id, action, entity, changes) VALUES (?, 'migrate', 'system', ?)",
        [actor.id, JSON.stringify(Object.fromEntries(reports.map(([t, r]) => [t, [null, `เพิ่ม ${r.added} อัปเดต ${r.updated} ปฏิเสธ ${r.skipped.length}`]])))],
      );
      await conn.commit();
      console.log("\nบันทึกแล้ว — outbox จะเขียนกลับไป Sheet เมื่อเปิด worker (Phase 6)");
    }
    if (reports.some(([, r]) => r.skipped.length)) process.exitCode = 2;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .catch((err) => {
    console.error("[import] ล้มเหลว:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
