// lib/tb/types.ts
// รูปแถวจาก MySQL — ชื่อคอลัมน์ตรงกับ docs/ppc_tb_schema.sql (= db/migrations/001_init.sql)
// ฟังก์ชันใน lib/tb/ รับแค่ส่วนที่ใช้ผ่าน Pick<> จึงทดสอบได้โดยไม่ต้องมี DB

import type { ContactType } from "./constants.ts";
import type { IsoDate } from "./dates.ts";

export type UnitRole = "admin" | "unit";

export interface PatientRow {
  id: string; // "P" + 10 hex
  fy: number; // ปีงบ พ.ศ.
  seq: number | null;
  name: string;
  hn: string | null;
  tb_no: string | null;
  cid: string | null;
  rights: string | null;
  sex: "ชาย" | "หญิง" | null;
  age: number | null;
  address: string | null;
  area: string | null;
  unit_id: number | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  comorbid: string | null;
  hiv: string | null;
  patient_type: string | null;
  reg_place: string | null;
  diag_basis: string | null;
  rr: string | null;
  diag_date: IsoDate | null;
  start_date: IsoDate | null;
  regimen: string | null;
  admit_date: IsoDate | null;
  dc_date: IsoDate | null;
  lft: string | null;
  outcome: string; // DEFAULT 'กำลังรักษา'
  outcome_date: IsoDate | null;
  notes: string | null;
  version: number;
}

export type FollowupTest = "CXR" | "AFB" | "Xpert" | "culture" | "LFT" | "other";

export interface FollowupRow {
  patient_id: string;
  slot: number; // 1–12
  month_no: number; // 0–24
  test: FollowupTest;
  test_date: IsoDate | null;
  result: string | null;
  note: string | null;
}

export interface ContactRow {
  id: string; // "C" + 10 hex
  patient_id: string;
  name: string;
  cid: string | null;
  hn: string | null;
  sex: "ชาย" | "หญิง" | null;
  age: number | null;
  relation: string | null;
  contact_type: ContactType;
  ring: number | null;
  unit_id: number;
  address: string | null;
  current_address: string | null;
  phone: string | null;
  tb_treat_place: string | null;
  risk: string | null;
  invest_date: IsoDate | null;
  screen_date: IsoDate | null;
  symptom: string | null;
  cxr_date: IsoDate | null;
  cxr_result: string | null;
  screen_result: string | null;
  new_patient_id: string | null;
  tpt_eligible: string | null; // ใช่ / ไม่ใช่ / ปฏิเสธ
  tpt_regimen: string | null;
  tpt_start: IsoDate | null;
  tpt_end: IsoDate | null;
  tpt_status: string | null;
  fu6_date: IsoDate | null;
  fu6_result: string | null;
  fu12_date: IsoDate | null;
  fu12_result: string | null;
  fu18_date: IsoDate | null;
  fu18_result: string | null;
  fu24_date: IsoDate | null;
  fu24_result: string | null;
  notes: string | null;
  version: number;
}

export interface VisitRow {
  id: string; // "V" + 10 hex
  patient_id: string | null;
  contact_id: string | null;
  visit_date: IsoDate;
  visit_type: string;
  detail: string | null;
  next_appt: IsoDate | null;
  updated_at: string; // "YYYY-MM-DD HH:mm:ss"
}

export interface TargetRow {
  fy: number;
  quarter: 0 | 1 | 2 | 3 | 4; // 0 = ทั้งปีงบ
  indicator: string;
  target: number | string; // DECIMAL
  unit: "cases" | "percent";
}
