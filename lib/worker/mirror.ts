// lib/worker/mirror.ts — MySQL → Google Sheet ทางเดียว "ช้าได้แต่ชัวร์" (CLAUDE.md §7)
//
//   processOutbox: อ่านคิวที่ถึงเวลา → ดึงแถว "ล่าสุด" จาก MySQL (ไม่ใช้ payload ตอน enqueue)
//                  → upsert ตาม id (มี = ทับแถว, ไม่มี = ต่อท้าย) ด้วย values.batchUpdate, ถูกลบ = ลบแถว
//                  → สำเร็จเท่านั้นจึง set sent_at; ล้มเหลว → attempts++ และ next_try_at แบบ backoff
//   rebuild:       เขียนทุกแท็บใหม่ทั้งหมดจาก MySQL (ตาข่ายกันหลุด ทุกคืน 02:00)
//   ตัวกัน:        ถ้าใน Sheet มีแถวที่ไม่มีใน MySQL (ยังไม่ได้ import / มีคนพิมพ์เพิ่มเอง) จะไม่เขียนอะไรเลย
//                  — rebuild ล้างแท็บแล้วเขียนจาก MySQL ใหม่ ถ้าปล่อยไปข้อมูลจริงใน Sheet จะหาย
//
// แท็บและหัวคอลัมน์เดิม (DB_Patients/DB_Contacts/DB_Visits) + แท็บใหม่ DB_Followups
// ppc-hos (tb-dashboard / tb-map) อ่านแท็บที่ชื่อมี "patient" จึงใช้ต่อได้โดยไม่ต้องแก้
import type { Queryable } from "../audit.ts";
import { redis } from "../redis.ts";
import type { Row } from "../repo/common.ts";
import { COLUMNS, legacyFollowupExtra, toSheetRow, type SheetKind } from "../tb/sheetRows.ts";
import { PROTECT_DESC, quote, type SheetApi } from "./sheetApi.ts";

export const TABS: Record<SheetKind, string> = {
  patient: "DB_Patients",
  contact: "DB_Contacts",
  visit: "DB_Visits",
  followup: "DB_Followups",
};
const ORDER: SheetKind[] = ["patient", "contact", "visit", "followup"];
const BATCH = 200;
const TABLE: Partial<Record<SheetKind, string>> = { patient: "tb_patients", contact: "tb_contacts", visit: "tb_visits" };
const SAFE_KEY = "tb:sheet:safe";

/** Sheet ยังมีข้อมูลที่ไม่ได้อยู่ใน MySQL — ห้ามเขียนทับ */
export class MirrorBlocked extends Error {
  foreign: Record<string, number>;
  constructor(foreign: Record<string, number>) {
    super(
      `Google Sheet มีแถวที่ยังไม่อยู่ในฐานข้อมูล (${Object.entries(foreign).map(([t, n]) => `${t} ${n} แถว`).join(", ")}) ` +
      "— หยุดเขียน Sheet ไว้ก่อนเพื่อไม่ให้ข้อมูลหาย: นำเข้าด้วย scripts/import-from-sheet.ts หรือลบแถวนั้นออกจาก Sheet",
    );
    this.foreign = foreign;
  }
}

export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const lastCol = (kind: SheetKind) => colLetter(COLUMNS[kind].length);
/** กุญแจของแถว: id (DB_Followups ใช้ รหัสผู้ป่วย|ช่อง เพราะคอลัมน์ A ไม่ซ้ำไม่ได้) */
const keyOf = (kind: SheetKind, r: string[]) => (kind === "followup" ? `${r[0]}|${r[1]}` : r[0]);

interface Built {
  upserts: { key: string; values: string[] }[];
  deletes: string[];
}

export class Mirror {
  private api: SheetApi;
  private db: Queryable;
  constructor(api: SheetApi, db: Queryable) {
    this.api = api;
    this.db = db;
  }

  private mapKey = (kind: SheetKind) => `tb:sheet:rows:${TABS[kind]}`;

  // ── แท็บ + หัวคอลัมน์ + ป้องกันแก้มือ ─────────────────────────────────────────

  /** protect = ล็อกแท็บ DB_* ให้แก้ได้เฉพาะ service account (SHEET_PROTECT=1); false = ถอดล็อกที่ระบบเคยใส่ */
  async ensureTabs(serviceAccount?: string, protect = false): Promise<void> {
    let tabs = await this.api.tabs();
    const missing = ORDER.filter((k) => !tabs.some((t) => t.title === TABS[k]));
    if (missing.length) {
      await this.api.batch(missing.map((k) => ({ addSheet: { properties: { title: TABS[k] } } })));
      tabs = await this.api.tabs();
    }
    const headers = await Promise.all(ORDER.map((k) => this.api.get(`${quote(TABS[k])}!A1:${lastCol(k)}1`)));
    const fix = ORDER.filter((k, i) => (headers[i][0] ?? []).join("|") !== COLUMNS[k].map(([h]) => h).join("|"));
    await this.api.write(fix.map((k) => ({ range: `${quote(TABS[k])}!A1:${lastCol(k)}1`, values: [COLUMNS[k].map(([h]) => h)] })));

    const ours = ORDER.map((k) => tabs.find((t) => t.title === TABS[k])!);
    if (!protect) {
      await this.api.batch(ours.flatMap((t) => t.ourProtections.map((protectedRangeId) => ({ deleteProtectedRange: { protectedRangeId } }))));
      return;
    }
    // ล็อกให้แก้ได้เฉพาะ service account (เปิดด้วย SHEET_PROTECT=1)
    if (serviceAccount) {
      const req = ours
        .filter((t) => !t.protectedBy.includes(serviceAccount))
        .map((t) => ({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId: t.sheetId },
              description: PROTECT_DESC,
              editors: { users: [serviceAccount] },
            },
          },
        }));
      await this.api.batch(req);
    }
  }

  // ── ตัวกันข้อมูลใน Sheet หาย ───────────────────────────────────────────────

  /** จำนวนแถวต่อแท็บที่ id ไม่มีใน MySQL (รวมที่ลบแล้ว) หรือไม่มี id แต่มีข้อมูล */
  async foreignRows(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const kind of ["patient", "contact", "visit"] as const) {
      const vals = await this.api.get(`${quote(TABS[kind])}!A2:D`);
      const rows = vals.filter((r) => r.some((v) => String(v ?? "").trim()));
      const ids = [...new Set(rows.map((r) => String(r[0] ?? "").trim()).filter(Boolean))];
      const known = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const [found] = await this.db.query<Row[]>(`SELECT id FROM ${TABLE[kind]} WHERE id IN (${part.map(() => "?").join(",")})`, part);
        for (const f of found) known.add(String(f.id));
      }
      const n = rows.filter((r) => !known.has(String(r[0] ?? "").trim())).length;
      if (n) out[TABS[kind]] = n;
    }
    return out;
  }

  /** โยน MirrorBlocked ถ้าเขียนแล้วข้อมูลใน Sheet จะหาย — ผลที่ปลอดภัยจำไว้ 10 นาที (ลดการอ่าน Sheet) */
  async assertSafe(useCache = true): Promise<void> {
    if (useCache) {
      try { if (await redis.get(SAFE_KEY)) return; } catch { /* อ่านจาก Sheet */ }
    }
    const foreign = await this.foreignRows();
    if (Object.keys(foreign).length) {
      try { await redis.del(SAFE_KEY); } catch { /* ignore */ }
      throw new MirrorBlocked(foreign);
    }
    try { await redis.set(SAFE_KEY, "1", "EX", 600); } catch { /* ignore */ }
  }

  // ── id → เลขแถว (cache ใน Redis, ไม่มีให้อ่านคอลัมน์ A ใหม่) ───────────────────

  async rowMap(kind: SheetKind, fresh = false): Promise<Map<string, number>> {
    if (!fresh) {
      try {
        const h = await redis.hgetall(this.mapKey(kind));
        if (h && h.__loaded) {
          delete h.__loaded;
          return new Map(Object.entries(h).map(([k, v]) => [k, Number(v)]));
        }
      } catch { /* Redis ล่ม → อ่านจาก Sheet */ }
    }
    const tab = TABS[kind];
    const vals = await this.api.get(`${quote(tab)}!A2:${kind === "followup" ? "B" : "A"}`);
    const m = new Map<string, number>();
    vals.forEach((r, i) => r[0] && m.set(keyOf(kind, r), i + 2));
    await this.saveMap(kind, m);
    return m;
  }

  private async saveMap(kind: SheetKind, m: Map<string, number>) {
    try {
      const k = this.mapKey(kind);
      const multi = redis.multi().del(k).hset(k, "__loaded", "1");
      if (m.size) multi.hset(k, Object.fromEntries([...m].map(([a, b]) => [a, String(b)])));
      await multi.expire(k, 26 * 3600).exec();
    } catch { /* ไม่ cache ก็ได้ */ }
  }

  async invalidate(kind: SheetKind) {
    try { await redis.del(this.mapKey(kind)); } catch { /* ignore */ }
  }

  // ── อ่านแถวล่าสุดจาก MySQL ────────────────────────────────────────────────────

  private async units(): Promise<(id: unknown) => string> {
    const [u] = await this.db.query<Row[]>("SELECT id, name FROM tb_units");
    const m = new Map(u.map((r) => [Number(r.id), String(r.name)]));
    return (id) => m.get(Number(id)) ?? "";
  }

  /** ids = null → ทุกแถว (rebuild) */
  async build(kind: SheetKind, ids: string[] | null): Promise<Built> {
    const unitName = await this.units();
    const where = (col: string) => (ids ? `${col} IN (${ids.map(() => "?").join(",")})` : "1=1");
    const args = ids ?? [];
    const out: Built = { upserts: [], deletes: [] };
    const updater = "COALESCE(u.display_name, 'ย้ายจากระบบเดิม') AS updated_by_name";

    if (kind === "patient") {
      const [rows] = await this.db.query<Row[]>(
        `SELECT p.*, ${updater} FROM tb_patients p LEFT JOIN tb_users u ON u.id = p.updated_by WHERE ${where("p.id")} ORDER BY p.fy, p.seq, p.start_date`, args);
      const [fus] = await this.db.query<Row[]>(
        `SELECT patient_id, slot, result FROM tb_treatment_followups WHERE deleted_at IS NULL AND slot <= 5 AND ${where("patient_id")}`, args);
      for (const p of rows) {
        if (p.deleted_at) { out.deletes.push(p.id as string); continue; }
        const extra = { ...legacyFollowupExtra(fus.filter((f) => f.patient_id === p.id).map((f) => ({ slot: Number(f.slot), result: f.result as string | null }))), updated_by_name: p.updated_by_name };
        out.upserts.push({ key: p.id as string, values: toSheetRow("patient", p, { dateFormat: "iso", unitName, extra }) });
      }
    } else if (kind === "contact") {
      const [rows] = await this.db.query<Row[]>(
        `SELECT c.*, p.fy AS index_fy, p.hn AS index_hn, ${updater}
           FROM tb_contacts c JOIN tb_patients p ON p.id = c.patient_id LEFT JOIN tb_users u ON u.id = c.updated_by
          WHERE ${where("c.id")} ORDER BY c.created_at`, args);
      for (const c of rows) {
        if (c.deleted_at) { out.deletes.push(c.id as string); continue; }
        out.upserts.push({ key: c.id as string, values: toSheetRow("contact", c, { dateFormat: "iso", unitName, extra: { fy: c.index_fy, index_hn: c.index_hn, updated_by_name: c.updated_by_name } }) });
      }
    } else if (kind === "visit") {
      const [rows] = await this.db.query<Row[]>(
        `SELECT v.*, COALESCE(u.display_name, '') AS updated_by_name FROM tb_visits v LEFT JOIN tb_users u ON u.id = COALESCE(v.updated_by, v.created_by)
          WHERE ${where("v.id")} ORDER BY v.visit_date, v.created_at`, args);
      for (const v of rows) {
        if (v.deleted_at) { out.deletes.push(v.id as string); continue; }
        out.upserts.push({ key: v.id as string, values: toSheetRow("visit", v, { dateFormat: "iso", extra: { updated_by_name: v.updated_by_name } }) });
      }
    } else {
      // followup: entity_id = รหัสผู้ป่วย → เขียนทุกช่องของผู้ป่วยรายนั้น, ช่องที่ถูกลบ/ผู้ป่วยถูกลบ = ลบแถว
      const [rows] = await this.db.query<Row[]>(
        `SELECT f.*, p.deleted_at AS patient_deleted FROM tb_treatment_followups f JOIN tb_patients p ON p.id = f.patient_id
          WHERE ${where("f.patient_id")} ORDER BY f.patient_id, f.slot`, args);
      for (const f of rows) {
        const key = `${f.patient_id}|${f.slot}`;
        if (f.deleted_at || f.patient_deleted) out.deletes.push(key);
        else out.upserts.push({ key, values: toSheetRow("followup", f, { dateFormat: "iso" }) });
      }
    }
    return out;
  }

  // ── เขียนลง Sheet ─────────────────────────────────────────────────────────────

  private async ensureRows(kind: SheetKind, needLastRow: number) {
    const tab = (await this.api.tabs()).find((t) => t.title === TABS[kind])!;
    if (tab.rowCount < needLastRow) {
      await this.api.batch([{ appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: needLastRow - tab.rowCount + 100 } }]);
    }
  }

  /** upsert + ลบ ตามกุญแจ (ทับแถวเดิม / ต่อท้าย / ลบแถว) */
  async sync(kind: SheetKind, ids: string[]): Promise<void> {
    const built = await this.build(kind, ids);
    const map = await this.rowMap(kind);
    const tab = quote(TABS[kind]);
    let last = Math.max(1, ...map.values());
    const writes: { range: string; values: string[][] }[] = [];
    for (const u of built.upserts) {
      let n = map.get(u.key);
      if (!n) {
        n = ++last;
        map.set(u.key, n);
      }
      writes.push({ range: `${tab}!A${n}:${lastCol(kind)}${n}`, values: [u.values] });
    }
    if (last > 1) await this.ensureRows(kind, last);
    await this.api.write(writes);
    await this.saveMap(kind, map);

    // ลบจากล่างขึ้นบน เลขแถวที่เหลือจะได้ไม่เลื่อนระหว่างลบ
    const rows = built.deletes.map((k) => map.get(k)).filter((n): n is number => !!n).sort((a, b) => b - a);
    if (rows.length) {
      const sheetId = (await this.api.tabs()).find((t) => t.title === TABS[kind])!.sheetId;
      await this.api.batch(rows.map((n) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: n - 1, endIndex: n } } })));
      await this.invalidate(kind); // เลขแถวเลื่อนแล้ว — อ่านใหม่รอบหน้า
    }
  }

  /** ทำคิวที่ถึงเวลา — คืนจำนวนที่ส่งสำเร็จ/ล้มเหลว */
  async processOutbox(limit = BATCH): Promise<{ sent: number; failed: number; blocked?: string }> {
    const [rows] = await this.db.query<Row[]>(
      "SELECT id, entity, entity_id FROM tb_sheet_outbox WHERE sent_at IS NULL AND next_try_at <= NOW() ORDER BY id LIMIT ?",
      [limit],
    );
    if (!rows.length) return { sent: 0, failed: 0 };
    try {
      await this.assertSafe();
    } catch (err) {
      if (err instanceof MirrorBlocked) return { sent: 0, failed: 0, blocked: err.message }; // คิวคงไว้ ส่งหลัง import
      throw err;
    }
    let sent = 0;
    let failed = 0;
    for (const kind of ORDER) {
      const items = rows.filter((r) => r.entity === kind);
      if (!items.length) continue;
      const outboxIds = items.map((r) => Number(r.id));
      try {
        await this.sync(kind, [...new Set(items.map((r) => String(r.entity_id)))]);
        await this.db.query(`UPDATE tb_sheet_outbox SET sent_at = NOW(), last_error = NULL WHERE id IN (${outboxIds.map(() => "?").join(",")})`, outboxIds);
        sent += outboxIds.length;
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
        await this.db.query(
          `UPDATE tb_sheet_outbox SET attempts = attempts + 1, last_error = ?,
                  next_try_at = NOW() + INTERVAL LEAST(POW(2, attempts), 60) MINUTE
            WHERE id IN (${outboxIds.map(() => "?").join(",")})`,
          [msg, ...outboxIds],
        );
        await this.invalidate(kind);
        failed += outboxIds.length;
      }
    }
    return { sent, failed };
  }

  /** เขียนทุกแท็บใหม่ทั้งหมดจาก MySQL แล้วปิดคิวที่ค้างก่อนเริ่ม (แถวล่าสุดอยู่ใน Sheet แล้ว) */
  async rebuild(): Promise<Record<string, number>> {
    await this.assertSafe(false);
    const [[snap]] = await this.db.query<Row[]>("SELECT COALESCE(MAX(id), 0) AS max FROM tb_sheet_outbox");
    const counts: Record<string, number> = {};
    for (const kind of ORDER) {
      const built = await this.build(kind, null);
      const tab = quote(TABS[kind]);
      const n = built.upserts.length;
      await this.ensureRows(kind, n + 1);
      await this.api.clear(`${tab}!A2:${lastCol(kind)}`);
      await this.api.write(n ? [{ range: `${tab}!A2:${lastCol(kind)}${n + 1}`, values: built.upserts.map((u) => u.values) }] : []);
      await this.saveMap(kind, new Map(built.upserts.map((u, i) => [u.key, i + 2])));
      counts[TABS[kind]] = n;
    }
    await this.db.query("UPDATE tb_sheet_outbox SET sent_at = NOW() WHERE sent_at IS NULL AND id <= ?", [snap.max]);
    return counts;
  }
}
