// lib/tb/sheetRows.ts — แปลงแถว DB ⇄ แถว Sheet/Excel ตามหัวคอลัมน์เดิม
// ใช้ร่วมกัน: ส่งออก Excel, นำเข้า Excel, สคริปต์ย้ายข้อมูลจาก Sheet (Phase 5), Sheet mirror (Phase 6)

import { DEFAULT_FOLLOWUP_SLOTS } from "./constants.ts";
import { formatThaiDate, toIso } from "./dates.ts";
import { CONTACT_TYPE_SHEET_LABEL, contactTypeFromLabel } from "./options.ts";
import {
  CONTACT_SHEET_COLUMNS, CONTACT_SHEET_EXTRA, DATE_SOURCES, FOLLOWUP_SHEET_COLUMNS,
  PATIENT_SHEET_COLUMNS, VISIT_SHEET_COLUMNS, type SheetColumn,
} from "./sheetColumns.ts";
import type { ContactType } from "./constants.ts";

export type SheetKind = "patient" | "contact" | "visit" | "followup";

export const COLUMNS: Record<SheetKind, readonly SheetColumn[]> = {
  patient: PATIENT_SHEET_COLUMNS,
  contact: [...CONTACT_SHEET_COLUMNS, ...CONTACT_SHEET_EXTRA],
  visit: VISIT_SHEET_COLUMNS,
  followup: FOLLOWUP_SHEET_COLUMNS,
};

export interface ToSheetContext {
  /** "iso" = แบบ DB_* เดิม (ppc-hos อ่านได้), "thai" = dd/mm/yyyy พ.ศ. (ไฟล์ Excel ส่งออก) */
  dateFormat: "iso" | "thai";
  unitName?: (id: unknown) => string;
  /** ค่าที่ไม่ได้อยู่ในแถว เช่น index_hn, fy ของผู้สัมผัส, updated_by_name, followup:N */
  extra?: Record<string, unknown>;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** แถว DB → array ตามลำดับหัวคอลัมน์ */
export function toSheetRow(kind: SheetKind, row: Record<string, unknown>, ctx: ToSheetContext): string[] {
  return COLUMNS[kind].map(([, src]) => {
    let v: unknown = src in row ? row[src] : ctx.extra?.[src];
    if (src === "unit_name") v = ctx.unitName?.(row.unit_id) ?? "";
    if (src === "ref_id") v = row.patient_id ?? row.contact_id;
    if (src === "contact_type" && v) v = CONTACT_TYPE_SHEET_LABEL[v as ContactType] ?? v;
    if (DATE_SOURCES.has(src)) return ctx.dateFormat === "thai" ? formatThaiDate(str(v)) : str(v);
    if (src === "updated_at" && v) return str(v).slice(0, 19);
    return str(v);
  });
}

/** ผล followup slot 1–5 → extra ของ toSheetRow ("followup:N") */
export function legacyFollowupExtra(followups: readonly { slot: number; result: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DEFAULT_FOLLOWUP_SLOTS) out[`followup:${d.slot}`] = followups.find((f) => f.slot === d.slot)?.result ?? "";
  return out;
}

// ── อ่านกลับ (นำเข้า) ─────────────────────────────────────────────────────────

export interface ParsedRecord {
  /** ค่าตามชื่อคอลัมน์ DB (ยังไม่ validate — ส่งต่อให้ zod) */
  data: Record<string, unknown>;
  id: string | null;
  /** ผลตรวจเดือน 2/5/6 จากคอลัมน์เดิม → tb_treatment_followups slot 1–5 */
  legacyFollowups: { slot: number; month_no: number; test: "CXR" | "AFB"; result: string }[];
  meta: { unitName: string | null; indexHn: string | null; updatedBy: string | null; updatedAt: string | null; refId: string | null };
  errors: string[];
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** หัวคอลัมน์ → source; รับทั้งหัวไทยเดิมและชื่อคอลัมน์ DB */
export function headerMap(kind: SheetKind): Map<string, string> {
  const m = new Map<string, string>();
  for (const [h, src] of COLUMNS[kind]) {
    m.set(h.trim(), src);
    m.set(src, src);
  }
  return m;
}

/**
 * record (หัวคอลัมน์ → ค่า) → ParsedRecord
 * '' → null, วันที่ → YYYY-MM-DD, ประเภทการสัมผัส → household/close
 * คอลัมน์ที่ไม่รู้จักคืนใน unknownHeaders ของผู้เรียก (ไม่ error)
 */
export function fromSheetRecord(kind: SheetKind, record: Record<string, unknown>): ParsedRecord {
  const map = headerMap(kind);
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  const meta: ParsedRecord["meta"] = { unitName: null, indexHn: null, updatedBy: null, updatedAt: null, refId: null };
  const legacyFollowups: ParsedRecord["legacyFollowups"] = [];

  for (const [rawHeader, raw] of Object.entries(record)) {
    const src = map.get(rawHeader.trim());
    if (!src) continue;
    const v = blank(raw) ? null : typeof raw === "string" ? raw.trim() : raw;

    if (src.startsWith("followup:")) {
      const slot = Number(src.slice(9));
      const def = DEFAULT_FOLLOWUP_SLOTS.find((d) => d.slot === slot)!;
      if (v !== null) legacyFollowups.push({ slot, month_no: def.month_no, test: def.test, result: String(v) });
      continue;
    }
    switch (src) {
      case "unit_name": meta.unitName = v === null ? null : String(v); continue;
      case "index_hn": meta.indexHn = v === null ? null : String(v); continue;
      case "updated_by_name": meta.updatedBy = v === null ? null : String(v); continue;
      case "updated_at": meta.updatedAt = v instanceof Date ? v.toISOString() : v === null ? null : String(v); continue;
      case "ref_id": meta.refId = v === null ? null : String(v); continue;
    }
    if (src === "contact_type") {
      const t = contactTypeFromLabel(v === null ? null : String(v));
      if (!t) errors.push(`ประเภทการสัมผัสไม่รู้จัก: ${String(v)}`);
      data.contact_type = t;
      continue;
    }
    if (DATE_SOURCES.has(src) && v !== null) {
      const iso = toIso(v);
      if (!iso) errors.push(`วันที่ไม่ถูกต้อง (${src}): ${String(v)}`);
      data[src] = iso;
      continue;
    }
    data[src] = v instanceof Date ? toIso(v) : v;
  }

  const id = typeof data.id === "string" && data.id ? data.id : null;
  delete data.id;
  return { data, id, legacyFollowups, meta, errors };
}
