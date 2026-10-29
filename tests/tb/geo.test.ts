// แผนที่: ระยะทาง / พิกัด / ชื่อ / วงผู้สัมผัส + อ่าน Sheet พิกัดบ้าน (ข้อมูลสังเคราะห์)
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResidents, residentIndex } from "../../lib/pikad.ts";
import { contactTypeOfRing, distanceMeters, formatDistance, nameKey, nearby, parseLatLng, pointOf, ringOf } from "../../lib/tb/geo.ts";

const home = { lat: 14.7, lng: 103.2 };
const north = (m: number) => ({ lat: home.lat + m / 111195, lng: home.lng }); // 1° lat ≈ 111.195 กม.

test("distanceMeters (Haversine) ตรงกับระยะจริง", () => {
  assert.equal(Math.round(distanceMeters(home, north(50))), 50);
  assert.equal(Math.round(distanceMeters(home, north(1000))), 1000);
  assert.equal(distanceMeters(home, home), 0);
});

test("ringOf: ≤10 ม. ร่วมบ้าน, ≤50 วง 2, ≤200 วง 3, เกิน = นอกวง", () => {
  assert.deepEqual([0, 10, 11, 50, 51, 200, 201].map(ringOf), [1, 1, 2, 2, 3, 3, null]);
  assert.equal(contactTypeOfRing(1), "household");
  assert.equal(contactTypeOfRing(3), "close");
  assert.equal(formatDistance(35.4), "35 ม.");
  assert.equal(formatDistance(1250), "1.3 กม.");
});

test("parseLatLng / pointOf: รับ , และ / ตัดพิกัดนอกประเทศไทย", () => {
  assert.deepEqual(parseLatLng("14.7, 103.2"), { lat: 14.7, lng: 103.2 });
  assert.deepEqual(parseLatLng("14.7/103.2"), { lat: 14.7, lng: 103.2 });
  assert.equal(parseLatLng("103.2, 14.7"), null);
  assert.equal(parseLatLng(""), null);
  assert.deepEqual(pointOf("14.7", 103.2), { lat: 14.7, lng: 103.2 });
  assert.equal(pointOf(null, 103.2), null);
  assert.equal(pointOf(0, 0), null);
});

test("nameKey ตัดคำนำหน้าและช่องว่าง", () => {
  assert.equal(nameKey("นางสาว ทดสอบ  ระบบ"), "ทดสอบระบบ");
  assert.equal(nameKey("ด.ช.ทดสอบ ระบบ"), "ทดสอบระบบ");
  assert.equal(nameKey("นาย ทดสอบ ระบบ"), nameKey("ทดสอบ ระบบ"));
});

test("nearby เรียงใกล้ → ไกล + ใส่วง", () => {
  const list = [{ id: "a", ...north(150) }, { id: "b", ...north(5) }, { id: "c", ...north(400) }, { id: "d", ...north(40) }];
  const r = nearby(home, list, 200);
  assert.deepEqual(r.map((x) => [x.id, x.ring]), [["b", 1], ["d", 2], ["a", 3]]);
});

test("parseResidents + residentIndex: จับคู่เลขบัตรก่อน แล้วค่อยชื่อ", () => {
  const rows = [
    ["14.7, 103.2", "นาย ทดสอบ หนึ่ง", "1-2345-67890-12-3", "01/01/2500", "https://maps.example/1"],
    ["999, 1", "พิกัดผิด", "", "", ""],
    ["14.701/103.2", "นางสาว ทดสอบ สอง", "", "2000-05-01", ""],
    ["", "ไม่มีพิกัด"],
  ];
  const list = parseResidents(rows);
  assert.equal(list.length, 2);
  assert.equal(list[0].cid, "1234567890123");
  assert.equal(list[0].birthday, "1957-01-01");
  assert.equal(list[1].cid, null);
  const idx = residentIndex(list);
  assert.equal(idx.find("1234567890123", "ชื่ออื่น")?.by, "cid");
  assert.equal(idx.find(null, "ทดสอบ สอง")?.r.lat, 14.701);
  assert.equal(idx.find(null, "ไม่มีใคร"), null);
});
