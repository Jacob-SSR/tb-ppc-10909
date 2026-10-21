// lib/repo/settings.ts — ค่าตั้ง (tb_settings) + เป้าหมายรายตัวชี้วัด/ไตรมาส (tb_targets) — admin
// LINE token อยู่ใน env เท่านั้น ห้ามเก็บที่นี่
import { z } from "zod";
import { type Changes, type Queryable, writeAudit } from "../audit.ts";
import { forbidden } from "../errors.ts";
import { INDICATORS } from "../indicators.ts";
import type { Actor, Row } from "./common.ts";

const indicatorIds = INDICATORS.map((i) => i.id) as [string, ...string[]];

export const settingsInput = z.object({
  reminder_emails: z
    .string()
    .max(1000)
    .transform((s) => s.split(/[,\s;]+/).map((e) => e.trim()).filter(Boolean))
    .refine((list) => list.every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), "อีเมลไม่ถูกต้อง")
    .transform((list) => [...new Set(list)].join(", "))
    .optional(),
  targets: z
    .array(
      z.object({
        fy: z.number().int().min(2560).max(2700),
        quarter: z.number().int().min(0).max(4),
        indicator: z.enum(indicatorIds),
        target: z.number().min(0).max(100000).nullable(), // null = ลบ (ยังไม่ตั้งเป้า)
      }),
    )
    .max(500)
    .optional(),
});
export type SettingsInput = z.infer<typeof settingsInput>;

export async function saveSettings(db: Queryable, input: SettingsInput, actor: Actor): Promise<void> {
  if (actor.role !== "admin") throw forbidden("เฉพาะทีม รพ. ตั้งค่าเป้าหมายได้");
  const changes: Changes = {};

  if (input.reminder_emails !== undefined) {
    const [cur] = await db.query<Row[]>("SELECT v FROM tb_settings WHERE k = 'reminder_emails'");
    if ((cur[0]?.v ?? "") !== input.reminder_emails) {
      await db.execute(
        "INSERT INTO tb_settings (k, v, updated_by) VALUES ('reminder_emails', ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_by = VALUES(updated_by)",
        [input.reminder_emails, actor.id],
      );
      changes.reminder_emails = [cur[0]?.v ?? null, input.reminder_emails];
    }
  }

  for (const t of input.targets ?? []) {
    const unit = INDICATORS.find((i) => i.id === t.indicator)!.unit;
    const [cur] = await db.query<Row[]>(
      "SELECT target FROM tb_targets WHERE fy = ? AND quarter = ? AND indicator = ?",
      [t.fy, t.quarter, t.indicator],
    );
    const before = cur[0] ? Number(cur[0].target) : null;
    if (before === t.target) continue;
    if (t.target === null) {
      await db.execute("DELETE FROM tb_targets WHERE fy = ? AND quarter = ? AND indicator = ?", [t.fy, t.quarter, t.indicator]);
    } else {
      await db.execute(
        `INSERT INTO tb_targets (fy, quarter, indicator, target, unit, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE target = VALUES(target), unit = VALUES(unit), updated_by = VALUES(updated_by)`,
        [t.fy, t.quarter, t.indicator, t.target, unit, actor.id],
      );
    }
    changes[`เป้า ${t.indicator} ปีงบ ${t.fy} ${t.quarter ? `Q${t.quarter}` : "ทั้งปี"}`] = [before, t.target];
  }

  if (Object.keys(changes).length) {
    await writeAudit(db, { userId: actor.id, action: "settings", entity: "settings", entityId: "settings", changes, ip: actor.ip });
  }
}
