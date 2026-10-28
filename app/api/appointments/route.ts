// POST /api/appointments — เพิ่มนัด (unit: เฉพาะผู้สัมผัสในเขต) · มี hosxp_oapp_id = ดึงนัดจาก HOSxP (admin, ซ้ำ = อัปเดต)
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { createAppointment } from "@/lib/repo/appointments";
import { appointmentInput } from "@/lib/validation";

export const POST = route(async (req) => {
  const actor = actorOf(await requireUser(), req);
  const data = await readJson(req, appointmentInput);
  const out = await withTransaction((conn) => createAppointment(conn, data, actor));
  return Response.json(out, { status: out.existing ? 200 : 201 });
});
