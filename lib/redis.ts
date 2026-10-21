// lib/redis.ts — Redis ของ stack นี้ (rate limit login, leader election ของ worker, cache HOSxP/แถว Sheet)
import Redis from "ioredis";

const g = globalThis as unknown as { redis?: Redis };

export const redis =
  g.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://redis:6379", {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== "production") g.redis = redis;
