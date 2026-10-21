// lib/hosxp.ts — ดึงข้อมูลผู้ป่วยจาก HOSxP ตาม HN/CID (อ่านอย่างเดียว, cache Redis)
// ใช้เติมชื่อ/เพศ/อายุ/สิทธิ์/ที่อยู่/เบอร์โทร ตอนลงทะเบียน แล้ว "เก็บสำเนา" ไว้ใน ppc_tb (§2)
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
  address: string | null; // บ้านเลขที่/หมู่
  area: string | null; // ตำบล
  phone: string | null;
}

const TTL = 60 * 60; // 1 ชม.

export function hosxpConfigured(): boolean {
  return !!(process.env.HOSXP_DB_HOST && process.env.HOSXP_DB_USER && process.env.HOSXP_DB_NAME);
}

/** ตัด prefix ต./อ./จ. ที่บางเวอร์ชันใส่มาใน thaiaddress.name */
const stripPrefix = (s: unknown) => (s ? String(s).replace(/^(ต\.|ตำบล|อ\.|อำเภอ|จ\.|จังหวัด)\s*/, "").trim() : null);

export async function findHosxpPatient(by: { hn?: string; cid?: string }): Promise<HosxpPatient | null> {
  const key = by.hn ? `hn:${by.hn}` : `cid:${by.cid}`;
  const cacheKey = `tb:hosxp:${key}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch { /* Redis ล่ม → query ตรง */ }

  const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(
    `SELECT p.hn, p.cid, p.pname, p.fname, p.lname, p.sex, p.birthday,
            TRIM(p.addrpart) AS addrpart, TRIM(p.moopart) AS moopart,
            t.name AS tambon, COALESCE(NULLIF(TRIM(p.hometel), ''), NULLIF(TRIM(p.informtel), '')) AS phone,
            pt.name AS pttype_name
       FROM patient p
       LEFT JOIN pttype pt ON pt.pttype = p.pttype
       LEFT JOIN thaiaddress t ON t.chwpart = p.chwpart AND t.amppart = p.amppart AND t.tmbpart = p.tmbpart
      WHERE ${by.hn ? "p.hn = ?" : "p.cid = ?"}
      LIMIT 1`,
    [by.hn ?? by.cid],
  );
  const r = rows[0];
  if (!r) return null;
  const birthday = r.birthday ? String(r.birthday).slice(0, 10) : null;
  const moo = r.moopart ? `หมู่ ${r.moopart}` : "";
  const out: HosxpPatient = {
    hn: String(r.hn),
    cid: r.cid && /^\d{13}$/.test(String(r.cid)) ? String(r.cid) : null,
    name: `${r.pname ?? ""}${r.fname ?? ""} ${r.lname ?? ""}`.trim(),
    sex: r.sex === "1" ? "ชาย" : r.sex === "2" ? "หญิง" : null,
    birthday,
    age: birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? ageOn(birthday, todayBangkok()) : null,
    rights: r.pttype_name ?? null,
    address: [r.addrpart, moo].filter(Boolean).join(" ") || null,
    area: stripPrefix(r.tambon),
    phone: r.phone ?? null,
  };
  try {
    await redis.set(cacheKey, JSON.stringify(out), "EX", TTL);
  } catch { /* ไม่ cache ก็ได้ */ }
  return out;
}
