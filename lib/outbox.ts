// lib/outbox.ts — คิวส่งข้อมูลไป Google Sheet (CLAUDE.md §7)
// INSERT ใน transaction เดียวกับการบันทึกข้อมูลหลักเสมอ → ถ้าบันทึกสำเร็จ คิวต้องมีแน่นอน
// เก็บแค่ entity + id — worker ไปอ่านแถวล่าสุดจาก MySQL เอง
import type { Queryable } from "./audit.ts";

export type OutboxEntity = "patient" | "contact" | "visit" | "followup";

export async function enqueue(db: Queryable, entity: OutboxEntity, entityId: string): Promise<void> {
  await db.execute("INSERT INTO tb_sheet_outbox (entity, entity_id) VALUES (?, ?)", [entity, entityId]);
}
