// POST /api/contacts — เพิ่มผู้สัมผัส (unit: เฉพาะหน่วยตัวเอง)
import { actorOf, withVersion } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { createContact } from "@/lib/repo/contacts";
import { contactInput } from "@/lib/validation";

export const POST = route(async (req) => {
  const actor = actorOf(await requireUser(), req);
  const { data } = await readJson(req, withVersion(contactInput));
  return Response.json(await withTransaction((conn) => createContact(conn, data, actor)), { status: 201 });
});
