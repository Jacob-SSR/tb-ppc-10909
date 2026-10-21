// scripts/migrate.ts — รัน db/migrations/NNN_*.sql ที่ยังไม่เคยรัน ตามลำดับเลข
//
//   npm run migrate            รันไฟล์ที่ค้าง
//   npm run migrate -- --status  ดูสถานะอย่างเดียว
//   (production) docker compose run --rm migrate
//
// ใช้บัญชี tb_migrate (มีสิทธิ์ DDL) ไม่ใช่ tb_app
// ไฟล์ที่รันแล้วห้ามแก้ — จำ checksum ไว้ใน schema_migrations ถ้าไม่ตรงจะหยุดทันที
// หมายเหตุ: DDL ของ MySQL commit เองทีละคำสั่ง (ไม่มี transaction) ถ้าไฟล์ล้มกลางทาง
//          ต้องแก้ DB ด้วยมือให้กลับสภาพเดิมก่อนรันใหม่ — ทดสอบไฟล์กับ DB ทดลองก่อนเสมอ

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../db/migrations");
const FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LOCK_NAME = "ppc_tb_migrate";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`ต้องตั้ง ${name}`);
  return v;
}

async function main() {
  const statusOnly = process.argv.includes("--status");

  const conn = await mysql.createConnection({
    host: env("TB_DB_HOST", "127.0.0.1"),
    port: Number(env("TB_DB_PORT", "3306")),
    user: env("TB_MIGRATE_USER", "tb_migrate"),
    password: env("TB_MIGRATE_PASSWORD"),
    database: env("TB_DB_NAME", "ppc_tb"),
    charset: "utf8mb4_unicode_ci",
    timezone: "+07:00",
    // เปิดเฉพาะ connection ของ migrate (ไฟล์ .sql ใน repo เท่านั้น ไม่มี input จากผู้ใช้)
    // pool ของแอปใน lib/db.ts ปิดไว้เสมอ
    multipleStatements: true,
  });

  try {
    const [[lock]] = await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS ok", [LOCK_NAME]);
    if (lock.ok !== 1) throw new Error("มี migrate อีกตัวกำลังรันอยู่");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(255) NOT NULL PRIMARY KEY,
        checksum    CHAR(64) NOT NULL,
        applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        duration_ms INT UNSIGNED NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT version, checksum FROM schema_migrations");
    const applied = new Map(rows.map((r) => [r.version as string, r.checksum as string]));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => FILE_RE.test(f)).sort();
    const numbers = files.map((f) => f.slice(0, 3));
    const dup = numbers.find((n, i) => numbers.indexOf(n) !== i);
    if (dup) throw new Error(`เลข migration ซ้ำ: ${dup}`);

    let ran = 0;
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prev = applied.get(file);

      if (prev) {
        if (prev !== checksum) {
          throw new Error(`${file} ถูกแก้หลังรันไปแล้ว (checksum ไม่ตรง) — ให้สร้างไฟล์ migration ใหม่แทน`);
        }
        if (statusOnly) console.log(`  ✓ ${file}`);
        continue;
      }

      if (statusOnly) {
        console.log(`  · ${file} (ยังไม่รัน)`);
        continue;
      }

      const started = Date.now();
      console.log(`→ ${file}`);
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (version, checksum, duration_ms) VALUES (?, ?, ?)", [
        file,
        checksum,
        Date.now() - started,
      ]);
      ran++;
    }

    for (const v of applied.keys()) {
      if (!files.includes(v)) console.warn(`⚠ ${v} อยู่ใน schema_migrations แต่ไม่มีไฟล์แล้ว`);
    }
    if (!statusOnly) console.log(ran ? `migrate เสร็จ ${ran} ไฟล์` : "ไม่มี migration ค้าง");
  } finally {
    await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => {});
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[migrate] ล้มเหลว:", err instanceof Error ? err.message : err);
  process.exit(1);
});
