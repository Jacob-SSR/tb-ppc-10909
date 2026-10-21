// lib/db.ts — connection pool ของระบบ TB
//
//   tbDb     MySQL ของโปรเจกต์นี้ (schema ppc_tb, utf8mb4) อ่าน/เขียน ด้วยบัญชี tb_app
//   hosxpDb  HOSxP อ่านอย่างเดียว (tis620) ด้วยบัญชีที่มีแค่ SELECT — ห้ามเขียน/สร้างตารางใน HOSxP
//
// pool สร้างตอน import ได้เลยเพราะ mysql2 ยังไม่ต่อจนกว่าจะ query
// การตรวจ env ที่จำเป็นอยู่ใน lib/env.ts (เรียกจาก instrumentation.ts ตอน start)
// ใช้ parameterized query (?) เท่านั้น ห้ามต่อสตริง SQL จาก input

import mysql from "mysql2/promise";

const shared = {
  // ⚠️ ห้ามเปิด multipleStatements — เปิดทาง stacked-query SQL injection ("…; DROP TABLE …")
  multipleStatements: false,
  // DATE/DATETIME คืนเป็นสตริงตรงจาก DB ("2026-10-21") ไม่ผ่าน Date → ไม่มีวันเลื่อนจาก timezone
  dateStrings: true,
  timezone: "+07:00",
  waitForConnections: true,
  idleTimeout: 60_000,
  connectTimeout: 10_000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30_000,
} as const;

function createTbPool() {
  return mysql.createPool({
    ...shared,
    host: process.env.TB_DB_HOST ?? "mysql",
    port: Number(process.env.TB_DB_PORT ?? 3306),
    user: process.env.TB_DB_USER ?? "tb_app",
    password: process.env.TB_DB_PASSWORD,
    database: process.env.TB_DB_NAME ?? "ppc_tb",
    charset: "utf8mb4_unicode_ci",
    decimalNumbers: true, // lat/lng/target_value เป็น number
    connectionLimit: Number(process.env.TB_DB_POOL_SIZE ?? 10),
    maxIdle: 5,
    queueLimit: 100,
  });
}

function createHosxpPool() {
  return mysql.createPool({
    ...shared,
    host: process.env.HOSXP_DB_HOST,
    port: Number(process.env.HOSXP_DB_PORT ?? 3306),
    user: process.env.HOSXP_DB_USER,
    password: process.env.HOSXP_DB_PASSWORD,
    database: process.env.HOSXP_DB_NAME,
    charset: "tis620", // HOSxP ใช้ tis620 — อย่าเปลี่ยน
    // ต่อ DB ตัวจริงของโรงพยาบาล → pool เล็ก คิวสั้น ยอมช้าดีกว่าพาระบบงานล่ม
    connectionLimit: Number(process.env.HOSXP_DB_POOL_SIZE ?? 3),
    maxIdle: 1,
    queueLimit: 30,
  });
}

// เก็บ pool ไว้ที่ globalThis กัน hot reload ตอน dev สร้าง pool ซ้ำจน connection เต็ม
const g = globalThis as unknown as { tbDb?: mysql.Pool; hosxpDb?: mysql.Pool };

export const tbDb = g.tbDb ?? createTbPool();
export const hosxpDb = g.hosxpDb ?? createHosxpPool();

if (process.env.NODE_ENV !== "production") {
  g.tbDb = tbDb;
  g.hosxpDb = hosxpDb;
}

/**
 * รัน fn ใน transaction ของ tbDb — commit เมื่อสำเร็จ, rollback เมื่อ throw
 * ใช้กับงานที่ต้องเขียนหลายตารางพร้อมกัน (ตารางหลัก + tb_audit_log + tb_sheet_outbox)
 */
export async function withTransaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await tbDb.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
