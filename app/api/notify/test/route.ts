// POST /api/notify/test {channel: "line"|"email"} — ส่งข้อความทดสอบ (admin)
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { HttpError, readJson, route } from "@/lib/http";
import { sendEmail, sendLine } from "@/lib/notify";
import { rateLimit } from "@/lib/rateLimit";
import type { Row } from "@/lib/repo/common";

export const POST = route(async (req) => {
  const u = await requireAdmin();
  if (!(await rateLimit(`notify-test:${u.id}`, 5, 600)).ok) throw new HttpError(429, "ทดสอบบ่อยเกินไป");
  const { channel } = await readJson(req, z.object({ channel: z.enum(["line", "email"]) }));
  const text = `✅ ทดสอบการแจ้งเตือนจากระบบทะเบียนวัณโรค รพ.พลับพลาชัย (โดย ${u.displayName})`;
  try {
    if (channel === "line") {
      await sendLine(text);
      return Response.json({ message: "ส่ง LINE แล้ว" });
    }
    const [r] = await tbDb.query<Row[]>("SELECT v FROM tb_settings WHERE k = 'reminder_emails'");
    const to = String(r[0]?.v ?? "").split(/[,\s;]+/).filter((e) => /@/.test(e));
    await sendEmail(to, "[ทะเบียน TB] ทดสอบการแจ้งเตือน", `<p style="font-family:sans-serif">${text}</p>`);
    return Response.json({ message: `ส่งอีเมลแล้วถึง ${to.length} คน` });
  } catch (err) {
    throw new HttpError(502, `ส่งไม่สำเร็จ: ${(err as Error).message}`);
  }
});
