// POST /api/import — นำเข้า Excel (admin) multipart: file, kind=patient|contact, dry=1 (ดูตัวอย่าง ไม่บันทึก)
// dry run ทำงานจริงทุกขั้นใน transaction แล้ว ROLLBACK → ตัวเลข เพิ่ม/อัปเดต/ข้าม ตรงกับตอนบันทึกจริง
import { actorOf } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { tbDb } from "@/lib/db";
import { readWorkbook } from "@/lib/excel";
import { badRequest, route } from "@/lib/http";
import { rateLimit } from "@/lib/rateLimit";
import { HttpError } from "@/lib/errors";
import { importRecords } from "@/lib/repo/importer";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 3000;
const SHEET_HINT = { patient: ["ผู้ป่วย", "patient"], contact: ["ผู้สัมผัส", "contact"] } as const;

export const POST = route(async (req) => {
  const user = await requireAdmin();
  if (!(await rateLimit(`import:${user.id}`, 30, 600)).ok) throw new HttpError(429, "นำเข้าบ่อยเกินไป กรุณารอสักครู่");
  const form = await req.formData();
  const file = form.get("file");
  const kind = form.get("kind");
  const dry = form.get("dry") === "1";
  if (!(file instanceof File)) throw badRequest("กรุณาเลือกไฟล์");
  if (file.size > MAX_BYTES) throw badRequest("ไฟล์ใหญ่เกิน 5 MB");
  if (kind !== "patient" && kind !== "contact") throw badRequest("ระบุชนิดข้อมูลไม่ถูกต้อง");

  let sheets;
  try {
    sheets = await readWorkbook(await file.arrayBuffer());
  } catch {
    throw badRequest("อ่านไฟล์ไม่ได้ — รองรับเฉพาะ .xlsx");
  }
  const sheet = sheets.find((s) => SHEET_HINT[kind].some((h) => s.name.toLowerCase().includes(h))) ?? sheets[0];
  if (!sheet) throw badRequest("ไม่พบแผ่นงานในไฟล์");
  if (sheet.records.length > MAX_ROWS) throw badRequest(`มีมากกว่า ${MAX_ROWS} แถว กรุณาแบ่งไฟล์`);

  const conn = await tbDb.getConnection();
  try {
    await conn.beginTransaction();
    const report = await importRecords(conn, kind, sheet.records, actorOf(user, req), "excel");
    if (dry) {
      await conn.rollback();
    } else {
      await conn.query(
        "INSERT INTO tb_audit_log (user_id, action, entity, changes, ip) VALUES (?, 'import', 'system', ?, ?)",
        [user.id, JSON.stringify({ file: file.name, sheet: sheet.name, kind, added: report.added, updated: report.updated, skipped: report.skipped.length }), actorOf(user, req).ip],
      );
      await conn.commit();
    }
    return Response.json({ ...report, sheet: sheet.name, dry });
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
});
