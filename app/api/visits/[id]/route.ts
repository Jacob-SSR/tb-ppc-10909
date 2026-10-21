// PUT /api/visits/:id — แก้บันทึก (unit: เฉพาะที่หน่วยตัวเองบันทึก), DELETE — ลบ (admin)
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { deleteVisit, updateVisit } from "@/lib/repo/visits";
import { visitInput } from "@/lib/validation";

export const PUT = route(async (req, ctx: RouteContext<"/api/visits/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  const data = await readJson(req, visitInput);
  return Response.json(await withTransaction((conn) => updateVisit(conn, id, data, actor)));
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/visits/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  await withTransaction((conn) => deleteVisit(conn, id, actor));
  return Response.json({ ok: true });
});
