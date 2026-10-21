// scripts/create-admin.ts — สร้างบัญชีผู้ดูแลคนแรก (ทีม TB รพ.พลับพลาชัย)
//
//   docker compose run --rm cli node scripts/create-admin.ts <username> "<ชื่อ-สกุล>"
//   (dev) node --env-file=.env.local scripts/create-admin.ts <username> "<ชื่อ-สกุล>"
//
// พิมพ์รหัสชั่วคราวครั้งเดียว — login แล้วระบบบังคับเปลี่ยนรหัสทันที
// คนถัดไปให้ admin สร้างจากหน้า "ผู้ใช้" ในเว็บ

import type mysql from "mysql2/promise";
import { closePools, tbDb } from "../lib/db.ts";
import { createUser, USERNAME_RE } from "../lib/users.ts";

async function main() {
  const [username, displayName] = process.argv.slice(2);
  if (!username || !displayName || !USERNAME_RE.test(username.toLowerCase())) {
    console.error('วิธีใช้: node scripts/create-admin.ts <username a-z0-9._-> "<ชื่อ-สกุล>"');
    process.exit(1);
  }
  const [units] = await tbDb.query<mysql.RowDataPacket[]>("SELECT id, name FROM tb_units WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!units[0]) throw new Error("ไม่พบหน่วย admin ใน tb_units — รัน migrate แล้วหรือยัง");
  const [dup] = await tbDb.query<mysql.RowDataPacket[]>("SELECT id FROM tb_users WHERE username = ?", [username.toLowerCase()]);
  if (dup.length) throw new Error(`มีผู้ใช้ ${username} อยู่แล้ว (reset รหัสได้จากหน้า "ผู้ใช้" ของ admin คนอื่น)`);

  const { tempPassword } = await createUser(
    tbDb,
    { username: username.toLowerCase(), displayName, unitId: units[0].id },
    { userId: null },
  );
  console.log(`สร้างผู้ดูแล ${username.toLowerCase()} (${units[0].name}) แล้ว`);
  console.log(`รหัสชั่วคราว: ${tempPassword}`);
  console.log("login แล้วระบบจะให้เปลี่ยนรหัสทันที");
}

main()
  .catch((err) => {
    console.error("[create-admin] ล้มเหลว:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
