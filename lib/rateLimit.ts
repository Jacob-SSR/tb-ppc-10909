// lib/rateLimit.ts — นับครั้งต่อช่วงเวลาใน Redis (fixed window)
// Redis ล่ม → ปล่อยผ่าน (การล็อกบัญชีใน DB ยังกันเดารหัสได้อยู่)
import { redis } from "./redis.ts";

export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  try {
    const k = `tb:rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    if (n <= limit) return { ok: true, retryAfterSec: 0 };
    const ttl = await redis.ttl(k);
    return { ok: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
  } catch {
    return { ok: true, retryAfterSec: 0 };
  }
}
