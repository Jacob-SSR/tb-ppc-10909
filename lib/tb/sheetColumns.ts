// lib/tb/sheetColumns.ts
// หัวคอลัมน์ของ Sheet เดิม (P_FIELDS / C_FIELDS / V_FIELDS ใน Code.gs) ตามลำดับเดิมทุกตัว
// ใช้ทั้ง import (Phase 5 แม็ปตามชื่อหัว) และ Sheet mirror (Phase 6 เขียนหัว+ลำดับเดิม ให้ ppc-hos อ่านต่อได้)
// คอลัมน์ใหม่ที่ Sheet เดิมไม่มี ให้ต่อท้ายเท่านั้น (ระบบเดิมก็ทำแบบนี้ เพื่อไม่ให้คอลัมน์เดิมเลื่อน)
//
// source:
//   ชื่อคอลัมน์ใน MySQL            ค่าตรงจากตารางนั้น (วันที่เป็น YYYY-MM-DD)
//   "unit_name"                   ชื่อหน่วยจาก tb_units ผ่าน unit_id
//   "followup:N"                  ผลตรวจของ tb_treatment_followups slot N
//   "index_hn"                    HN ของผู้ป่วย index (tb_patients.hn ผ่าน patient_id)
//   "ref_id"                      patient_id หรือ contact_id ของ visit
//   "updated_by_name"/"updated_at" ผู้แก้ไข/เวลาล่าสุด (import: เก็บลง audit "migrate")

export type SheetColumn = readonly [header: string, source: string];

export const PATIENT_SHEET_COLUMNS: readonly SheetColumn[] = [
  ["รหัสระบบ", "id"],
  ["ปีงบ", "fy"],
  ["ลำดับ", "seq"],
  ["ชื่อ-สกุล", "full_name"],
  ["HN", "hn"],
  ["TB number", "tb_number"],
  ["เลขบัตรประชาชน", "cid"],
  ["สิทธิการรักษา", "pttype"],
  ["เพศ", "sex"],
  ["อายุ", "age"],
  ["บ้านเลขที่/หมู่", "address"],
  ["ตำบล/พื้นที่", "tambon"],
  ["รพ.สต.รับผิดชอบ", "unit_name"],
  ["โทรศัพท์", "phone"],
  ["Latitude", "lat"],
  ["Longitude", "lng"],
  ["โรคร่วม (U/D)", "comorbidity"],
  ["ผล HIV", "hiv_result"],
  ["ประเภทผู้ป่วย", "patient_type"],
  ["สถานที่ลงทะเบียน", "reg_place"],
  ["วิธีวินิจฉัย", "diag_method"],
  ["ผลดื้อ Rifampicin", "rif_resistance"],
  ["วันวินิจฉัย", "diag_date"],
  ["วันเริ่มยา", "start_date"],
  ["สูตรยา", "regimen"],
  ["วัน admit", "admit_date"],
  ["วัน discharge", "discharge_date"],
  ["LFT", "lft"],
  ["เดือน2 CXR", "followup:1"],
  ["เดือน2 AFB", "followup:2"],
  ["เดือน5 AFB", "followup:3"],
  ["เดือน6 CXR", "followup:4"],
  ["เดือน6 AFB", "followup:5"],
  ["ผลการรักษา", "outcome"],
  ["วันสรุปผล", "outcome_date"],
  ["บันทึก", "note"],
  ["แก้ไขโดย", "updated_by_name"],
  ["แก้ไขเมื่อ", "updated_at"],
];

export const CONTACT_SHEET_COLUMNS: readonly SheetColumn[] = [
  ["รหัสระบบ", "id"],
  ["รหัสผู้ป่วย index", "patient_id"],
  ["ปีงบ", "fy"],
  ["HN ผู้ป่วย index", "index_hn"],
  ["ชื่อ-สกุลผู้สัมผัส", "full_name"],
  ["เลขบัตรประชาชน", "cid"],
  ["HN", "hn"],
  ["เพศ", "sex"],
  ["อายุ", "age"],
  ["ความสัมพันธ์", "relation"],
  ["ประเภทการสัมผัส", "contact_type"], // แปลงด้วย CONTACT_TYPE_SHEET_LABEL / contactTypeFromLabel
  ["วง", "ring"],
  ["รพ.สต.รับผิดชอบ", "unit_name"],
  ["ที่อยู่", "address"],
  ["โทรศัพท์", "phone"],
  ["กลุ่มเสี่ยง", "risk_group"],
  ["วันสอบสวน", "investigate_date"],
  ["วันคัดกรอง", "screen_date"],
  ["ซักอาการ", "symptoms"],
  ["วันทำ CXR", "cxr_date"],
  ["ผล CXR", "cxr_result"],
  ["ผลคัดกรอง", "screen_result"],
  ["รหัสผู้ป่วยใหม่", "new_patient_id"],
  ["เข้าเกณฑ์ TPT", "tpt_eligible"],
  ["สูตร TPT", "tpt_regimen"],
  ["วันเริ่ม TPT", "tpt_start_date"],
  ["วันสิ้นสุด TPT", "tpt_end_date"],
  ["สถานะ TPT", "tpt_status"],
  ["ติดตาม 6 ด. วันที่", "fu6_date"],
  ["ติดตาม 6 ด. ผล", "fu6_result"],
  ["ติดตาม 12 ด. วันที่", "fu12_date"],
  ["ติดตาม 12 ด. ผล", "fu12_result"],
  ["ติดตาม 18 ด. วันที่", "fu18_date"],
  ["ติดตาม 18 ด. ผล", "fu18_result"],
  ["ติดตาม 24 ด. วันที่", "fu24_date"],
  ["ติดตาม 24 ด. ผล", "fu24_result"],
  ["บันทึก", "note"],
  ["แก้ไขโดย", "updated_by_name"],
  ["แก้ไขเมื่อ", "updated_at"],
  // คอลัมน์ใหม่ (§6.3, §6.5) — ต่อท้ายตอนเขียน mirror
  // ["ที่อยู่ปัจจุบัน", "current_address"], ["สถานที่รักษา TB", "tb_treat_place"],
];

export const VISIT_SHEET_COLUMNS: readonly SheetColumn[] = [
  ["รหัสระบบ", "id"],
  ["รหัสผู้ป่วย/ผู้สัมผัส", "ref_id"],
  ["วันที่", "visit_date"],
  ["ประเภท", "visit_type"],
  ["รายละเอียด", "detail"],
  ["บันทึกโดย", "updated_by_name"],
  ["บันทึกเมื่อ", "updated_at"],
  ["วันนัดครั้งถัดไป", "next_appt_date"],
];
