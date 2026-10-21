// lib/indicators.ts — ตัวชี้วัดที่ตั้งเป้าได้ (§6.1) — ชุดตั้งต้นจากแดชบอร์ดเดิม + คอมเมนต์ใน schema
// รายชื่อครบชุดยังรอเจ้าของงานยืนยัน (CLAUDE.md §11 ข้อ 4) — เพิ่มตัวใหม่ที่นี่ที่เดียว
// (คำนวณผลงานอยู่ใน lib/tb/dashboard.ts)

export interface IndicatorDef {
  id: string;
  label: string;
  unit: "cases" | "percent";
  /** true = ยิ่งต่ำยิ่งดี (เช่น อัตราตาย) */
  lowerIsBetter?: boolean;
  hint: string;
}

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: "case_finding",
    label: "ผู้ป่วยใหม่ + กลับเป็นซ้ำ ที่ขึ้นทะเบียน",
    unit: "cases",
    hint: "เป้าจำนวนผู้ป่วยที่จังหวัดคาดประมาณ (ราย) — ใช้เป็นตัวหารของ Treatment Coverage ด้วย",
  },
  {
    id: "coverage",
    label: "Treatment Coverage",
    unit: "percent",
    hint: "ผู้ป่วยใหม่+กลับเป็นซ้ำ ÷ เป้าจำนวนผู้ป่วย × 100 (เป้าเดิม ≥ 88%)",
  },
  {
    id: "success_rate",
    label: "Treatment Success Rate",
    unit: "percent",
    hint: "(หาย + รักษาครบ) ÷ ผู้ที่สรุปผลแล้ว × 100 (เป้าเดิม ≥ 88%)",
  },
  {
    id: "death_rate",
    label: "อัตราเสียชีวิต",
    unit: "percent",
    lowerIsBetter: true,
    hint: "เสียชีวิต ÷ ผู้ที่สรุปผลแล้ว × 100 (ยิ่งต่ำยิ่งดี)",
  },
];
