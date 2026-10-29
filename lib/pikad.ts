// lib/pikad.ts — พิกัดบ้านทั้งอำเภอ จาก Sheet ของโปรเจกต์ pikad-phlapphla-chai (อ่านอย่างเดียว)
// แท็บแรก A2:E — A ละติจูด/ลองจิจูด · B ชื่อ-นามสกุล · C เลขบัตร 13 หลัก · D วันเกิด · E ลิงก์พิกัด
// ใช้ service account เดียวกับ Sheet mirror (ต้องแชร์ไฟล์ให้อีเมลนี้อย่างน้อย "ผู้มีสิทธิ์อ่าน")
// มีเลขบัตรประชาชน → ใช้ฝั่ง server เท่านั้น ส่งให้เฉพาะ admin (§3), cache ใน Redis เครื่องเดียวกัน 30 นาที
import { redis } from "./redis.ts";
import { getSheets } from "./sheets.ts";
import { ageOn, todayBangkok, toIso } from "./tb/dates.ts";
import { type LatLng, nameKey, normCid, parseLatLng } from "./tb/geo.ts";

export interface Resident extends LatLng {
  name: string;
  cid: string | null;
  birthday: string | null; // ค.ศ. YYYY-MM-DD
  mapLink: string | null;
}

const CACHE_KEY = "tb:pikad:v1";
const TTL = 1800;

export function pikadConfigured(): boolean {
  return !!(process.env.PIKAD_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

/** แถวใน Sheet → รายชื่อที่มีพิกัด (ข้ามแถวพิกัดผิด) */
export function parseResidents(rows: unknown[][]): Resident[] {
  const out: Resident[] = [];
  for (const r of rows) {
    const p = parseLatLng(r?.[0]);
    const name = String(r?.[1] ?? "").trim();
    if (!p || !name) continue;
    const cid = normCid(r[2]);
    out.push({ ...p, name, cid: cid.length === 13 ? cid : null, birthday: toIso(r[3]), mapLink: String(r[4] ?? "").trim() || null });
  }
  return out;
}

async function readSheet(): Promise<Resident[]> {
  const sheets = getSheets(true);
  const id = process.env.PIKAD_SPREADSHEET_ID!;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const first = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id, range: `'${first.replace(/'/g, "''")}'!A2:E`, valueRenderOption: "FORMATTED_VALUE",
  });
  return parseResidents((res.data.values ?? []) as unknown[][]);
}

export async function loadResidents(fresh = false): Promise<Resident[]> {
  if (!fresh) {
    try {
      const hit = await redis.get(CACHE_KEY);
      if (hit) return JSON.parse(hit) as Resident[];
    } catch { /* Redis ล่ม → อ่าน Sheet ตรง */ }
  }
  const list = await readSheet();
  try {
    await redis.set(CACHE_KEY, JSON.stringify(list), "EX", TTL);
  } catch { /* ไม่ cache ก็ได้ */ }
  return list;
}

/** ดัชนีจับคู่พิกัดผู้ป่วย: เลขบัตรก่อน แล้วค่อยชื่อ (แบบ tb-map ใน ppc-hos) */
export function residentIndex(list: Resident[]) {
  const byCid = new Map<string, Resident>();
  const byName = new Map<string, Resident>();
  for (const r of list) {
    if (r.cid && !byCid.has(r.cid)) byCid.set(r.cid, r);
    const k = nameKey(r.name);
    if (k && !byName.has(k)) byName.set(k, r);
  }
  return {
    find(cid: string | null | undefined, name: string): { r: Resident; by: "cid" | "name" } | null {
      const c = normCid(cid);
      const hit = c.length === 13 ? byCid.get(c) : undefined;
      if (hit) return { r: hit, by: "cid" };
      const n = byName.get(nameKey(name));
      return n ? { r: n, by: "name" } : null;
    },
  };
}

export const residentAge = (r: Resident, today = todayBangkok()): number | null =>
  r.birthday ? ageOn(r.birthday, today) : null;
