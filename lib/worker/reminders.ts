// lib/worker/reminders.ts — แจ้งนัดทุกเช้า 07:00 (LINE OA broadcast + อีเมล) และแจ้งคิว Sheet ค้าง
import type { Queryable } from "../audit.ts";
import { emailConfigured, lineConfigured, sendEmail, sendLine } from "../notify.ts";
import type { Row } from "../repo/common.ts";
import { latestAppointments } from "../tb/appointments.ts";
import { formatThaiDate, type IsoDate } from "../tb/dates.ts";
import { emailHtml, emailSubject, hasReminders, lineText, reminderGroups, type ReminderItem } from "../tb/reminder.ts";
import { isConcluded } from "../tb/tasks.ts";

export async function buildReminderItems(db: Queryable): Promise<ReminderItem[]> {
  const [visits] = await db.query<Row[]>(
    "SELECT id, patient_id, contact_id, visit_date, visit_type, detail, next_appt, updated_at FROM tb_visits WHERE deleted_at IS NULL",
  );
  const [patients] = await db.query<Row[]>("SELECT id, name, hn, phone, outcome, unit_id FROM tb_patients WHERE deleted_at IS NULL");
  const [contacts] = await db.query<Row[]>("SELECT id, name, hn, phone, unit_id FROM tb_contacts WHERE deleted_at IS NULL");
  const [units] = await db.query<Row[]>("SELECT id, name FROM tb_units");
  const P = new Map(patients.map((p) => [p.id as string, p]));
  const C = new Map(contacts.map((c) => [c.id as string, c]));
  const U = new Map(units.map((u) => [Number(u.id), String(u.name)]));

  const appts = latestAppointments(visits as never, (pid) => !isConcluded(P.get(pid)?.outcome as string | undefined));
  return appts.flatMap((a) => {
    const rec = a.kind === "P" ? P.get(a.refId) : C.get(a.refId);
    if (!rec) return [];
    return [{
      appt: a.appt,
      kind: a.kind === "P" ? "ผู้ป่วย" : "ผู้สัมผัส",
      name: String(rec.name),
      hn: String(rec.hn ?? ""),
      unit: U.get(Number(rec.unit_id)) ?? "",
      phone: String(rec.phone ?? ""),
      last: `${formatThaiDate(a.last.visit_date)} ${a.last.visit_type}`,
    } satisfies ReminderItem];
  });
}

export async function sendDailyReminder(db: Queryable, today: IsoDate): Promise<string> {
  const g = reminderGroups(await buildReminderItems(db), today);
  if (!hasReminders(g)) return "ไม่มีนัด — ไม่ส่ง";
  const done: string[] = [];
  if (lineConfigured()) {
    await sendLine(lineText(g, today));
    done.push("LINE");
  }
  if (emailConfigured()) {
    const [r] = await db.query<Row[]>("SELECT v FROM tb_settings WHERE k = 'reminder_emails'");
    const to = String(r[0]?.v ?? "").split(/[,\s;]+/).filter((e) => /@/.test(e));
    if (to.length) {
      await sendEmail(to, emailSubject(g, today), emailHtml(g));
      done.push(`อีเมล ${to.length} คน`);
    }
  }
  return done.length ? `ส่งแล้ว: ${done.join(", ")}` : "ยังไม่ได้ตั้งช่องทางแจ้งเตือน";
}

/** คิว Sheet ค้างเกิน 1 ชม. → แจ้ง LINE (§7) */
export async function checkStaleOutbox(db: Queryable): Promise<{ pending: number; oldest: string | null }> {
  const [[r]] = await db.query<Row[]>(
    "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM tb_sheet_outbox WHERE sent_at IS NULL AND created_at < NOW() - INTERVAL 1 HOUR",
  );
  return { pending: Number(r.n), oldest: (r.oldest as string | null) ?? null };
}
