// GET /api/health — healthcheck ของ docker compose (ไม่ต้อง login)
// เช็คแค่ของที่แอปขาดไม่ได้: MySQL ของโปรเจกต์ + Redis
// ไม่เช็ค HOSxP — HOSxP ปิดปรับปรุงแล้วทะเบียนต้องยังใช้ได้ และไม่อยากยิง DB โรงพยาบาลทุก 30 วิ
import { connection } from "next/server";
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

export async function GET() {
  await connection(); // ต้องเช็คตอน request จริง ห้าม prerender

  const [db, cache] = await Promise.all([
    check(() => tbDb.query("SELECT 1")),
    check(() => redis.ping()), // lazyConnect: คำสั่งแรกจะต่อให้เอง
  ]);
  const ok = db && cache;

  return Response.json(
    { ok, db, redis: cache },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
