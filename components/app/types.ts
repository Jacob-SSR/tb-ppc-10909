// รูปข้อมูลที่ /api/data ส่งมา (ชื่อคอลัมน์ตาม schema)
import type { ContactSummary } from "@/lib/tb/contacts";
import type { ContactRow, FollowupRow, PatientRow, TargetRow, UnitRole } from "@/lib/tb/types";

/** user unit ได้ผู้ป่วยแค่บางช่อง (§3) — ช่องอื่นเป็น undefined */
export type Patient = PatientRow & { created_at?: string; updated_at?: string };
export type Contact = ContactRow & { created_at?: string; updated_at?: string };
export type Followup = FollowupRow;

export interface Visit {
  id: string;
  patient_id: string | null;
  contact_id: string | null;
  visit_date: string;
  visit_type: string;
  detail: string | null;
  next_appt: string | null;
  lat: number | null;
  lng: number | null;
  created_by: number;
  updated_at: string;
  by_name: string;
  by_unit_id: number;
  by_unit_name: string;
}

export interface Unit {
  id: number;
  name: string;
  role: UnitRole;
  hcode: string | null;
  active: number;
}

export interface Me {
  id: number;
  username: string;
  displayName: string;
  unitId: number;
  unitName: string;
  role: UnitRole;
}

export interface AppData {
  today: string;
  user: Me;
  units: Unit[];
  patients: Patient[];
  contacts: Contact[];
  visits: Visit[];
  followups: Followup[];
  contactSummary: Record<string, ContactSummary>;
  settings: Record<string, string>;
  targets: TargetRow[];
  features: { hosxp: boolean; line: boolean; email: boolean; sheet: boolean };
}
