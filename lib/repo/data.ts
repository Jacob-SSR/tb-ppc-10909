// lib/repo/data.ts — ข้อมูลทั้งหมดที่หน้าเว็บใช้ (แทน getData เดิม) กรองตามสิทธิ์ที่ SQL เสมอ (§3)
//   admin: ทุกอย่าง
//   unit : ผู้สัมผัสของหน่วยตัวเอง + visit / นัด ของผู้สัมผัสเหล่านั้น
//          + ผู้ป่วย index ของผู้สัมผัสเหล่านั้น (เฉพาะช่องที่จำเป็น) — ไม่ได้ followup / visit ของผู้ป่วย
import type { Queryable } from "../audit.ts";
import { isTBSql, summarizeContacts, type ContactCountRow, type ContactSummary } from "../tb/contacts.ts";
import { todayBangkok } from "../tb/dates.ts";
import type { Actor, Row } from "./common.ts";

/** ช่องของผู้ป่วยที่ user unit เห็นได้ (§3) */
const UNIT_PATIENT_COLS = "p.id, p.fy, p.name, p.hn, p.start_date, p.diag_date, p.outcome, p.reg_place, p.version";

export interface AppData {
  today: string;
  units: Row[];
  patients: Row[];
  contacts: Row[];
  visits: Row[];
  appointments: Row[];
  followups: Row[];
  contactSummary: Record<string, ContactSummary>;
  settings: Record<string, string>;
  targets: Row[];
}

export async function loadAppData(db: Queryable, actor: Actor): Promise<AppData> {
  const admin = actor.role === "admin";
  const unitId = actor.unitId;

  const [units] = await db.query<Row[]>("SELECT id, name, role, hcode, active FROM tb_units ORDER BY id");

  const [contacts] = await db.query<Row[]>(
    `SELECT c.* FROM tb_contacts c WHERE c.deleted_at IS NULL ${admin ? "" : "AND c.unit_id = ?"} ORDER BY c.created_at`,
    admin ? [] : [unitId],
  );

  const [patients] = admin
    ? await db.query<Row[]>("SELECT p.* FROM tb_patients p WHERE p.deleted_at IS NULL ORDER BY p.fy DESC, p.seq, p.start_date")
    : await db.query<Row[]>(
        `SELECT ${UNIT_PATIENT_COLS} FROM tb_patients p
          WHERE p.deleted_at IS NULL AND p.id IN (
            SELECT patient_id FROM tb_contacts WHERE unit_id = ? AND deleted_at IS NULL
            UNION SELECT new_patient_id FROM tb_contacts WHERE unit_id = ? AND deleted_at IS NULL AND new_patient_id IS NOT NULL)
          ORDER BY p.fy DESC, p.start_date`,
        [unitId, unitId],
      );

  const visitSelect = `SELECT v.id, v.patient_id, v.contact_id, v.visit_date, v.visit_type, v.detail, v.next_appt,
            v.lat, v.lng, v.created_by, v.updated_at, u.display_name AS by_name, u.unit_id AS by_unit_id, un.name AS by_unit_name
       FROM tb_visits v JOIN tb_users u ON u.id = v.created_by JOIN tb_units un ON un.id = u.unit_id
      WHERE v.deleted_at IS NULL`;
  const [visits] = admin
    ? await db.query<Row[]>(`${visitSelect} ORDER BY v.visit_date DESC, v.updated_at DESC`)
    : await db.query<Row[]>(
        `${visitSelect} AND v.contact_id IN (SELECT id FROM tb_contacts WHERE unit_id = ? AND deleted_at IS NULL)
          ORDER BY v.visit_date DESC, v.updated_at DESC`,
        [unitId],
      );

  // นัดหมาย: ที่ยังค้างทั้งหมด + ประวัติย้อนหลัง 1 ปี (ไม่ต้องส่งทั้งหมดทุกครั้ง)
  const apptSelect = `SELECT a.id, a.patient_id, a.contact_id, a.appt_date, a.appt_time, a.appt_time_end, a.department, a.contact_point, a.instructions, a.telemed, a.purpose, a.place, a.doctor_name, a.note,
            a.status, a.source, a.visit_id, a.hosxp_oapp_id, a.hosxp_status, a.version, a.updated_at,
            u.display_name AS by_name, un.name AS by_unit_name
       FROM tb_appointments a LEFT JOIN tb_users u ON u.id = COALESCE(a.updated_by, a.created_by) LEFT JOIN tb_units un ON un.id = u.unit_id
      WHERE a.deleted_at IS NULL AND (a.status = 'scheduled' OR a.appt_date >= CURDATE() - INTERVAL 1 YEAR)`;
  const [appointments] = admin
    ? await db.query<Row[]>(`${apptSelect} ORDER BY a.appt_date, a.appt_time`)
    : await db.query<Row[]>(
        `${apptSelect} AND a.contact_id IN (SELECT id FROM tb_contacts WHERE unit_id = ? AND deleted_at IS NULL) ORDER BY a.appt_date, a.appt_time`,
        [unitId],
      );

  const [followups] = admin
    ? await db.query<Row[]>(
        `SELECT f.patient_id, f.slot, f.month_no, f.test, f.test_date, f.result, f.note
           FROM tb_treatment_followups f JOIN tb_patients p ON p.id = f.patient_id
          WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY f.patient_id, f.slot`,
      )
    : [[] as Row[]];

  // §6.3 สรุปผู้สัมผัสต่อผู้ป่วย — query รวมครั้งเดียว ไม่ N+1
  const [counts] = await db.query<Row[]>(
    `SELECT c.patient_id, c.contact_type, COUNT(*) AS total, SUM(${isTBSql("c")}) AS tb
       FROM tb_contacts c WHERE c.deleted_at IS NULL ${admin ? "" : "AND c.unit_id = ?"}
      GROUP BY c.patient_id, c.contact_type`,
    admin ? [] : [unitId],
  );
  const contactSummary = Object.fromEntries(summarizeContacts(counts as unknown as ContactCountRow[]));

  const [settingRows] = admin ? await db.query<Row[]>("SELECT k, v FROM tb_settings") : [[] as Row[]];
  const settings = Object.fromEntries(settingRows.map((r) => [r.k as string, r.v as string]));
  const [targets] = await db.query<Row[]>("SELECT fy, quarter, indicator, target, unit FROM tb_targets ORDER BY fy, quarter");

  return { today: todayBangkok(), units, patients, contacts, visits, appointments, followups, contactSummary, settings, targets };
}

/** user unit ค้นผู้ป่วย index เพื่อเพิ่มผู้สัมผัส — คืนเฉพาะช่องที่จำเป็น, จำกัด 20 ราย */
export async function searchPatients(db: Queryable, q: string): Promise<Row[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const [rows] = await db.query<Row[]>(
    `SELECT ${UNIT_PATIENT_COLS}, p.area FROM tb_patients p
      WHERE p.deleted_at IS NULL AND (p.hn = ? OR p.name LIKE ?)
      ORDER BY p.fy DESC, p.start_date DESC LIMIT 20`,
    [term, `%${term.replace(/[%_\\]/g, "\\$&")}%`],
  );
  return rows;
}
