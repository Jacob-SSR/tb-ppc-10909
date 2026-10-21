// lib/tb/contacts.ts
// ผู้สัมผัส: isTB, สรุปจำนวนต่อผู้ป่วย (§6.3), แปลงผู้สัมผัสที่ป่วยเป็นผู้ป่วยใหม่

import { CONTACT_TYPE_LABEL, TB_RESULT, type ContactType } from "./constants.ts";
import { fyOf, type IsoDate } from "./dates.ts";
import type { ContactRow, PatientRow } from "./types.ts";

type TBFields = Pick<
  ContactRow,
  "new_patient_id" | "screen_result" | "fu6_result" | "fu12_result" | "fu18_result" | "fu24_result"
>;

/** ผู้สัมผัสป่วยเป็นวัณโรค = ผูกผู้ป่วยใหม่แล้ว หรือผลคัดกรอง/ผลติดตามใดๆ = "ป่วยเป็นวัณโรค" */
export function isTB(c: TBFields): boolean {
  if (c.new_patient_id) return true;
  return [c.screen_result, c.fu6_result, c.fu12_result, c.fu18_result, c.fu24_result].some(
    (r) => r?.trim() === TB_RESULT,
  );
}

/**
 * เงื่อนไขเดียวกับ isTB() สำหรับใช้ใน SQL (GROUP BY นับ TB ครั้งเดียว ไม่ต้อง N+1)
 * แก้ isTB() ต้องแก้ตรงนี้ด้วย — test เทียบสองตัวนี้ไว้แล้ว
 */
export function isTBSql(alias = "c"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`alias ไม่ถูกต้อง: ${alias}`);
  const cols = ["screen_result", "fu6_result", "fu12_result", "fu18_result", "fu24_result"]
    .map((col) => `TRIM(${alias}.${col})`)
    .join(", ");
  return `(${alias}.new_patient_id IS NOT NULL OR '${TB_RESULT}' IN (${cols}))`;
}

// ── สรุปผู้สัมผัสต่อผู้ป่วย (§6.3) ─────────────────────────────────────────────

export interface ContactCountRow {
  patient_id: string;
  contact_type: ContactType;
  total: number | string; // COUNT/SUM จาก mysql2 อาจเป็นสตริง
  tb: number | string | null;
}

export interface ContactGroupCount {
  total: number;
  tb: number;
}

export interface ContactSummary {
  total: number;
  tb: number;
  household: ContactGroupCount;
  close: ContactGroupCount;
}

export function emptyContactSummary(): ContactSummary {
  return { total: 0, tb: 0, household: { total: 0, tb: 0 }, close: { total: 0, tb: 0 } };
}

/**
 * รวมผลจาก
 *   SELECT patient_id, contact_type, COUNT(*) total, SUM(<isTBSql>) tb
 *   FROM tb_contacts WHERE deleted_at IS NULL GROUP BY patient_id, contact_type
 */
export function summarizeContacts(rows: readonly ContactCountRow[]): Map<string, ContactSummary> {
  const out = new Map<string, ContactSummary>();
  for (const r of rows) {
    const s = out.get(r.patient_id) ?? emptyContactSummary();
    const total = Number(r.total) || 0;
    const tb = Number(r.tb) || 0;
    s[r.contact_type].total += total;
    s[r.contact_type].tb += tb;
    s.total += total;
    s.tb += tb;
    out.set(r.patient_id, s);
  }
  return out;
}

/** "ผู้สัมผัส 5 · ร่วมบ้าน 3 (TB 1) · ใกล้ชิด 2 (TB 0)" */
export function formatContactSummary(s: ContactSummary): string {
  const g = (t: ContactType) => `${CONTACT_TYPE_LABEL[t]} ${s[t].total} (TB ${s[t].tb})`;
  return `ผู้สัมผัส ${s.total} · ${g("household")} · ${g("close")}`;
}

/**
 * สถานที่รักษาของผู้สัมผัสที่ป่วย
 * ลงทะเบียนในระบบเรา → reg_place ของผู้ป่วยรายนั้น (+ลิงก์), ไม่งั้น → tb_treat_place
 */
export function tbTreatPlace(
  c: Pick<ContactRow, "new_patient_id" | "tb_treat_place">,
  newPatient?: Pick<PatientRow, "id" | "reg_place"> | null,
): { place: string | null; patientId: string | null } {
  if (c.new_patient_id) {
    return {
      place: newPatient?.reg_place ?? c.tb_treat_place ?? null,
      patientId: c.new_patient_id,
    };
  }
  return { place: c.tb_treat_place ?? null, patientId: null };
}

// ── convertContactToPatient (ส่วนที่ไม่แตะ DB) ─────────────────────────────────

export type NewPatientDraft = Pick<
  PatientRow,
  | "id" | "fy" | "full_name" | "hn" | "cid" | "sex" | "age" | "phone"
  | "address" | "unit_id" | "patient_type" | "reg_place" | "note"
>;

/**
 * ร่างผู้ป่วยใหม่จากผู้สัมผัสที่ป่วย — Phase 3 เอาไป INSERT tb_patients แล้ว
 * UPDATE tb_contacts.new_patient_id ใน transaction เดียวกัน
 */
export function patientDraftFromContact(
  c: Pick<
    ContactRow,
    "id" | "patient_id" | "full_name" | "hn" | "cid" | "sex" | "age" | "phone"
    | "address" | "current_address" | "unit_id" | "tb_treat_place" | "screen_date"
  >,
  opts: { id: string; today: IsoDate },
): NewPatientDraft {
  return {
    id: opts.id,
    fy: fyOf(c.screen_date ?? opts.today),
    full_name: c.full_name,
    hn: c.hn,
    cid: c.cid,
    sex: c.sex,
    age: c.age,
    phone: c.phone,
    // ผู้ป่วยต้องติดตามที่บ้านจริง → ใช้ที่อยู่ปัจจุบันก่อน
    address: c.current_address ?? c.address,
    unit_id: c.unit_id,
    patient_type: "NEW",
    reg_place: c.tb_treat_place,
    note: `พบจากการคัดกรองผู้สัมผัส ${c.id} ของผู้ป่วย ${c.patient_id}`,
  };
}
