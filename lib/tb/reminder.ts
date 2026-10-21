// lib/tb/reminder.ts — ข้อความแจ้งนัดทุกเช้า 07:00 (dailyReminder เดิม): ขาดนัด / วันนี้ / พรุ่งนี้
// LINE: แสดงไม่เกิน 15 รายต่อกลุ่ม, ข้อความ ≤ 4,900 ตัวอักษร; อีเมล: ตาราง HTML

import { addDays, formatThaiDate, type IsoDate } from "./dates.ts";

export interface ReminderItem {
  appt: IsoDate;
  kind: "ผู้ป่วย" | "ผู้สัมผัส";
  name: string;
  hn: string;
  unit: string;
  phone: string;
  last: string; // "วันที่ ประเภท" ของบันทึกครั้งล่าสุด
}

export interface ReminderGroups {
  missed: ReminderItem[];
  today: ReminderItem[];
  tomorrow: ReminderItem[];
}

export function reminderGroups(items: readonly ReminderItem[], today: IsoDate): ReminderGroups {
  const tmr = addDays(today, 1);
  const byDate = (a: ReminderItem, b: ReminderItem) => (a.appt < b.appt ? -1 : a.appt > b.appt ? 1 : 0);
  return {
    missed: items.filter((a) => a.appt < today).sort(byDate),
    today: items.filter((a) => a.appt === today),
    tomorrow: items.filter((a) => a.appt === tmr),
  };
}

export const hasReminders = (g: ReminderGroups) => g.missed.length + g.today.length + g.tomorrow.length > 0;

const MAX_PER_GROUP = 15;
const LINE_LIMIT = 4900;
const th = (d: IsoDate) => formatThaiDate(d, "long");

export function lineText(g: ReminderGroups, today: IsoDate): string {
  const list = (l: ReminderItem[], showDate: boolean) =>
    l.slice(0, MAX_PER_GROUP)
      .map((a) => `• ${a.name} (${a.kind}${a.unit ? ` · ${a.unit}` : ""})${showDate ? ` นัด ${th(a.appt)}` : ""}`)
      .join("\n") + (l.length > MAX_PER_GROUP ? `\n…และอีก ${l.length - MAX_PER_GROUP} ราย` : "");
  const text =
    `📅 สรุปนัด TB ${th(today)}\n` +
    (g.today.length ? `\nนัดวันนี้ ${g.today.length} ราย\n${list(g.today, false)}` : "\nนัดวันนี้: ไม่มี") +
    (g.tomorrow.length ? `\n\nนัดพรุ่งนี้ ${g.tomorrow.length} ราย\n${list(g.tomorrow, false)}` : "") +
    (g.missed.length ? `\n\n⚠ ขาดนัด ${g.missed.length} ราย\n${list(g.missed, true)}` : "");
  return text.slice(0, LINE_LIMIT);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emailSubject(g: ReminderGroups, today: IsoDate): string {
  return `[ทะเบียน TB] นัดวันนี้ ${g.today.length} · พรุ่งนี้ ${g.tomorrow.length} · ขาดนัด ${g.missed.length} (${formatThaiDate(today)})`;
}

export function emailHtml(g: ReminderGroups): string {
  const table = (title: string, l: ReminderItem[], color: string) =>
    l.length
      ? `<h3 style="color:${color}">${title} (${l.length})</h3>` +
        '<table border="1" cellpadding="5" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">' +
        '<tr style="background:#e6efec"><th>วันนัด</th><th>ชื่อ</th><th>ประเภท</th><th>HN</th><th>หน่วย</th><th>โทร</th><th>ครั้งล่าสุด</th></tr>' +
        l.map((a) => `<tr><td>${th(a.appt)}</td><td>${esc(a.name)}</td><td>${a.kind}</td><td>${esc(a.hn)}</td><td>${esc(a.unit)}</td><td>${esc(a.phone)}</td><td>${esc(a.last)}</td></tr>`).join("") +
        "</table>"
      : "";
  return (
    '<div style="font-family:sans-serif">' +
    table("ขาดนัด", g.missed, "#b42318") + table("นัดวันนี้", g.today, "#1d4d40") + table("นัดพรุ่งนี้", g.tomorrow, "#a15c07") +
    '<p style="color:#888;font-size:12px">ส่งอัตโนมัติจากระบบทะเบียนวัณโรค รพ.พลับพลาชัย</p></div>'
  );
}
