// lib/worker/sheetApi.ts — ส่วนที่ mirror ใช้จาก Google Sheets API (แยกเป็น interface ให้ทดสอบด้วยตัวปลอมได้)
import { getSheets, spreadsheetId } from "../sheets.ts";

export interface TabInfo {
  title: string;
  sheetId: number;
  rowCount: number;
  protectedBy: string[]; // editors ของ protected range ที่ครอบทั้งแท็บ (ว่าง = ยังไม่ป้องกัน)
}

export interface SheetApi {
  tabs(): Promise<TabInfo[]>;
  /** ค่าในช่วง A1 (FORMATTED_VALUE) */
  get(range: string): Promise<string[][]>;
  /** เขียนหลายช่วงในครั้งเดียว (values.batchUpdate, RAW = เก็บเป็นข้อความตามเดิม) */
  write(data: { range: string; values: string[][] }[]): Promise<void>;
  clear(range: string): Promise<void>;
  /** addSheet / deleteDimension / appendDimension / addProtectedRange */
  batch(requests: object[]): Promise<void>;
}

export const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export function googleSheetApi(): SheetApi {
  const sheets = getSheets(false);
  const id = spreadsheetId();
  return {
    async tabs() {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: "sheets(properties(title,sheetId,gridProperties.rowCount),protectedRanges(range,editors))",
      });
      return (meta.data.sheets ?? []).map((s) => ({
        title: s.properties!.title!,
        sheetId: s.properties!.sheetId!,
        rowCount: s.properties!.gridProperties?.rowCount ?? 1000,
        protectedBy: (s.protectedRanges ?? [])
          .filter((p) => p.range && p.range.startRowIndex == null && p.range.startColumnIndex == null)
          .flatMap((p) => p.editors?.users ?? []),
      }));
    },
    async get(range) {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: "FORMATTED_VALUE" });
      return (r.data.values ?? []) as string[][];
    },
    async write(data) {
      if (!data.length) return;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
    },
    async clear(range) {
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range });
    },
    async batch(requests) {
      if (!requests.length) return;
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
    },
  };
}
