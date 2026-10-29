// lib/repo/map.ts — แผนที่ผู้ป่วย (admin): พิกัดจากทะเบียน หรือจับคู่จาก ชีตประชากร (pikad)
//   + คนที่อยู่รอบบ้านผู้ป่วย พร้อมวงที่แนะนำ และบอกว่าบันทึกเป็นผู้สัมผัสแล้วหรือยัง
import type { Queryable } from "../audit.ts";
import { badRequest, notFound } from "../errors.ts";
import { loadResidents, pikadConfigured, type Resident, residentAge, residentIndex } from "../pikad.ts";
import { type LatLng, nameKey, nearby, normCid, pointOf } from "../tb/geo.ts";
import type { Row } from "./common.ts";

export interface MapPoint extends LatLng {
  by: "db" | "cid" | "name"; // พิกัดมาจากทะเบียน / จับคู่ pikad ด้วยเลขบัตร / ด้วยชื่อ
  mapLink: string | null;
}

export interface NearbyPerson extends LatLng {
  name: string;
  cid: string | null;
  age: number | null;
  sex: string | null;
  nationality: string | null;
  deceased: boolean | null;
  address: string | null;
  phone: string | null;
  distance: number;
  ring: 1 | 2 | 3 | null;
  mapLink: string | null;
  contactId: string | null; // ผู้สัมผัสของผู้ป่วยรายนี้อยู่แล้ว
  patientId: string | null; // เป็นผู้ป่วยในทะเบียน
}

export const MAX_RADIUS = 500;
const MAX_RESULTS = 300;

/** pikad อ่านไม่ได้ → แผนที่ยังใช้พิกัดในทะเบียนได้ */
async function residentsOrError(fresh = false): Promise<{ list: Resident[]; error: string | null }> {
  if (!pikadConfigured()) return { list: [], error: null };
  try {
    return { list: await loadResidents(fresh), error: null };
  } catch (err) {
    console.error("[pikad]", err);
    return { list: [], error: "อ่าน ชีตประชากรไม่ได้ (ตรวจว่าแชร์ไฟล์ให้ service account แล้ว)" };
  }
}

type PatientGeo = { id: string; name: string; cid: string | null; lat: unknown; lng: unknown };

function locate(p: PatientGeo, idx: ReturnType<typeof residentIndex>): MapPoint | null {
  const db = pointOf(p.lat, p.lng);
  if (db) return { ...db, by: "db", mapLink: null };
  const hit = idx.find(p.cid, p.name);
  return hit ? { lat: hit.r.lat, lng: hit.r.lng, by: hit.by, mapLink: hit.r.mapLink } : null;
}

export async function mapPoints(db: Queryable, fresh = false) {
  const [rows] = await db.query<Row[]>("SELECT id, name, cid, lat, lng FROM tb_patients WHERE deleted_at IS NULL");
  const { list, error } = await residentsOrError(fresh);
  const idx = residentIndex(list);
  const points: Record<string, MapPoint> = {};
  for (const p of rows as unknown as PatientGeo[]) {
    const pt = locate(p, idx);
    if (pt) points[p.id] = pt;
  }
  return { pikad: pikadConfigured(), residents: list.length, error, points };
}

export async function nearbyPeople(db: Queryable, patientId: string, radius: number) {
  if (!Number.isFinite(radius) || radius < 10 || radius > MAX_RADIUS) throw badRequest(`รัศมีต้องอยู่ระหว่าง 10–${MAX_RADIUS} ม.`);
  const [[p]] = await db.query<Row[]>("SELECT id, name, cid, lat, lng FROM tb_patients WHERE id = ? AND deleted_at IS NULL", [patientId]);
  if (!p) throw notFound("ไม่พบผู้ป่วย");
  const { list, error } = await residentsOrError();
  const center = locate(p as unknown as PatientGeo, residentIndex(list));
  if (!center) throw badRequest("ผู้ป่วยรายนี้ยังไม่มีพิกัดบ้าน");

  const [contacts] = await db.query<Row[]>("SELECT id, name, cid FROM tb_contacts WHERE patient_id = ? AND deleted_at IS NULL", [patientId]);
  const [patients] = await db.query<Row[]>("SELECT id, name, cid FROM tb_patients WHERE deleted_at IS NULL");
  const keyed = (rows: Row[]) => {
    const byCid = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const r of rows) {
      const c = normCid(r.cid);
      if (c.length === 13) byCid.set(c, String(r.id));
      byName.set(nameKey(r.name), String(r.id));
    }
    return (cid: string | null, name: string) => (cid && byCid.get(cid)) || byName.get(nameKey(name)) || null;
  };
  const contactOf = keyed(contacts);
  const patientOf = keyed(patients);
  const selfCid = normCid(p.cid);
  const selfName = nameKey(p.name);

  const people: NearbyPerson[] = nearby(center, list, radius)
    .filter((r) => !(r.cid && r.cid === selfCid) && nameKey(r.name) !== selfName) // ตัวผู้ป่วยเอง
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      lat: r.lat, lng: r.lng, name: r.name, cid: r.cid, age: residentAge(r), distance: r.distance, ring: r.ring,
      sex: r.sex, nationality: r.nationality, deceased: r.deceased, address: r.address, phone: r.phone,
      mapLink: r.mapLink, contactId: contactOf(r.cid, r.name), patientId: patientOf(r.cid, r.name),
    }));
  return { center, radius, error, people };
}
