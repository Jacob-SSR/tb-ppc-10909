import { requireAdmin } from "@/lib/auth/session";
import { hosxpConfigured } from "@/lib/hosxp";
import { readAppointmentOptions } from "@/lib/hosxpAppointmentOptions";
import { HttpError, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";

export const GET = route(async () => {
  const u = await requireAdmin();
  if (!hosxpConfigured()) throw new HttpError(503, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ HOSxP");
  if (!(await rateLimit(`hosxp-options:${u.id}`, 30, 60)).ok) throw new HttpError(429, "กรุณารอสักครู่แล้วลองใหม่");
  try {
    return Response.json(await readAppointmentOptions(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[hosxp appointment options]", err);
    throw new HttpError(503, "อ่านรายการนัดจาก HOSxP ไม่สำเร็จ สามารถพิมพ์ข้อมูลนัดเองได้");
  }
});
