// lib/api.ts — ตัวช่วยของ route handler ฝั่งข้อมูล
import { z } from "zod";
import type { SessionUser } from "./auth/session.ts";
import { clientIp } from "./http.ts";
import type { Actor } from "./repo/common.ts";

export function actorOf(u: SessionUser, req: Request): Actor {
  return { id: u.id, role: u.role, unitId: u.unitId, ip: clientIp(req) };
}

/** body ของการบันทึก: { data, version } — version ใช้ทำ optimistic lock ตอนแก้ไข */
export const withVersion = <T extends z.ZodType>(data: T) =>
  z.object({ data, version: z.number().int().positive().optional() });

/** version จาก query string (?version=3) สำหรับ DELETE */
export function versionParam(req: Request): number | undefined {
  const v = Number(new URL(req.url).searchParams.get("version"));
  return Number.isInteger(v) && v > 0 ? v : undefined;
}
