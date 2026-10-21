// PUT /api/patients/:id — แก้ไข (พร้อมช่องติดตามระหว่างรักษา), DELETE — ลบแบบ soft delete (admin)
import { actorOf, versionParam, withVersion } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { deletePatient, updatePatient } from "@/lib/repo/patients";
import { patientInput } from "@/lib/validation";

export const PUT = route(async (req, ctx: RouteContext<"/api/patients/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  const { data, version } = await readJson(req, withVersion(patientInput));
  return Response.json(await withTransaction((conn) => updatePatient(conn, id, version, data, actor)));
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/patients/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  await withTransaction((conn) => deletePatient(conn, id, versionParam(req), actor));
  return Response.json({ ok: true });
});
