// PUT /api/settings — เป้าหมายรายตัวชี้วัด/ไตรมาส + อีเมลรับแจ้งเตือน (admin)
import { actorOf } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { saveSettings, settingsInput } from "@/lib/repo/settings";

export const PUT = route(async (req) => {
  const actor = actorOf(await requireAdmin(), req);
  const data = await readJson(req, settingsInput);
  await withTransaction((conn) => saveSettings(conn, data, actor));
  return Response.json({ ok: true });
});
