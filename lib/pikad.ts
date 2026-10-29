// lib/pikad.ts — ประชากรทั้งอำเภอจากชีตใหม่ (อ่านอย่างเดียว)
// แท็บแรก A1:R อ่านตามหัวคอลัมน์; citizenship → nationality, death: Y = ตาย / N = มีชีวิต
// ใช้ service account เดียวกับ Sheet mirror (ต้องแชร์ไฟล์ให้อีเมลนี้อย่างน้อย "ผู้มีสิทธิ์อ่าน")
// มีเลขบัตรประชาชน → ใช้ฝั่ง server เท่านั้น ส่งให้เฉพาะ admin (§3), cache ใน Redis เครื่องเดียวกัน 30 นาที
import { redis } from "./redis.ts";
import { getSheets } from "./sheets.ts";
import { ageOn, todayBangkok, toIso } from "./tb/dates.ts";
import { type LatLng, nameKey, normCid, pointOf } from "./tb/geo.ts";
import codes from "./residentCodes.json" with { type: "json" };

export interface Resident extends LatLng {
  name: string;
  cid: string | null;
  birthday: string | null; // ค.ศ. YYYY-MM-DD
  mapLink: string | null;
  sex: string | null;
  nationality: string | null;
  deceased: boolean | null;
  address: string | null;
  phone: string | null;
  age: number | null;
}

const TTL = 1800;

export function pikadConfigured(): boolean {
  return !!(process.env.PIKAD_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

/** แถวใน Sheet → รายชื่อที่มีพิกัด (ข้ามแถวพิกัดผิด) */
export function parseResidents(rows: unknown[][]): Resident[] {
  const [header, ...data] = rows;
  const columns = (header ?? []).map((v) => String(v ?? "").trim().replace(/^\uFEFF/, ""));
  for (const key of ["cid", "pname", "fname", "lname", "latitude", "longitude", "sex", "citizenship", "death"]) {
    if (!columns.includes(key)) throw new Error(`ชีตประชากรไม่มีคอลัมน์ ${key}`);
  }
  const text = (r: unknown[], key: string) => {
    const value = String(r[columns.indexOf(key)] ?? "").trim();
    return value === "NULL" ? "" : value;
  };
  const label = (table: Record<string, string>, value: string) => {
    if (!value) return null;
    const key = /^\d+$/.test(value) ? value.padStart(2, "0") : value;
    return table[value] ?? table[key] ?? `ไม่ทราบรหัส (${value})`;
  };
  const out: Resident[] = [];
  for (const r of data) {
    const p = pointOf(text(r, "latitude"), text(r, "longitude"));
    const name = `${text(r, "pname")}${text(r, "fname")} ${text(r, "lname")}`.trim();
    if (!p || !name) continue;
    const cid = normCid(text(r, "cid"));
    const age = text(r, "age_y");
    const death = text(r, "death").toUpperCase();
    out.push({
      ...p, name, cid: cid.length === 13 ? cid : null, birthday: toIso(text(r, "birthdate")),
      mapLink: `https://www.google.com/maps?q=${p.lat},${p.lng}`,
      sex: label(codes.sex, text(r, "sex")), nationality: label(codes.nationality, text(r, "citizenship")),
      deceased: death === "Y" ? true : death === "N" ? false : null,
      address: text(r, "address") || null, phone: text(r, "home_phone") || null,
      age: age && Number.isInteger(Number(age)) && Number(age) >= 0 && Number(age) <= 150 ? Number(age) : null,
    });
  }
  return out;
}

async function readSheet(): Promise<Resident[]> {
  const sheets = getSheets(true);
  const id = process.env.PIKAD_SPREADSHEET_ID!;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const first = meta.data.sheets?.[0]?.properties?.title;
  if (!first) throw new Error("ไม่พบแท็บในชีตประชากร");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id, range: `'${first.replace(/'/g, "''")}'!A1:R`, valueRenderOption: "FORMATTED_VALUE",
  });
  return parseResidents((res.data.values ?? []) as unknown[][]);
}

export async function loadResidents(fresh = false): Promise<Resident[]> {
  const cacheKey = `tb:population:v2:${process.env.PIKAD_SPREADSHEET_ID}`;
  if (!fresh) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as Resident[];
    } catch { /* Redis ล่ม → อ่าน Sheet ตรง */ }
  }
  const list = await readSheet();
  try {
    await redis.set(cacheKey, JSON.stringify(list), "EX", TTL);
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
  r.birthday ? ageOn(r.birthday, today) : r.age;
