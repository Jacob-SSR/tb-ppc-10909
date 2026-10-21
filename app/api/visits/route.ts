// POST /api/visits — บันทึกการรักษา/ติดตาม (ส่งซ้ำด้วย client_uuid เดิมได้ ไม่สร้างซ้ำ)
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { createVisit } from "@/lib/repo/visits";
import { visitInput } from "@/lib/validation";

export const POST = route(async (req) => {
  const actor = actorOf(await requireUser(), req);
  const data = await readJson(req, visitInput);
  const out = await withTransaction((conn) => createVisit(conn, data, actor));
  return Response.json(out, { status: out.duplicate ? 200 : 201 });
});
