// POST /api/patients — ลงทะเบียนผู้ป่วยใหม่ (admin)
import { actorOf, withVersion } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { createPatient } from "@/lib/repo/patients";
import { patientInput } from "@/lib/validation";

export const POST = route(async (req) => {
  const actor = actorOf(await requireUser(), req);
  const { data } = await readJson(req, withVersion(patientInput));
  const out = await withTransaction((conn) => createPatient(conn, data, actor));
  return Response.json(out, { status: 201 });
});
