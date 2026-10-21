// GET /api/data — ข้อมูลทั้งหมดของหน้าเว็บ (กรองตามสิทธิ์ที่ SQL)
import { actorOf } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { route } from "@/lib/http";
import { loadAppData } from "@/lib/repo/data";

export const GET = route(async (req) => {
  const u = await requireUser();
  const data = await loadAppData(tbDb, actorOf(u, req));
  return Response.json(
    {
      ...data,
      user: { id: u.id, username: u.username, displayName: u.displayName, unitId: u.unitId, unitName: u.unitName, role: u.role },
      features: {
        hosxp: !!process.env.HOSXP_DB_HOST,
        line: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
        email: !!process.env.SMTP_HOST,
        sheet: !!process.env.TB_SPREADSHEET_ID,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
