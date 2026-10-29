// lib/tb/geo.ts — แผนที่: ระยะทาง, แยกพิกัด, เทียบชื่อ, วงผู้สัมผัส (ฟังก์ชันล้วน)
// วงตาม DB_Contacts: 1 = ร่วมบ้าน, 2 = รัศมี 10–50 ม., 3 = รัศมี 100–200 ม.
// ระยะ ≤ 10 ม. ถือว่าบ้านเดียวกัน (พิกัดบ้านจาก GPS คลาดได้ราว 5–10 ม.) · 51–200 ม. = วง 3

export interface LatLng {
  lat: number;
  lng: number;
}

/** ระยะทาง Haversine (เมตร) — สูตรเดียวกับ pikad-phlapphla-chai */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** อยู่ในประเทศไทยไหม — กันพิกัดกรอกผิด (เช่นสลับ lat/lng) */
export function inThailand(p: LatLng): boolean {
  return p.lat >= 5.4 && p.lat <= 20.6 && p.lng >= 97.2 && p.lng <= 105.8;
}

/** "14.68, 103.37" หรือ "14.68/103.37" → พิกัด (นอกประเทศไทย = null) */
export function parseLatLng(s: unknown): LatLng | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const [a, b] = t.split(t.includes("/") ? "/" : ",");
  const p = { lat: parseFloat((a ?? "").trim()), lng: parseFloat((b ?? "").trim()) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && inThailand(p) ? p : null;
}

/** พิกัดจากคอลัมน์ lat/lng ของทะเบียน (ว่าง/ผิด = null) */
export function pointOf(lat: unknown, lng: unknown): LatLng | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const p = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && inThailand(p) ? p : null;
}

const PREFIXES = ["เด็กชาย", "เด็กหญิง", "นางสาว", "น.ส.", "ด.ช.", "ด.ญ.", "นาย", "นาง"];

/** คีย์เทียบชื่อ: ตัดคำนำหน้า + ช่องว่าง (แบบ tb-map ใน ppc-hos) */
export function nameKey(name: unknown): string {
  let n = String(name ?? "").trim().replace(/​/g, "");
  for (const p of PREFIXES) {
    if (n.startsWith(p)) {
      n = n.slice(p.length);
      break;
    }
  }
  return n.replace(/\s+/g, "");
}

export const normCid = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export const RING_MAX = { 1: 10, 2: 50, 3: 200 } as const;
export const RING_LABEL: Record<1 | 2 | 3, string> = {
  1: "วง 1 ร่วมบ้าน",
  2: "วง 2 ≤ 50 ม.",
  3: "วง 3 ≤ 200 ม.",
};

/** ระยะจากบ้านผู้ป่วย → วงที่แนะนำ (เกิน 200 ม. = null) */
export function ringOf(meters: number): 1 | 2 | 3 | null {
  if (meters <= RING_MAX[1]) return 1;
  if (meters <= RING_MAX[2]) return 2;
  if (meters <= RING_MAX[3]) return 3;
  return null;
}

/** วง 1 = ร่วมบ้าน, วงอื่น = ใกล้ชิด */
export const contactTypeOfRing = (ring: number | null): "household" | "close" => (ring === 1 ? "household" : "close");

/** "1.2 กม." / "35 ม." */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`;
}

/** หาคนที่อยู่ในรัศมี เรียงใกล้ → ไกล */
export function nearby<T extends LatLng>(center: LatLng, list: T[], radius: number): (T & { distance: number; ring: 1 | 2 | 3 | null })[] {
  return list
    .map((p) => {
      const distance = Math.round(distanceMeters(center, p));
      return { ...p, distance, ring: ringOf(distance) };
    })
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}
