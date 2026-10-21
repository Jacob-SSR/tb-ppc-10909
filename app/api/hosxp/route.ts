// GET /api/hosxp?hn= | ?cid= — ดึงชื่อ/เพศ/อายุ/สิทธิ์/ที่อยู่/เบอร์จาก HOSxP (admin, อ่านอย่างเดียว)
// จำกัดเฉพาะทีม รพ. — HOSxP มีข้อมูลผู้ป่วยทั้งโรงพยาบาล ไม่ให้ รพ.สต. ค้นใครก็ได้
import { requireAdmin } from "@/lib/auth/session";
import { findHosxpPatient, hosxpConfigured } from "@/lib/hosxp";
import { badRequest, HttpError, notFound, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";

export const GET = route(async (req) => {
  const u = await requireAdmin();
  if (!hosxpConfigured()) throw new HttpError(503, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ HOSxP");
  if (!(await rateLimit(`hosxp:${u.id}`, 60, 60)).ok) throw new HttpError(429, "ค้นบ่อยเกินไป กรุณารอสักครู่");
  const sp = new URL(req.url).searchParams;
  const hn = sp.get("hn")?.trim();
  const cid = sp.get("cid")?.replace(/\D/g, "");
  if (!hn && !cid) throw badRequest("ระบุ HN หรือเลขบัตรประชาชน");
  if (hn && !/^[0-9A-Za-z-]{1,12}$/.test(hn)) throw badRequest("HN ไม่ถูกต้อง");
  if (!hn && !/^\d{13}$/.test(cid ?? "")) throw badRequest("เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก");
  try {
    const p = await findHosxpPatient(hn ? { hn } : { cid });
    if (!p) throw notFound("ไม่พบใน HOSxP");
    return Response.json(p);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("[hosxp]", err);
    throw new HttpError(503, "เชื่อมต่อ HOSxP ไม่ได้ (อาจปิดปรับปรุง) — กรอกข้อมูลเองได้");
  }
});
