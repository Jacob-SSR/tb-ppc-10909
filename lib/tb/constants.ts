// lib/tb/constants.ts
// ค่าคงที่ที่ business logic ใช้จริง — ยึดตาม Code.gs / Index.html เดิม
// รายการตัวเลือกของฟอร์มทั้งชุด (L เดิม) อยู่ใน ./options.ts

/** ผลคัดกรอง/ผลติดตามที่ถือว่า "ป่วยเป็นวัณโรค" */
export const TB_RESULT = "ป่วยเป็นวัณโรค";
/** ผลคัดกรองที่ถือว่าคัดกรองแล้วไม่ป่วย → ไปขั้น C/D ได้ */
export const SCREEN_NEGATIVE = "ไม่ป่วย";
/** ผลคัดกรองที่ยังไม่จบขั้น B */
export const SCREEN_PENDING = ["รอผล", "ส่งตรวจเพิ่ม"] as const;

/** ผลการรักษาของผู้ป่วยที่ยังไม่สรุปผล */
export const OUTCOME_ONGOING = "กำลังรักษา";
/** ผลการรักษาที่นับเป็นความสำเร็จ (Success Rate) */
export const OUTCOME_SUCCESS = ["หาย", "รักษาครบ"] as const;

export const CONTACT_TYPES = ["household", "close"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  household: "ร่วมบ้าน",
  close: "ใกล้ชิด",
};

/** ขั้น D: เดือนที่ต้องติดตาม นับจากวันคัดกรอง (ร่วมบ้าน ทุก 6 เดือน · ใกล้ชิด ปีละครั้ง) */
export const CONTACT_FOLLOWUP_MONTHS: Record<ContactType, readonly FollowupMonth[]> = {
  household: [6, 12, 18, 24],
  close: [12, 24],
};
export type FollowupMonth = 6 | 12 | 18 | 24;

/** ขั้น A: สอบสวนภายใน n วันหลังผู้ป่วย index เริ่มยา */
export const INVESTIGATE_WITHIN_DAYS = 7;
/** ขั้น B: คัดกรองภายใน n วันหลังวันสอบสวน */
export const SCREEN_WITHIN_DAYS = 14;
/** ขั้น C: เริ่ม TPT ภายใน n วันหลังวันคัดกรอง */
export const TPT_START_WITHIN_DAYS = 14;
/** ผู้ป่วยยังไม่มีผู้สัมผัส: ควรระบุภายในกี่วันหลังเริ่มยา */
export const CONTACTS_WITHIN_DAYS = 7;

/** เดือนที่ต้องตรวจ AFB ระหว่างรักษา (ทำตามลำดับ 2 → 5 → 6 แล้วสรุปผล) */
export const PATIENT_AFB_MONTHS = [2, 5, 6] as const;
/** สรุปผลการรักษาเมื่อครบกี่เดือนหลังเริ่มยา */
export const CONCLUDE_AFTER_MONTHS = 6;

/** สูตร TPT → จำนวนเดือนที่นัดรายเดือน (Index.html เดิม) สูตรอื่นใช้ DEFAULT_TPT_MONTHS */
export const TPT_REGIMEN_MONTHS: Record<string, number> = {
  "3HP": 3,
  "1HP": 1,
  "3HR": 3,
  "4R": 4,
  "6H": 6,
};
export const DEFAULT_TPT_MONTHS = 3;
/** สถานะ TPT ที่ยังกินยาอยู่ (ว่าง = ยังกินอยู่เช่นกัน) — สถานะอื่นถือว่าจบแล้ว */
export const TPT_ONGOING_STATUS = "กำลังกิน";
/** เข้าเกณฑ์ TPT */
export const TPT_ELIGIBLE_YES = "ใช่";

/** หมวด 4 ติดตามระหว่างรักษา */
export const MAX_FOLLOWUP_SLOTS = 12;

export interface FollowupSlotDef {
  slot: number;
  month_no: number;
  test: "CXR" | "AFB";
  /** หัวคอลัมน์เดิมใน DB_Patients (ใช้ตอน import และเขียน Sheet mirror) */
  legacyColumn: string;
}

/** 5 ช่องเริ่มต้น — slot 1–5 ตรงกับคอลัมน์ "เดือน2 CXR … เดือน6 AFB" ของ Sheet เดิม */
export const DEFAULT_FOLLOWUP_SLOTS: readonly FollowupSlotDef[] = [
  { slot: 1, month_no: 2, test: "CXR", legacyColumn: "เดือน2 CXR" },
  { slot: 2, month_no: 2, test: "AFB", legacyColumn: "เดือน2 AFB" },
  { slot: 3, month_no: 5, test: "AFB", legacyColumn: "เดือน5 AFB" },
  { slot: 4, month_no: 6, test: "CXR", legacyColumn: "เดือน6 CXR" },
  { slot: 5, month_no: 6, test: "AFB", legacyColumn: "เดือน6 AFB" },
];

/** หน่วยบริการ 7 แห่ง — ชื่อตรงกับ DB_Users เดิม (seed ใน db/migrations/002_seed_units.sql) */
export const UNIT_NAMES = [
  "รพ.พลับพลาชัย",
  "รพ.สต.ตาพระ",
  "รพ.สต.ป่าชัน",
  "รพ.สต.จันดุม",
  "รพ.สต.โคกเจริญ",
  "รพ.สต.สำโรง",
  "รพ.สต.โคกขมิ้น",
] as const;
