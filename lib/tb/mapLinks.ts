import type { LatLng } from "./geo.ts";

/** Google Maps คำนวณเส้นทางตามถนน โดยเริ่มจาก รพ.พลับพลาชัยเสมอ */
export function hospitalDirections(point: LatLng): string {
  const params = new URLSearchParams({
    api: "1",
    origin: "โรงพยาบาลพลับพลาชัย บุรีรัมย์",
    destination: `${point.lat},${point.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
