// GET /api/map — พิกัดผู้ป่วยทุกราย (admin): จากทะเบียน หรือจับคู่จาก Sheet พิกัดบ้าน · ?fresh=1 อ่าน Sheet ใหม่
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { route } from "@/lib/http";
import { mapPoints } from "@/lib/repo/map";

export const GET = route(async (req) => {
  await requireAdmin();
  return Response.json(await mapPoints(tbDb, new URL(req.url).searchParams.get("fresh") === "1"));
});
