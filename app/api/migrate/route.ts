// POST /api/migrate — ย้ายข้อมูลจากระบบเดิม (admin) — ทำแบบเดียวกับ scripts/import-from-sheet.ts จากเว็บ
//   multipart: dry=1|0, file=.xlsx (ไม่ส่งไฟล์ = อ่านจาก Google Sheet ตรงด้วย service account)
// dry = ทำจริงทุกขั้นใน transaction แล้ว ROLLBACK → ตัวเลขตรงกับตอนบันทึกจริง
import { actorOf } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { HttpError } from "@/lib/errors";
import { badRequest, route } from "@/lib/http";
import { runMigration, tabsFromSheet, tabsFromXlsx } from "@/lib/migrateSheet";
import { rateLimit } from "@/lib/rateLimit";
import { sheetsConfigured } from "@/lib/sheets";

const MAX_BYTES = 10 * 1024 * 1024;

export const POST = route(async (req) => {
  const user = await requireAdmin();
  if (!(await rateLimit(`migrate:${user.id}`, 20, 600)).ok) throw new HttpError(429, "สั่งบ่อยเกินไป กรุณารอสักครู่");
  const form = await req.formData();
  const dry = form.get("dry") !== "0";
  const file = form.get("file");

  let tabs;
  let warnings: string[] = [];
  let source: string;
  if (file instanceof File && file.size) {
    if (file.size > MAX_BYTES) throw badRequest("ไฟล์ใหญ่เกิน 10 MB");
    try {
      tabs = await tabsFromXlsx(await file.arrayBuffer());
    } catch {
      throw badRequest("อ่านไฟล์ไม่ได้ — ต้องเป็น .xlsx ที่ดาวน์โหลดจาก Google Sheet");
    }
    source = file.name;
  } else {
    if (!sheetsConfigured()) throw new HttpError(503, "ยังไม่ได้ตั้งค่า Google Sheet (GOOGLE_* + TB_SPREADSHEET_ID) — เลือกไฟล์ .xlsx แทน");
    ({ tabs, warnings } = await tabsFromSheet());
    source = "Google Sheet";
  }
  if (!tabs.DB_Patients?.length && !tabs.DB_Contacts?.length) {
    throw badRequest(`ไม่พบข้อมูลในแท็บ DB_Patients / DB_Contacts${warnings.length ? ` (${warnings.join("; ")})` : ""}`);
  }
  const result = await runMigration(tabs, actorOf(user, req), dry);
  return Response.json({ ...result, source, warnings });
});
