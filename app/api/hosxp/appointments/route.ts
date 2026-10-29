// GET /api/hosxp/appointments?hn= — นัดใน HOSxP (oapp) ของ HN ตั้งแต่ 30 วันก่อน (admin, อ่านอย่างเดียว)
// แต่ละรายการบอกว่าดึงเข้าระบบแล้วหรือยัง (imported = id ของนัดในระบบ)
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { findHosxpAppointments, hosxpConfigured } from "@/lib/hosxp";
import { badRequest, HttpError, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import type { Row } from "@/lib/repo/common";
import { addDays, todayBangkok } from "@/lib/tb/dates";

export const GET = route(async (req) => {
  const u = await requireAdmin();
  if (!hosxpConfigured()) throw new HttpError(503, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ HOSxP");
  if (!(await rateLimit(`hosxp:${u.id}`, 60, 60)).ok) throw new HttpError(429, "ค้นบ่อยเกินไป กรุณารอสักครู่");
  const hn = new URL(req.url).searchParams.get("hn")?.trim();
  if (!hn || !/^[0-9A-Za-z-]{1,12}$/.test(hn)) throw badRequest("HN ไม่ถูกต้อง");
  let list;
  try {
    list = await findHosxpAppointments(hn, addDays(todayBangkok(), -30));
  } catch (err) {
    console.error("[hosxp appointments]", err);
    throw new HttpError(503, "เชื่อมต่อ HOSxP ไม่ได้ (อาจปิดปรับปรุง)");
  }
  const ids = list.map((a) => a.oapp_id);
  const [rows] = ids.length
    ? await tbDb.query<Row[]>(
        `SELECT id, hosxp_oapp_id FROM tb_appointments WHERE deleted_at IS NULL AND hosxp_oapp_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      )
    : [[] as Row[]];
  const imported = new Map(rows.map((r) => [String(r.hosxp_oapp_id), String(r.id)]));
  return Response.json({ appointments: list.map((a) => ({ ...a, imported: imported.get(a.oapp_id) ?? null })) });
});
