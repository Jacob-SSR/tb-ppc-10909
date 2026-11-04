import ExcelJS from "exceljs";
import type { NearbyPerson } from "../repo/map.ts";
import { RING_LABEL } from "./geo.ts";

export async function mapWorkbook(people: NearbyPerson[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("คนรอบบ้าน");
  ws.columns = [
    { header: "ลำดับ", key: "no", width: 8 },
    { header: "ชื่อ-นามสกุล", key: "name", width: 30 },
    { header: "CID", key: "cid", width: 18, style: { numFmt: "@" } },
    { header: "ระยะใกล้ที่สุด (เมตร)", key: "distance", width: 24 },
    { header: "วง", key: "ring", width: 22 },
    { header: "ผู้ป่วยที่ใกล้ที่สุด", key: "center", width: 30 },
    { header: "รหัสผู้ป่วยที่ใกล้ที่สุด", key: "centerId", width: 24 },
    { header: "ที่อยู่", key: "address", width: 40 },
    { header: "แผนที่", key: "map", width: 50 },
  ];
  people.forEach((p, i) => ws.addRow({ no: i + 1, name: p.name, cid: p.cid ?? "", distance: Math.round(p.distance), ring: p.ring ? RING_LABEL[p.ring] : "นอกวง", center: p.centerName, centerId: p.centerId, address: p.address ?? "", map: p.mapLink ?? "" }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}
