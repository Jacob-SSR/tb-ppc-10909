// lib/tb/constants.ts
// ค่าคงที่ที่ business logic ใช้จริง
// รายการตัวเลือกของฟอร์มทั้งชุด (L ใน Index.html เดิม) จะย้ายมาตอนทำ UI (Phase 4)

/** ผลคัดกรอง/ผลติดตามที่ถือว่า "ป่วยเป็นวัณโรค" */
export const TB_RESULT = "ป่วยเป็นวัณโรค";

/** ผลการรักษาของผู้ป่วยที่ยังไม่สรุปผล */
export const OUTCOME_ONGOING = "กำลังรักษา";

/** ผลการรักษา — ค่าที่พบใน DB_Patients จริง + ล้มเหลว/ไม่ได้ประเมิน ตามนิยาม WHO */
export const OUTCOMES = [
  "กำลังรักษา",
  "หาย",
  "รักษาครบ",
  "ล้มเหลว",
  "เสียชีวิต",
  "ขาดยา",
  "โอนออก",
  "ไม่ได้ประเมิน",
] as const;

export const CONTACT_TYPES = ["household", "close"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  household: "ร่วมบ้าน",
  close: "ใกล้ชิด",
};

/** เดือนที่ต้องติดตามผู้สัมผัส (ขั้น D) นับจากวันที่ผู้ป่วย index เริ่มยา */
export const CONTACT_FOLLOWUP_MONTHS: Record<ContactType, readonly FollowupMonth[]> = {
  household: [6, 12, 18, 24],
  close: [12, 24],
};
export type FollowupMonth = 6 | 12 | 18 | 24;

/** ขั้น A: สอบสวนภายใน n วันหลังผู้ป่วย index เริ่มยา */
export const INVESTIGATE_WITHIN_DAYS = 7;
/** ขั้น B: คัดกรองภายใน n วันหลังผู้ป่วย index เริ่มยา */
export const SCREEN_WITHIN_DAYS = 14;
/** ผู้ป่วยยังไม่มีผู้สัมผัส: ควรมีภายในกี่วันหลังเริ่มยา (ใช้กำหนดเดียวกับขั้น A) */
export const CONTACTS_WITHIN_DAYS = INVESTIGATE_WITHIN_DAYS;

/** เดือนที่ต้องตรวจ AFB ระหว่างรักษา */
export const PATIENT_AFB_MONTHS = [2, 5, 6] as const;

/** ระยะเวลารักษาเมื่ออ่านสูตรยาไม่ออก (สูตรมาตรฐาน 2IRZE + 4IR) */
export const DEFAULT_REGIMEN_MONTHS = 6;

/**
 * สูตร TPT → จำนวนเดือนที่นัดรายเดือน
 * ตามแนวทาง TPT ของกองวัณโรค — รอเทียบกับ L ใน Index.html เดิม
 */
export const TPT_REGIMENS: Record<string, number> = {
  "1HP": 1,
  "3HP": 3,
  "3HR": 3,
  "4R": 4,
  "6H": 6,
  "9H": 9,
  "6Lfx": 6,
};

/** สถานะ TPT ที่ถือว่าจบแล้ว ไม่ต้องนัดต่อ */
export const TPT_ENDED_STATUSES = ["กินครบ", "หยุดยา", "ปฏิเสธ"] as const;

/** หมวด 4 ติดตามระหว่างรักษา */
export const MAX_FOLLOWUP_SLOTS = 12;

export interface FollowupSlotDef {
  slot: number;
  month_no: number;
  test_type: string;
  /** หัวคอลัมน์เดิมใน DB_Patients (ใช้ตอน import และเขียน Sheet mirror) */
  legacyColumn: string;
}

/** 5 ช่องเริ่มต้น — slot 1–5 ตรงกับคอลัมน์ "เดือน2 CXR … เดือน6 AFB" ของ Sheet เดิม */
export const DEFAULT_FOLLOWUP_SLOTS: readonly FollowupSlotDef[] = [
  { slot: 1, month_no: 2, test_type: "CXR", legacyColumn: "เดือน2 CXR" },
  { slot: 2, month_no: 2, test_type: "AFB", legacyColumn: "เดือน2 AFB" },
  { slot: 3, month_no: 5, test_type: "AFB", legacyColumn: "เดือน5 AFB" },
  { slot: 4, month_no: 6, test_type: "CXR", legacyColumn: "เดือน6 CXR" },
  { slot: 5, month_no: 6, test_type: "AFB", legacyColumn: "เดือน6 AFB" },
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
