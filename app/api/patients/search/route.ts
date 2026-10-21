// GET /api/patients/search?q= — ค้นผู้ป่วย index (HN หรือชื่อ) สำหรับเพิ่มผู้สัมผัส — คืนเฉพาะช่องที่จำเป็น
import { requireUser } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { route } from "@/lib/http";
import { searchPatients } from "@/lib/repo/data";

export const GET = route(async (req) => {
  await requireUser();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ patients: await searchPatients(tbDb, q.slice(0, 100)) });
});
