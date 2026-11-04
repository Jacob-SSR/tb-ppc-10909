import assert from "node:assert/strict";
import { test } from "node:test";
import { nearbyMany } from "../../lib/tb/geo.ts";
import { mapWorkbook } from "../../lib/tb/mapExport.ts";
import type { NearbyPerson } from "../../lib/repo/map.ts";
import ExcelJS from "exceljs";

const north = (m: number) => ({ lat: 14.7 + m / 111195, lng: 103.2 });
test("three centers deduplicate overlapping people and assign the nearest ring", () => {
  const centers = [{ id: "a", ...north(0) }, { id: "b", ...north(80) }, { id: "c", ...north(220) }];
  const list = [{ cid: "same", ...north(90) }, { cid: "same", ...north(95) }, { cid: "other", ...north(400) }, { cid: "far", ...north(900) }];
  const result = nearbyMany(centers, list, 200, p => p.cid);
  assert.equal(result.length, 2);
  assert.equal(result[0].centerId, "b");
  assert.equal(result[0].ring, 1);
  assert.equal(result[1].centerId, "c");
  assert.equal(result[1].ring, 3);
  assert.deepEqual(result, nearbyMany([...centers].reverse(), [...list].reverse(), 200, p => p.cid));
  assert.deepEqual(nearbyMany([], list, 200, p => p.cid), []);
});
test("ring boundaries and radius use unrounded distance", () => {
  const list = [10.2, 50.2, 200.2].map((m, id) => ({ id, ...north(m) }));
  assert.deepEqual(nearbyMany([{ id: "a", ...north(0) }], list, 500, p => String(p.id)).map(p => p.ring), [2, 3, null]);
  assert.equal(nearbyMany([{ id: "a", ...north(0) }], list, 200, p => String(p.id)).length, 2);
});
test("large overlapping results are complete and namesakes remain separate without CID", () => {
  const list = Array.from({ length: 400 }, (_, id) => ({ id, name: "ชื่อเดียวกัน", ...north(20) }));
  const result = nearbyMany([{ id: "a", ...north(0) }, { id: "b", ...north(80) }, { id: "c", ...north(220) }], list, 200, p => String(p.id));
  assert.equal(result.length, 400);
  assert.equal(new Set(result.map(p => p.id)).size, 400);
});
test("Excel preserves CID leading zero, nearest patient, and one row per result", async () => {
  const p: NearbyPerson = { ...north(5), name: "ทดสอบ", cid: "0123456789012", centerId: "P0000000001", centerName: "ผู้ป่วย A", age: 35, sex: null, nationality: null, deceased: null, address: null, phone: null, distance: 5, ring: 1, mapLink: null, contactId: null, patientId: null };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await mapWorkbook([p]));
  const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 2);
  assert.equal(ws.getCell("C2").value, "0123456789012");
  assert.equal(ws.getCell("F2").value, "ผู้ป่วย A");
});
