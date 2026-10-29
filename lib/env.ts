// lib/env.ts — ตรวจ env ครั้งเดียวตอน start (เรียกจาก instrumentation.ts) เพื่อ fail fast
//   REQUIRED ขาดแล้วแอปทำงานไม่ได้ → throw
//   OPTIONAL ขาดแล้วเฉพาะบางฟีเจอร์ใช้ไม่ได้ → warn

const REQUIRED_ENV = [
  "TB_DB_PASSWORD",
  "SESSION_SECRET",
] as const;

const OPTIONAL_ENV = [
  // HOSxP (ค้นหาตาม HN) — ไม่มีก็ยังคีย์ทะเบียนได้
  "HOSXP_DB_HOST",
  "HOSXP_DB_USER",
  "HOSXP_DB_PASSWORD",
  "HOSXP_DB_NAME",
  // Google Sheet mirror
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "TB_SPREADSHEET_ID",
  // แท็บแผนที่: Sheet พิกัดบ้าน (pikad)
  "PIKAD_SPREADSHEET_ID",
  // แจ้งเตือน LINE OA / อีเมล — token อยู่ใน env เท่านั้น ห้ามเก็บใน DB
  "LINE_CHANNEL_ACCESS_TOKEN",
  "SMTP_HOST",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`[env] ขาด environment variable ที่จำเป็น: ${missing.join(", ")}`);
  }

  if ((process.env.SESSION_SECRET ?? "").length < 32) {
    throw new Error("[env] SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร");
  }

  const missingOptional = OPTIONAL_ENV.filter((k) => !process.env[k]);
  if (missingOptional.length > 0) {
    console.warn(`[env] ⚠️  ขาด env ของฟีเจอร์เสริม (ฟีเจอร์ที่เกี่ยวข้องจะใช้ไม่ได้): ${missingOptional.join(", ")}`);
  }
}
