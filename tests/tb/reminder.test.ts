import assert from "node:assert/strict";
import { test } from "node:test";
import { emailHtml, emailSubject, hasReminders, lineText, reminderGroups, type ReminderItem } from "../../lib/tb/reminder.ts";

const item = (appt: string, name: string, kind: ReminderItem["kind"] = "ผู้ป่วย"): ReminderItem =>
  ({ appt, kind, name, hn: "1", unit: "รพ.สต.ตาพระ", phone: "081", last: "1/10/2569 เยี่ยมบ้าน" });

test("reminderGroups: ขาดนัด / วันนี้ / พรุ่งนี้ (ไม่รวมนัดถัดไป)", () => {
  const g = reminderGroups([item("2026-10-22", "ข"), item("2026-10-19", "ก"), item("2026-10-21", "ค"), item("2026-10-25", "ง"), item("2026-10-18", "จ")], "2026-10-21");
  assert.deepEqual(g.missed.map((x) => x.name), ["จ", "ก"]);
  assert.deepEqual(g.today.map((x) => x.name), ["ค"]);
  assert.deepEqual(g.tomorrow.map((x) => x.name), ["ข"]);
  assert.equal(hasReminders(reminderGroups([item("2026-10-25", "ง")], "2026-10-21")), false);
});

test("lineText: หัวข้อ พ.ศ., ไม่เกิน 15 รายต่อกลุ่ม, ความยาว ≤ 4900", () => {
  const many = Array.from({ length: 20 }, (_, i) => item("2026-10-21", `คนที่${i + 1}`));
  const t = lineText(reminderGroups(many, "2026-10-21"), "2026-10-21");
  assert.match(t, /สรุปนัด TB 21 ต\.ค\. 2569/);
  assert.match(t, /นัดวันนี้ 20 ราย/);
  assert.match(t, /…และอีก 5 ราย/);
  assert.equal((t.match(/^• /gm) ?? []).length, 15);
  assert.ok(t.length <= 4900);
  const huge = Array.from({ length: 15 }, (_, i) => item("2026-10-01", "ก".repeat(400) + i));
  assert.ok(lineText(reminderGroups(huge, "2026-10-21"), "2026-10-21").length <= 4900);
});

test("อีเมล: escape HTML ชื่อ, หัวเรื่องมีจำนวน", () => {
  const g = reminderGroups([item("2026-10-21", "<script>x</script>"), item("2026-10-20", "ก", "ผู้สัมผัส")], "2026-10-21");
  assert.equal(emailSubject(g, "2026-10-21"), "[ทะเบียน TB] นัดวันนี้ 1 · พรุ่งนี้ 0 · ขาดนัด 1 (21/10/2569)");
  const h = emailHtml(g);
  assert.ok(!h.includes("<script>"));
  assert.ok(h.includes("&lt;script&gt;"));
});
