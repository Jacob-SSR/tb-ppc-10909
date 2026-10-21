// lib/auth/password.ts — bcrypt เท่านั้น (ห้ามเก็บรหัส/PIN เป็นข้อความ)
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcrypt";

const COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * เทียบรหัสกับ hash หลอกเมื่อไม่พบ username — ให้เวลาตอบใกล้เคียงกับกรณีพบ
 * จะได้เดาไม่ได้ว่า username ไหนมีอยู่จริงจากเวลาที่ใช้
 */
export async function burnPasswordCheck(pw: string): Promise<false> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), COST);
  await bcrypt.compare(pw, await dummyHash);
  return false;
}

/** ตรวจความแข็งแรงขั้นต่ำ — คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
export function passwordProblem(pw: string, username?: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  if (pw.length > 72) return "รหัสผ่านยาวเกิน 72 ตัวอักษร";
  if (/^\d+$/.test(pw)) return "รหัสผ่านต้องไม่เป็นตัวเลขล้วน";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ในนั้น";
  return null;
}

/** รหัสชั่วคราวสำหรับ admin สร้าง/reset บัญชี (ผู้ใช้ต้องเปลี่ยนตอน login ครั้งแรก) */
export function temporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ตัดตัวที่สับสน 0/O 1/l/I
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[randomInt(chars.length)];
  return s;
}
