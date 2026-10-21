// POST /api/contacts/:id/convert — ผู้สัมผัสป่วย → ลงทะเบียนเป็นผู้ป่วยรายใหม่ (admin, transaction เดียว)
import { z } from "zod";
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { convertContactToPatient } from "@/lib/repo/contacts";
import { date } from "@/lib/validation";

export const POST = route(async (req, ctx: RouteContext<"/api/contacts/[id]/convert">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  const { startDate } = await readJson(req, z.object({ startDate: date }));
  return Response.json(await withTransaction((conn) => convertContactToPatient(conn, id, startDate, actor)), { status: 201 });
});
