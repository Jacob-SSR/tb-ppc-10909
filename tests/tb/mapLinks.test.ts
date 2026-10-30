import assert from "node:assert/strict";
import { test } from "node:test";
import { hospitalDirections } from "../../lib/tb/mapLinks.ts";

test("เส้นทางขับรถเริ่มที่ รพ.พลับพลาชัย และสิ้นสุดที่พิกัดบ้านที่เลือก", () => {
  const link = new URL(hospitalDirections({ lat: 14.65969, lng: 103.106494 }));
  assert.equal(link.origin, "https://www.google.com");
  assert.equal(link.pathname, "/maps/dir/");
  assert.equal(link.searchParams.get("api"), "1");
  assert.equal(link.searchParams.get("origin"), "โรงพยาบาลพลับพลาชัย บุรีรัมย์");
  assert.equal(link.searchParams.get("destination"), "14.65969,103.106494");
  assert.equal(link.searchParams.get("travelmode"), "driving");
  assert.equal(link.searchParams.has("query"), false);
});
