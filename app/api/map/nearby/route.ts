// GET /api/map/nearby?patient=&radius= — คนที่อยู่รอบบ้านผู้ป่วย + วงที่แนะนำ (admin — มีเลขบัตร)
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { badRequest, HttpError, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { nearbyPeople } from "@/lib/repo/map";

export const GET = route(async (req) => {
  const u = await requireAdmin();
  if (!(await rateLimit(`map-nearby:${u.id}`, 60, 60)).ok) throw new HttpError(429, "ค้นบ่อยเกินไป กรุณารอสักครู่");
  const q = new URL(req.url).searchParams;
  const patient = q.get("patient") ?? "";
  if (!/^P[0-9a-f]{10}$/.test(patient)) throw badRequest("รหัสผู้ป่วยไม่ถูกต้อง");
  return Response.json(await nearbyPeople(tbDb, patient, Number(q.get("radius") ?? 200)));
});
