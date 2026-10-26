// lib/hosxp.ts — ดึงข้อมูลผู้ป่วยจาก HOSxP ตาม HN/CID (อ่านอย่างเดียว, cache Redis)
// ใช้เติมชื่อ/เลขบัตร/เพศ/อายุ/สิทธิ์/ที่อยู่/เบอร์โทร ในฟอร์มผู้ป่วยและผู้สัมผัส แล้ว "เก็บสำเนา" ไว้ใน ppc_tb (§2)
// ตาราง/คอลัมน์อ้างอิงจาก SQL ที่ใช้งานจริงใน ppc-hos (patient, pttype, thaiaddress)
import type mysql from "mysql2/promise";
import { hosxpDb } from "./db.ts";
import { redis } from "./redis.ts";
import { ageOn, todayBangkok } from "./tb/dates.ts";

export interface HosxpPatient {
  hn: string;
  cid: string | null;
  name: string;
  sex: "ชาย" | "หญิง" | null;
  birthday: string | null;
  age: number | null;
  rights: string | null;
  address: string | null; // บ้านเลขที่ หมู่ ถนน
  area: string | null; // ตำบล
  amphoe: string | null;
  province: string | null;
  /** ที่อยู่ตามทะเบียนเต็ม: บ้านเลขที่ หมู่ ถนน ต. อ. จ. */
  fullAddress: string | null;
  phone: string | null;
  deceased: boolean;
}

const TTL = 60 * 60; // 1 ชม.

export function hosxpConfigured(): boolean {
  return !!(process.env.HOSXP_DB_HOST && process.env.HOSXP_DB_USER && process.env.HOSXP_DB_NAME);
}

/** ตัด prefix ต./อ./จ. ที่บางเวอร์ชันใส่มาใน thaiaddress.name */
const stripPrefix = (v: unknown) => (v ? String(v).replace(/^(ต\.|ตำบล|อ\.|อำเภอ|จ\.|จังหวัด)\s*/, "").trim() || null : null);

/** ค่าแรกที่ไม่ว่าง — คอลัมน์ของ patient ต่างกันตามเวอร์ชัน HOSxP (แบบ pick ใน ppc-hos d506Form.service) */
function pick(r: Record<string, unknown>, ...cols: string[]): string {
  for (const c of cols) {
    const v = r[c];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** ชื่อตำบล/อำเภอ/จังหวัดจาก thaiaddress — LPAD ทั้งสองฝั่ง เพราะบางเรคคอร์ดเก็บ '5' แทน '05' */
async function addressNames(chw: string, amp: string, tmb: string) {
  if (!chw) return { tambon: null, amphoe: null, province: null };
  const pad2 = (v: string) => (v || "00").padStart(2, "0");
  try {
    const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(
      `SELECT
         MAX(IF(LPAD(amppart,2,'0') = '00' AND LPAD(tmbpart,2,'0') = '00', name, NULL)) AS province,
         MAX(IF(LPAD(amppart,2,'0') = ?    AND LPAD(tmbpart,2,'0') = '00', name, NULL)) AS amphoe,
         MAX(IF(LPAD(amppart,2,'0') = ?    AND LPAD(tmbpart,2,'0') = ?,    name, NULL)) AS tambon
       FROM thaiaddress WHERE LPAD(chwpart,2,'0') = ?`,
      [pad2(amp), pad2(amp), pad2(tmb), pad2(chw)],
    );
    return { tambon: stripPrefix(rows[0]?.tambon), amphoe: stripPrefix(rows[0]?.amphoe), province: stripPrefix(rows[0]?.province) };
  } catch {
    return { tambon: null, amphoe: null, province: null };
  }
}

export async function findHosxpPatient(by: { hn?: string; cid?: string }): Promise<HosxpPatient | null> {
  const key = by.hn ? `hn:${by.hn}` : `cid:${by.cid}`;
  const cacheKey = `tb:hosxp:v2:${key}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch { /* Redis ล่ม → query ตรง */ }

  // p.* แล้วเลือกคอลัมน์ด้วย pick — คอลัมน์เสริม (mobile_phone_number, deathday ฯลฯ) มีไม่ครบทุกเวอร์ชัน
  const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(
    `SELECT p.*, pt.name AS pttype_name
       FROM patient p
       LEFT JOIN pttype pt ON pt.pttype = p.pttype
      WHERE ${by.hn ? "p.hn = ?" : "p.cid = ?"}
      LIMIT 1`,
    [by.hn ?? by.cid],
  );
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const birthday = pick(r, "birthday").slice(0, 10) || null;
  const cid = pick(r, "cid");
  const moo = pick(r, "moopart");
  const road = pick(r, "road");
  const address = [pick(r, "addrpart"), moo && moo !== "0" ? `หมู่ ${moo}` : "", road && road !== "-" ? `ถนน${road}` : ""].filter(Boolean).join(" ") || null;
  const names = await addressNames(pick(r, "chwpart"), pick(r, "amppart"), pick(r, "tmbpart"));
  const fullAddress = [
    address, names.tambon && `ต.${names.tambon}`, names.amphoe && `อ.${names.amphoe}`, names.province && `จ.${names.province}`,
  ].filter(Boolean).join(" ") || null;
  const out: HosxpPatient = {
    hn: pick(r, "hn"),
    cid: /^\d{13}$/.test(cid) ? cid : null,
    name: `${pick(r, "pname")}${pick(r, "fname")} ${pick(r, "lname")}`.trim(),
    sex: pick(r, "sex") === "1" ? "ชาย" : pick(r, "sex") === "2" ? "หญิง" : null,
    birthday,
    age: birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? ageOn(birthday, todayBangkok()) : null,
    rights: pick(r, "pttype_name") || null,
    address,
    area: names.tambon,
    amphoe: names.amphoe,
    province: names.province,
    fullAddress,
    phone: pick(r, "mobile_phone_number", "hometel", "informtel") || null,
    deceased: pick(r, "death") === "Y" || !!pick(r, "deathday"),
  };
  try {
    await redis.set(cacheKey, JSON.stringify(out), "EX", TTL);
  } catch { /* ไม่ cache ก็ได้ */ }
  return out;
}
