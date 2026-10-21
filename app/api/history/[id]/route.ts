// GET /api/history/:id — ประวัติการแก้ไขของผู้ป่วย/ผู้สัมผัส
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { route } from "@/lib/http";
import { loadHistory } from "@/lib/repo/history";

export const GET = route(async (req, ctx: RouteContext<"/api/history/[id]">) => {
  const actor = actorOf(await requireUser(), req);
  const { id } = await ctx.params;
  return Response.json({ rows: await loadHistory(tbDb, id, actor) });
});
