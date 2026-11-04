// GET /api/map/nearby?patient=&radius= — คนที่อยู่รอบบ้านผู้ป่วย + วงที่แนะนำ (admin — มีเลขบัตร)
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { badRequest, HttpError, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { nearbyPeople } from "@/lib/repo/map";
import { actorOf } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { mapWorkbook } from "@/lib/tb/mapExport";

export const GET = route(async (req) => {
  const u = await requireAdmin();
  if (!(await rateLimit(`map-nearby:${u.id}`, 60, 60)).ok) throw new HttpError(429, "ค้นบ่อยเกินไป กรุณารอสักครู่");
  const q = new URL(req.url).searchParams;
  const patients = [...new Set((q.get("patients") ?? q.get("patient") ?? "").split(","))];
  if (!patients.length || patients.some(p => !/^P[0-9a-f]{10}$/.test(p))) throw badRequest("รหัสผู้ป่วยไม่ถูกต้อง");
  const result = await nearbyPeople(tbDb, patients, Number(q.get("radius") ?? 200));
  if (q.get("format") !== "xlsx") return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  if (result.error) throw new HttpError(503, result.error);
  const people = result.people.filter(p => q.get("onlyNew") !== "1" || (!p.contactId && !p.patientId));
  const buf = await mapWorkbook(people);
  await writeAudit(tbDb, { userId: u.id, action: "export", entity: "system", changes: { source: "map", patients, radius: result.radius, rows: people.length }, ip: actorOf(u, req).ip });
  return new Response(new Uint8Array(buf), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="map-nearby.xlsx"; filename*=UTF-8''${encodeURIComponent(`คนรอบบ้าน_${patients.length}คน.xlsx`)}`,
    "Cache-Control": "no-store",
  } });
});
