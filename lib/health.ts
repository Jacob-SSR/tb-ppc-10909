// lib/health.ts — เช็คของที่แอปขาดไม่ได้: MySQL ของโปรเจกต์ + Redis
// ใช้ทั้ง /api/health (healthcheck ของ compose) และหน้าแรก
// ไม่เช็ค HOSxP — HOSxP ปิดปรับปรุงแล้วทะเบียนต้องยังใช้ได้ และไม่อยากยิง DB โรงพยาบาลทุก 30 วิ
import { tbDb } from "@/lib/db";
import { redis } from "@/lib/redis";

const TIMEOUT_MS = 3_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await withTimeout(fn());
    return true;
  } catch {
    return false;
  }
}

export interface Health {
  ok: boolean;
  db: boolean;
  redis: boolean;
}

export async function checkHealth(): Promise<Health> {
  const [db, cache] = await Promise.all([
    check(() => tbDb.query("SELECT 1")),
    check(() => redis.ping()), // lazyConnect: คำสั่งแรกจะต่อให้เอง
  ]);
  return { ok: db && cache, db, redis: cache };
}
