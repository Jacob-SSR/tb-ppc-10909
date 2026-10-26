// lib/validation.ts — ตรวจข้อมูลก่อนเข้า DB (ฟอร์ม, นำเข้า Excel, สคริปต์ย้ายข้อมูล ใช้ชุดเดียวกัน)
// ''/ช่องว่าง → null เสมอ, วันที่รับทุกรูปแบบที่ toIso อ่านได้ แล้วเก็บเป็น YYYY-MM-DD
import { z } from "zod";
import { toIso } from "./tb/dates.ts";
import { FOLLOWUP_TESTS } from "./tb/followups.ts";
import { MAX_FOLLOWUP_SLOTS } from "./tb/constants.ts";

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** ข้อความ: ตัดช่องว่าง, ว่าง = null, จำกัดความยาวตามคอลัมน์ */
export const text = (max: number) =>
  z.preprocess((v) => (blank(v) ? null : String(v).trim()), z.string().max(max, `ยาวเกิน ${max} ตัวอักษร`).nullable());

/** ข้อความที่ต้องมี */
export const requiredText = (max: number, label: string) =>
  z.preprocess((v) => (blank(v) ? "" : String(v).trim()), z.string().min(1, `กรุณากรอก${label}`).max(max, `ยาวเกิน ${max} ตัวอักษร`));

export const date = z.preprocess((v, ctx) => {
  if (blank(v)) return null;
  const iso = toIso(v);
  if (!iso) {
    ctx.addIssue({ code: "custom", message: `วันที่ไม่ถูกต้อง: ${String(v)}` });
    return z.NEVER;
  }
  return iso;
}, z.string().nullable());

const intIn = (min: number, max: number) =>
  z.preprocess(
    (v) => (blank(v) ? null : typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : v),
    z.number().int("ต้องเป็นจำนวนเต็ม").min(min).max(max).nullable(),
  );

const coord = (min: number, max: number) =>
  z.preprocess((v) => (blank(v) ? null : Number(v)), z.number().min(min).max(max).nullable());

export const cid = z.preprocess(
  (v) => (blank(v) ? null : String(v).replace(/[\s-]/g, "")),
  z.string().regex(/^\d{13}$/, "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก").nullable(),
);

const postcode = z.preprocess(
  (v) => (blank(v) ? null : String(v).replace(/\s/g, "")),
  z.string().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก").nullable(),
);

const sex = z.preprocess((v) => (blank(v) ? null : String(v).trim()), z.enum(["ชาย", "หญิง"]).nullable());

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[0-9a-f]{10}$`), "รหัสระบบไม่ถูกต้อง");

// ── ผู้ป่วย ─────────────────────────────────────────────────────────────────

export const followupInput = z.object({
  slot: z.number().int().min(1).max(MAX_FOLLOWUP_SLOTS),
  month_no: z.preprocess((v) => (blank(v) ? 0 : Number(v)), z.number().int().min(0, "เดือนที่ 0–24").max(24, "เดือนที่ 0–24")),
  test: z.enum(FOLLOWUP_TESTS as unknown as [string, ...string[]]),
  test_date: date,
  result: text(100),
  note: text(300),
});
export type FollowupInputData = z.infer<typeof followupInput>;

export const patientFields = {
  seq: intIn(1, 65535),
  name: requiredText(150, "ชื่อ-สกุล"),
  hn: text(12),
  tb_no: text(20),
  cid,
  rights: text(50),
  sex,
  age: intIn(0, 150),
  address: text(200),
  area: text(100),
  amphoe: text(100),
  province: text(100),
  postcode,
  current_address: text(200),
  unit_id: intIn(1, 65535),
  phone: text(30),
  lat: coord(-90, 90),
  lng: coord(-180, 180),
  comorbid: text(200),
  hiv: text(20),
  patient_type: text(40),
  reg_place: text(100),
  diag_basis: text(200),
  rr: text(40),
  diag_date: date,
  start_date: date,
  regimen: text(100),
  admit_date: date,
  dc_date: date,
  lft: text(300),
  outcome: z.preprocess((v) => (blank(v) ? "กำลังรักษา" : String(v).trim()), z.string().max(30)),
  outcome_date: date,
  notes: text(65535),
};

export const patientInput = z
  .object({
    ...patientFields,
    /** ปีงบ — ปกติคำนวณจากวันเริ่มยา/วันวินิจฉัย; ส่งมาเองได้ตอนนำเข้า (ข้อมูลเดิมบางแถวไม่มีวันที่) */
    fy: intIn(2500, 2700).optional(),
    followups: z.array(followupInput).max(MAX_FOLLOWUP_SLOTS).optional(),
  })
  .refine((p) => p.start_date || p.diag_date || p.fy, { message: "กรุณากรอกวันเริ่มยาหรือวันวินิจฉัย", path: ["start_date"] })
  .refine((p) => !p.followups || new Set(p.followups.map((f) => f.slot)).size === p.followups.length, {
    message: "ช่องติดตามซ้ำกัน",
    path: ["followups"],
  });
export type PatientInput = z.infer<typeof patientInput>;
export const PATIENT_KEYS = Object.keys(patientFields) as (keyof typeof patientFields)[];

// ── ผู้สัมผัส ────────────────────────────────────────────────────────────────

export const contactFields = {
  patient_id: id("P"),
  name: requiredText(150, "ชื่อ-สกุลผู้สัมผัส"),
  cid,
  hn: text(12),
  sex,
  age: intIn(0, 150),
  relation: text(50),
  contact_type: z.enum(["household", "close"], { message: "ประเภทการสัมผัสต้องเป็น ร่วมบ้าน หรือ ใกล้ชิด" }),
  ring: intIn(1, 3),
  unit_id: z.preprocess((v) => (blank(v) ? null : Number(v)), z.number().int().positive().nullable()),
  address: text(200),
  current_address: text(200),
  phone: text(30),
  tb_treat_place: text(150),
  risk: text(100),
  invest_date: date,
  screen_date: date,
  symptom: text(40),
  cxr_date: date,
  cxr_result: text(40),
  screen_result: text(30),
  tpt_eligible: text(10),
  tpt_regimen: text(20),
  tpt_start: date,
  tpt_end: date,
  tpt_status: text(40),
  fu6_date: date,
  fu6_result: text(40),
  fu12_date: date,
  fu12_result: text(40),
  fu18_date: date,
  fu18_result: text(40),
  fu24_date: date,
  fu24_result: text(40),
  notes: text(65535),
};
export const contactInput = z.object(contactFields);
export type ContactInput = z.infer<typeof contactInput>;
export const CONTACT_KEYS = Object.keys(contactFields) as (keyof typeof contactFields)[];

// ── บันทึกรายครั้ง ───────────────────────────────────────────────────────────

export const visitInput = z
  .object({
    patient_id: id("P").nullable().optional(),
    contact_id: id("C").nullable().optional(),
    visit_date: z.preprocess((v) => (blank(v) ? "" : toIso(v) ?? "invalid"), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาระบุวันที่")),
    visit_type: requiredText(50, "ประเภท"),
    detail: requiredText(65535, "รายละเอียด"),
    next_appt: date,
    lat: coord(-90, 90).optional(),
    lng: coord(-180, 180).optional(),
    client_uuid: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !!v.patient_id !== !!v.contact_id, { message: "ต้องระบุผู้ป่วยหรือผู้สัมผัสอย่างใดอย่างหนึ่ง", path: ["patient_id"] })
  .refine((v) => !v.next_appt || v.next_appt > v.visit_date, { message: "วันนัดต้องอยู่หลังวันที่บันทึก", path: ["next_appt"] });
export type VisitInput = z.infer<typeof visitInput>;
