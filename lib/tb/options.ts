// lib/tb/options.ts
// รายการตัวเลือกของฟอร์ม (L ใน Index.html เดิม) — ใช้ทั้ง dropdown (Phase 4) และ validation (Phase 3)
// ช่องที่เป็น datalist ในระบบเดิม (relation, risk, diag, regimen, afb, cxr) พิมพ์ค่าอื่นได้ ห้าม validate แบบตายตัว

import type { ContactType } from "./constants.ts";

export const OPTIONS = {
  sex: ["ชาย", "หญิง"],
  pttype: ["บัตรทอง", "ประกันสังคม", "ข้าราชการ", "ต่างด้าว", "อื่นๆ"],
  patientType: ["NEW", "Relapse", "Treatment after failure", "Treatment after LTFU", "Transfer in", "Other"],
  rifResistance: ["ไม่ดื้อ", "ดื้อ Rifampicin (RR/MDR)", "ไม่ได้ตรวจ"],
  hiv: ["ลบ", "บวก", "ไม่ได้ตรวจ"],
  outcome: ["กำลังรักษา", "หาย", "รักษาครบ", "ล้มเหลว", "ขาดยา", "เสียชีวิต", "โอนออก", "ประเมินไม่ได้"],
  afb: ["NEG", "Scanty", "1+", "2+", "3+", "เก็บไม่ได้", "ไม่ได้ตรวจ"],
  cxr: ["normal", "abnormal", "ดีขึ้น", "ไม่ได้ทำ"],
  regimen: ["2HRZE/4HR", "2IRZE + 4IR", "3IRZE/4IR", "อื่นๆ"],
  diagMethod: ["AFB", "Xpert MTB/RIF", "TB-LAMP", "CXR", "sputum c/s", "clinical"],
  relation: ["สามี/ภรรยา", "บุตร", "บิดา/มารดา", "พี่น้อง", "หลาน", "ปู่ย่าตายาย", "ญาติอื่น", "เพื่อนบ้าน", "ผู้ดูแล", "อื่นๆ"],
  ring: ["1", "2", "3"], // 1 ร่วมบ้าน / 2 รัศมี 10–50 ม. / 3 รัศมี 100–200 ม.
  riskGroup: ["ไม่มี", "เด็ก < 5 ปี", "อายุ ≥ 65 ปี", "เบาหวาน", "HIV", "โรคไตเรื้อรัง", "ได้ยากดภูมิ", "อื่นๆ"],
  symptoms: ["ไม่มีอาการ", "มีอาการสงสัยวัณโรค"],
  cxrResult: ["ปกติ", "ผิดปกติ สงสัยวัณโรค", "ผิดปกติ อื่นๆ", "ไม่ได้ทำ"],
  screenResult: ["รอผล", "ไม่ป่วย", "ส่งตรวจเพิ่ม", "ป่วยเป็นวัณโรค"],
  tptEligible: ["ใช่", "ไม่ใช่", "ปฏิเสธ"],
  tptRegimen: ["3HP", "1HP", "3HR", "4R", "6H", "อื่นๆ"],
  tptStatus: ["กำลังกิน", "กินครบ", "หยุดเพราะผลข้างเคียง", "ขาดยา/ปฏิเสธ"],
  followupResult: ["ปกติ", "ผิดปกติ ส่งตรวจต่อ", "ป่วยเป็นวัณโรค", "ติดตามไม่ได้"],
  visitType: [
    "ติดตามอาการ/รับยา", "ผล LFT", "ผลเสมหะ AFB", "ผล CXR", "ปรับ/เปลี่ยนสูตรยา",
    "Consult แพทย์", "Admit / D/C", "อาการไม่พึงประสงค์จากยา", "เยี่ยมบ้าน/DOT", "อื่นๆ",
  ],
} as const;

/** ค่าใน Sheet เดิมของคอลัมน์ "ประเภทการสัมผัส" */
export const CONTACT_TYPE_SHEET_LABEL: Record<ContactType, string> = {
  household: "ร่วมบ้าน (Household)",
  close: "ใกล้ชิด (Close contact)",
};

/**
 * ค่า "ประเภทการสัมผัส" จาก Sheet/Excel → contact_type
 * ระบบเดิมถือว่าทุกค่าที่ไม่ขึ้นต้นด้วย "ใกล้ชิด" เป็นร่วมบ้าน (รวมค่าว่าง) — คงพฤติกรรมนั้นไว้
 * แต่ค่าที่อ่านไม่ออกเลยคืน null ให้ผู้เรียกปฏิเสธแถว
 */
export function contactTypeFromLabel(v: string | null | undefined): ContactType | null {
  const s = (v ?? "").trim();
  if (/^(ใกล้ชิด|close)/i.test(s)) return "close";
  if (!s || /^(ร่วมบ้าน|household)/i.test(s)) return "household";
  return null;
}
