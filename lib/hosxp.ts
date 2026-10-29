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
  postcode: string | null;
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
  const cacheKey = `tb:hosxp:v3:${key}`;
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
  const po = pick(r, "po_code", "postcode", "zipcode", "zip_code");
  const postcode = /^\d{5}$/.test(po) ? po : null;
  const fullAddress = [
    address, names.tambon && `ต.${names.tambon}`, names.amphoe && `อ.${names.amphoe}`, names.province && `จ.${names.province}`, postcode,
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
    postcode,
    fullAddress,
    phone: pick(r, "mobile_phone_number", "hometel", "informtel") || null,
    deceased: pick(r, "death") === "Y" || !!pick(r, "deathday"),
  };
  try {
    await redis.set(cacheKey, JSON.stringify(out), "EX", TTL);
  } catch { /* ไม่ cache ก็ได้ */ }
  return out;
}

// ── นัดหมายจาก HOSxP (oapp) — SQL แบบเดียวกับ plubplachai-alert (src/server/hosxp.ts) ─────────────
// อ่านอย่างเดียว: ดึงมาเก็บสำเนาใน tb_appointments (source='hosxp') ไม่เขียนกลับ HOSxP

export interface HosxpAppointment {
  oapp_id: string;
  date: string;
  time: string | null;
  clinic: string;
  place: string;
  doctor: string;
  /** เหตุที่นัด (oapp.app_cause) */
  cause: string;
  note: string;
  status: string | null;
  /** NULL / 1 = นัดปกติ (เหมือน plubplachai-alert) — อื่นๆ ถือว่ายกเลิก; เพิ่มรหัสได้ด้วย HOSXP_ACTIVE_STATUS_IDS */
  active: boolean;
  /** มี visit ผูกกับนัด = มาตามนัดแล้ว */
  came: boolean;
  /** คลินิกนัดผู้สัมผัส (household / close contact) */
  tbClinic: boolean;
}

/** คลินิกที่ใช้นัดผู้สัมผัส — ส่วนหนึ่งของชื่อคลินิกใน HOSxP (ไม่สนตัวพิมพ์) คั่นด้วยจุลภาค */
export function apptClinicPatterns(): string[] {
  return (process.env.HOSXP_APPT_CLINICS ?? "household,close contact").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export const isApptClinic = (name: string, patterns = apptClinicPatterns()) => patterns.some((p) => name.toLowerCase().includes(p));

export function hosxpActiveStatus(status: unknown): boolean {
  const accepted = ["NULL", "1", ...(process.env.HOSXP_ACTIVE_STATUS_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  return accepted.includes(status == null ? "NULL" : String(status));
}

// o.* เพราะคอลัมน์ของ oapp ต่างกันตามเวอร์ชัน (app_cause / note / nexttime_end มีใน HOSxP ของ รพ. — ดูจาก debug trace หน้าจอนัด)
const OAPP_SQL = `SELECT o.*, c.name AS clinic_name, k.department AS department_name, d.name AS doctor_name
  FROM oapp o LEFT JOIN clinic c ON c.clinic = o.clinic
  LEFT JOIN doctor d ON d.code = o.doctor LEFT JOIN kskdepartment k ON k.depcode = o.depcode`;

function toHosxpAppointment(r: Record<string, unknown>): HosxpAppointment {
  return {
    oapp_id: String(r.oapp_id),
    date: String(r.nextdate).slice(0, 10),
    time: r.nexttime ? String(r.nexttime).slice(0, 8) : null,
    clinic: pick(r, "clinic_name", "clinic"),
    place: pick(r, "contact_point", "department_name"),
    doctor: pick(r, "doctor_name"),
    cause: pick(r, "app_cause"),
    note: pick(r, "note"),
    status: r.oapp_status_id == null ? null : String(r.oapp_status_id),
    active: hosxpActiveStatus(r.oapp_status_id),
    came: !!pick(r, "visit_vn"),
    tbClinic: isApptClinic(pick(r, "clinic_name", "clinic")),
  };
}

/** นัดทั้งหมดของ HN ตั้งแต่วันที่ from (ทุกคลินิก) — ไม่ cache: ต้องเห็นสถานะล่าสุด */
export async function findHosxpAppointments(hn: string, from: string): Promise<HosxpAppointment[]> {
  const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(
    `${OAPP_SQL} WHERE o.hn = ? AND o.nextdate >= ? ORDER BY o.nextdate, o.nexttime LIMIT 200`,
    [hn, from],
  );
  return rows.map((r) => toHosxpAppointment(r as Record<string, unknown>));
}

/** สถานะล่าสุดของนัดที่ดึงมาแล้ว (ตาม oapp_id) — ไม่พบ = ถูกลบใน HOSxP */
export async function readHosxpAppointments(oappIds: string[]): Promise<Map<string, HosxpAppointment>> {
  const out = new Map<string, HosxpAppointment>();
  const ids = [...new Set(oappIds)].filter((id) => /^\d{1,20}$/.test(id));
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(`${OAPP_SQL} WHERE o.oapp_id IN (${batch.map(() => "?").join(",")})`, batch);
    for (const r of rows) out.set(String(r.oapp_id), toHosxpAppointment(r as Record<string, unknown>));
  }
  return out;
}

/** นัดทุกรายในคลินิกนัดผู้สัมผัส (household / close contact) ช่วง [from, to] — ใช้ดึงอัตโนมัติ
 *  cid ใช้จับคู่กับผู้สัมผัสที่ไม่มี HN เท่านั้น ไม่เก็บลงระบบ */
export async function findClinicAppointments(from: string, to: string): Promise<(HosxpAppointment & { hn: string; cid: string })[]> {
  const patterns = apptClinicPatterns();
  if (!patterns.length) return [];
  const [rows] = await hosxpDb.query<mysql.RowDataPacket[]>(
    `SELECT o.*, c.name AS clinic_name, k.department AS department_name, d.name AS doctor_name, p.cid AS patient_cid
       FROM oapp o JOIN clinic c ON c.clinic = o.clinic
       LEFT JOIN doctor d ON d.code = o.doctor LEFT JOIN kskdepartment k ON k.depcode = o.depcode
       LEFT JOIN patient p ON p.hn = o.hn
      WHERE o.nextdate BETWEEN ? AND ? AND (${patterns.map(() => "LOWER(c.name) LIKE ?").join(" OR ")})
      ORDER BY o.nextdate, o.oapp_id LIMIT 5000`,
    [from, to, ...patterns.map((p) => `%${p.replace(/[%_\\]/g, "\\$&")}%`)],
  );
  return rows.map((r) => ({ ...toHosxpAppointment(r as Record<string, unknown>), hn: pick(r, "hn"), cid: pick(r, "patient_cid") }));
}
