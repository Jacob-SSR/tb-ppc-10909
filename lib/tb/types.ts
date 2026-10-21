// lib/tb/types.ts
// รูปแถวจาก MySQL (ชื่อคอลัมน์ snake_case ตรงกับ db/migrations/001_init.sql)
// ฟังก์ชันใน lib/tb/ รับแค่ส่วนที่ใช้ผ่าน Pick<> จึงทดสอบได้โดยไม่ต้องมี DB

import type { ContactType } from "./constants.ts";
import type { IsoDate } from "./dates.ts";

export type UnitRole = "admin" | "unit";

export interface PatientRow {
  id: string; // "P" + 10 hex
  fy: number | null;
  seq: number | null;
  full_name: string;
  hn: string | null;
  tb_number: string | null;
  cid: string | null;
  pttype: string | null;
  sex: string | null;
  age: number | null;
  address: string | null;
  tambon: string | null;
  unit_id: number | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  comorbidity: string | null;
  hiv_result: string | null;
  patient_type: string | null;
  reg_place: string | null;
  diag_method: string | null;
  rif_resistance: string | null;
  diag_date: IsoDate | null;
  start_date: IsoDate | null;
  regimen: string | null;
  admit_date: IsoDate | null;
  discharge_date: IsoDate | null;
  lft: string | null;
  outcome: string | null;
  outcome_date: IsoDate | null;
  note: string | null;
  version: number;
}

export interface FollowupRow {
  patient_id: string;
  slot: number; // 1–12
  month_no: number | null;
  test_type: string | null;
  test_date: IsoDate | null;
  result: string | null;
}

export interface ContactRow {
  id: string; // "C" + 10 hex
  patient_id: string;
  fy: number | null;
  full_name: string;
  cid: string | null;
  hn: string | null;
  sex: string | null;
  age: number | null;
  relation: string | null;
  contact_type: ContactType;
  ring: number | null;
  unit_id: number | null;
  address: string | null;
  current_address: string | null;
  phone: string | null;
  risk_group: string | null;
  investigate_date: IsoDate | null;
  screen_date: IsoDate | null;
  symptoms: string | null;
  cxr_date: IsoDate | null;
  cxr_result: string | null;
  screen_result: string | null;
  new_patient_id: string | null;
  tb_treat_place: string | null;
  tpt_eligible: 0 | 1 | null;
  tpt_regimen: string | null;
  tpt_start_date: IsoDate | null;
  tpt_end_date: IsoDate | null;
  tpt_status: string | null;
  fu6_date: IsoDate | null;
  fu6_result: string | null;
  fu12_date: IsoDate | null;
  fu12_result: string | null;
  fu18_date: IsoDate | null;
  fu18_result: string | null;
  fu24_date: IsoDate | null;
  fu24_result: string | null;
  note: string | null;
  version: number;
}

export interface TargetRow {
  fy: number;
  quarter: 0 | 1 | 2 | 3 | 4; // 0 = ทั้งปีงบ
  indicator: string;
  target_value: number | string; // DECIMAL มาจาก mysql2 เป็นสตริง
}
