// PUT /api/appointments/:id — แก้ / เลื่อน / มาตามนัด / ยกเลิก ({data, version}) · DELETE ?version= — ลบ (admin)
import { actorOf, versionParam, withVersion } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { deleteAppointment, updateAppointment } from "@/lib/repo/appointments";
import { appointmentInput } from "@/lib/validation";

export const PUT = route(async (req, ctx: RouteContext<"/api/appointments/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  const { data, version } = await readJson(req, withVersion(appointmentInput));
  return Response.json(await withTransaction((conn) => updateAppointment(conn, id, version, data, actor)));
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/appointments/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  await withTransaction((conn) => deleteAppointment(conn, id, versionParam(req), actor));
  return Response.json({ ok: true });
});
