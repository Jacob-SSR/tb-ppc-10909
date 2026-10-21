// lib/excel.ts — อ่าน/เขียนไฟล์ .xlsx ฝั่ง server (exceljs)
import ExcelJS from "exceljs";
import { COLUMNS, toSheetRow, type SheetKind, type ToSheetContext } from "./tb/sheetRows.ts";

export interface SheetRecords {
  name: string;
  headers: string[];
  records: Record<string, unknown>[];
}

/** ค่าในเซลล์ → ค่าธรรมดา (rich text, สูตร, hyperlink, วันที่) */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return (v as { text: unknown }).text;
    if ("error" in v) return null;
  }
  return v;
}

/** แถวแรก = หัวคอลัมน์, แถวที่ไม่มีค่าเลยถูกข้าม */
export async function readWorkbook(buf: ArrayBuffer): Promise<SheetRecords[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.map((ws) => {
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cellValue(cell.value) ?? "").trim();
    });
    const records: Record<string, unknown>[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rec: Record<string, unknown> = {};
      let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = cellValue(row.getCell(i + 1).value);
        rec[h] = v;
        if (v !== null && String(v).trim() !== "") any = true;
      });
      if (any) records.push(rec);
    }
    return { name: ws.name, headers: headers.filter(Boolean), records };
  });
}

export interface ExportSheet {
  name: string;
  kind: SheetKind;
  rows: { row: Record<string, unknown>; extra?: Record<string, unknown> }[];
}

/** สร้างไฟล์ส่งออก — วันที่ dd/mm/yyyy พ.ศ. แบบระบบเดิม, หัวคอลัมน์ไทยเดิม */
export async function buildWorkbook(sheets: ExportSheet[], unitName: ToSheetContext["unitName"]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ทะเบียนวัณโรค รพ.พลับพลาชัย";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    const header = ws.addRow(COLUMNS[s.kind].map(([h]) => h));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4D40" } };
    for (const r of s.rows) ws.addRow(toSheetRow(s.kind, r.row, { dateFormat: "thai", unitName, extra: r.extra }));
    ws.columns.forEach((c) => {
      c.width = 16;
      c.numFmt = "@"; // เก็บเป็นข้อความ กัน Excel แปลง HN/เลขบัตรเป็นตัวเลข
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
