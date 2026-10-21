// PUT /api/contacts/:id — แก้ไข (unit: เฉพาะในเขต), DELETE — ลบ (admin)
import { actorOf, versionParam, withVersion } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { deleteContact, updateContact } from "@/lib/repo/contacts";
import { contactInput } from "@/lib/validation";

export const PUT = route(async (req, ctx: RouteContext<"/api/contacts/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  const { data, version } = await readJson(req, withVersion(contactInput));
  return Response.json(await withTransaction((conn) => updateContact(conn, id, version, data, actor)));
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/contacts/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  await withTransaction((conn) => deleteContact(conn, id, versionParam(req), actor));
  return Response.json({ ok: true });
});
