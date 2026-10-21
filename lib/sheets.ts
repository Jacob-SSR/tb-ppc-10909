// lib/sheets.ts — Google Sheets client (service account) — ใช้ตอนย้ายข้อมูล (อ่าน) และ mirror (เขียน)
import { google, type sheets_v4 } from "googleapis";

export type Sheets = sheets_v4.Sheets;

export function sheetsConfigured(): boolean {
  return !!(process.env.TB_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

export function spreadsheetId(): string {
  const id = process.env.TB_SPREADSHEET_ID;
  if (!id) throw new Error("ยังไม่ได้ตั้ง TB_SPREADSHEET_ID");
  return id;
}

export function getSheets(readonly = false): Sheets {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: [readonly ? "https://www.googleapis.com/auth/spreadsheets.readonly" : "https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** ชื่อแท็บ → sheetId (ใช้ลบแถว/ป้องกันแถว) */
export async function tabIds(sheets: Sheets, id: string): Promise<Map<string, number>> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,sheetId)" });
  return new Map((meta.data.sheets ?? []).map((s) => [s.properties!.title!, s.properties!.sheetId!]));
}

/** ค่าที่แสดงในแท็บ (เหมือน getDisplayValues ของ Apps Script) — แถวแรกเป็นหัวคอลัมน์ */
export async function readTab(sheets: Sheets, id: string, tab: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${tab.replace(/'/g, "''")}'`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (res.data.values ?? []) as string[][];
}

/** ตาราง (หัว + แถว) → records ตามชื่อหัว (ข้ามแถวที่ไม่มีรหัสระบบ/ว่างทั้งแถว) */
export function toRecords(values: unknown[][]): Record<string, unknown>[] {
  const [header, ...rows] = values;
  if (!header) return [];
  const h = header.map((x) => String(x ?? "").trim());
  return rows
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(h.map((name, i) => [name, r[i] ?? ""]).filter(([name]) => name)));
}
