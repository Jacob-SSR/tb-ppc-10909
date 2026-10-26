// scripts/sheet-unlock.ts — ถอดล็อกแท็บใน Google Sheet ที่ระบบนี้เคยใส่ (ใช้ service account ใน .env.production)
//
//   docker compose run --rm cli node scripts/sheet-unlock.ts --dry   ดูว่าจะถอดอะไร
//   docker compose run --rm cli node scripts/sheet-unlock.ts         ถอดจริง
//
// ใช้เมื่อคนในทีมถอดเองไม่ได้ (ล็อกให้แก้ได้เฉพาะ service account และผู้ใช้ไม่ใช่เจ้าของไฟล์)
// ล็อกที่คนอื่นตั้งเอง (มีผู้แก้ไขเป็นคน) ไม่ถูกแตะ — ระบบเวอร์ชันนี้ไม่ใส่ล็อกกลับ เว้นแต่ตั้ง SHEET_PROTECT=1
import { isOurLock } from "../lib/sheetLocks.ts";
import { getSheets, spreadsheetId } from "../lib/sheets.ts";

async function main() {
  const dry = process.argv.includes("--dry");
  const sa = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!sa || !process.env.GOOGLE_PRIVATE_KEY) throw new Error("ต้องตั้ง GOOGLE_SERVICE_ACCOUNT_EMAIL และ GOOGLE_PRIVATE_KEY");
  const sheets = getSheets(false);
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets(properties(title),protectedRanges(protectedRangeId,description,editors))",
  });
  const found = (meta.data.sheets ?? []).flatMap((s) =>
    (s.protectedRanges ?? []).filter((p) => isOurLock(p, sa)).map((p) => ({ tab: s.properties?.title ?? "?", id: p.protectedRangeId! })));
  if (!found.length) {
    console.log("ไม่มีล็อกของระบบเหลืออยู่");
    return;
  }
  for (const f of found) console.log(`${dry ? "จะถอด" : "ถอด"}ล็อก: ${f.tab}`);
  if (dry) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: found.map((f) => ({ deleteProtectedRange: { protectedRangeId: f.id } })) },
  });
  console.log(`ถอดล็อกแล้ว ${found.length} รายการ`);
}

main().catch((err) => {
  console.error("[sheet-unlock] ล้มเหลว:", err instanceof Error ? err.message : err);
  process.exit(1);
});
