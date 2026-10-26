// scripts/import-from-sheet.ts — ย้ายข้อมูลจาก Google Sheet เดิม → MySQL ครั้งแรก (CLAUDE.md §8)
// (ทำแบบเดียวกันได้จากเว็บ: แท็บ "นำเข้า / ส่งออก" → "ย้ายข้อมูลจากระบบเดิม")
//
//   docker compose run --rm cli node scripts/import-from-sheet.ts --dry          ดูรายงานก่อน (ไม่บันทึก)
//   docker compose run --rm cli node scripts/import-from-sheet.ts                 บันทึกจริง
//   ... --xlsx /path/to/Tuberculosis.xlsx                                         อ่านจากไฟล์ที่ดาวน์โหลดจาก Sheet แทน
//   ... --as <username>                                                           ผู้นำเข้าของ DB_Visits (created_by ห้ามว่าง)
//
// ขั้นตอนจริงอยู่ใน lib/migrateSheet.ts
import type mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { closePools, tbDb } from "../lib/db.ts";
import { MIGRATE_TABS, runMigration, tabsFromSheet, tabsFromXlsx, type Tabs } from "../lib/migrateSheet.ts";
import { SYSTEM_ACTOR, type Actor } from "../lib/repo/common.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const asUser = arg("--as");
  let actor: Actor = SYSTEM_ACTOR;
  if (asUser) {
    const [u] = await tbDb.query<mysql.RowDataPacket[]>(
      "SELECT u.id, u.unit_id FROM tb_users u JOIN tb_units un ON un.id = u.unit_id WHERE u.username = ? AND un.role = 'admin'",
      [asUser],
    );
    if (!u[0]) throw new Error(`ไม่พบผู้ดูแลชื่อ ${asUser}`);
    actor = { id: u[0].id, role: "admin", unitId: u[0].unit_id };
  }

  const xlsx = arg("--xlsx");
  let tabs: Tabs;
  if (xlsx) {
    const buf = await readFile(xlsx);
    tabs = await tabsFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } else {
    const r = await tabsFromSheet();
    for (const w of r.warnings) console.warn(`⚠ ${w}`);
    tabs = r.tabs;
  }
  console.log(`แหล่งข้อมูล: ${xlsx ?? `Google Sheet ${process.env.TB_SPREADSHEET_ID}`}${dry ? "  [DRY RUN — ไม่บันทึก]" : ""}`);

  const res = await runMigration(tabs, actor, dry);
  for (const { tab, report: r } of res.reports) {
    console.log(`\n${tab}: อ่าน ${r.read} · เพิ่ม ${r.added} · อัปเดต ${r.updated} · ไม่เปลี่ยน ${r.unchanged} · ปฏิเสธ ${r.skipped.length}`);
    if (r.unknownHeaders.length) console.log(`  คอลัมน์ที่ไม่รู้จัก (ข้าม): ${r.unknownHeaders.join(", ")}`);
    for (const s of r.skipped) console.log(`  ✗ แถว ${s.row}: ${s.reason}`);
  }
  console.log(`\n${MIGRATE_TABS.log}: อ่าน ${res.log.read} · นำเข้าเป็นประวัติ ${res.log.added} (รายการที่นำเข้าแล้วในรอบก่อนถูกข้าม)`);
  console.log("ไม่นำเข้า: DB_Users (PIN), DB_Settings (ตั้งเป้าใหม่ในหน้า ตั้งเป้าหมาย), แท็บ ปีงบ 25xx (เก็บเป็น archive)");
  console.log(`\nใน MySQL หลังนำเข้า: ผู้ป่วย ${res.inDb.patients} · ผู้สัมผัส ${res.inDb.contacts} · บันทึกรายครั้ง ${res.inDb.visits}`);
  console.log(`เทียบแหล่ง: ผู้ป่วย ${res.inSource.patients} · ผู้สัมผัส ${res.inSource.contacts} · บันทึกรายครั้ง ${res.inSource.visits}`);
  console.log(dry ? "\nDRY RUN — ยกเลิกทั้งหมด ไม่มีอะไรถูกบันทึก" : "\nบันทึกแล้ว — worker จะเขียนกลับไป Sheet ให้เอง");
  if (res.reports.some(({ report }) => report.skipped.length)) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error("[import] ล้มเหลว:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
