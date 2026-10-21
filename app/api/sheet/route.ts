// GET /api/sheet — สถานะคิวส่ง Google Sheet, POST — rebuild ทุกแท็บเดี๋ยวนี้ (admin)
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { clientIp, HttpError, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import type { Row } from "@/lib/repo/common";
import { sheetsConfigured } from "@/lib/sheets";
import { Mirror } from "@/lib/worker/mirror";
import { googleSheetApi } from "@/lib/worker/sheetApi";

export const GET = route(async () => {
  await requireAdmin();
  const [[r]] = await tbDb.query<Row[]>(
    `SELECT COUNT(*) AS pending, MIN(created_at) AS oldest, MAX(attempts) AS max_attempts,
            (SELECT last_error FROM tb_sheet_outbox WHERE sent_at IS NULL AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error,
            (SELECT MAX(sent_at) FROM tb_sheet_outbox) AS last_sent
       FROM tb_sheet_outbox WHERE sent_at IS NULL`,
  );
  return Response.json({ configured: sheetsConfigured(), ...r }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (req) => {
  const u = await requireAdmin();
  if (!sheetsConfigured()) throw new HttpError(503, "ยังไม่ได้ตั้งค่า Google Sheet");
  if (!(await rateLimit("sheet-rebuild", 3, 600)).ok) throw new HttpError(429, "เพิ่ง rebuild ไป กรุณารอสักครู่");
  const mirror = new Mirror(googleSheetApi(), tbDb);
  await mirror.ensureTabs(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const counts = await mirror.rebuild();
  await writeAudit(tbDb, { userId: u.id, action: "sheet_rebuild", entity: "system", changes: counts, ip: clientIp(req) });
  return Response.json({ ok: true, counts });
});
