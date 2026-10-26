// lib/sheetLocks.ts — หา protected range ที่ระบบนี้ใส่ไว้ใน Google Sheet (ใช้ถอดล็อก)
// นับเป็น "ของระบบ" เมื่อ description ตรงกับที่ระบบใส่ หรือผู้แก้ไขได้มีแค่ service account คนเดียว
// (คนในทีมถอดเองไม่ได้ถ้าไม่ใช่เจ้าของไฟล์ — ต้องใช้ service account ถอด)

export const PROTECT_DESC = "เขียนโดยระบบทะเบียนวัณโรคเท่านั้น — แก้ข้อมูลที่เว็บแอป";

export interface ProtectedRangeLike {
  protectedRangeId?: number | null;
  description?: string | null;
  editors?: { users?: string[] | null; groups?: string[] | null; domainUsersCanEdit?: boolean | null } | null;
}

export function isOurLock(p: ProtectedRangeLike, serviceAccount: string | undefined): boolean {
  if (p.protectedRangeId == null) return false;
  if (p.description === PROTECT_DESC) return true;
  const users = (p.editors?.users ?? []).map((u) => u.toLowerCase());
  return !!serviceAccount && users.length === 1 && users[0] === serviceAccount.toLowerCase()
    && !(p.editors?.groups ?? []).length && !p.editors?.domainUsersCanEdit;
}
