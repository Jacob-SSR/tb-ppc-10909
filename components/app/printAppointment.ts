import { formatThaiDate } from "@/lib/tb/dates";

export function printAppointment(win: Window, person: { name: string; hn?: string | null } | undefined, appt: {
  appt_date: string; appt_time: string; appt_time_end: string; purpose: string; place: string;
  department: string; contact_point: string; doctor_name: string; instructions: string; note: string; telemed: boolean;
}, compact: boolean) {
  const doc = win.document;
  doc.title = "ใบนัดหมาย";
  const style = doc.createElement("style");
  style.textContent = "body{font-family:Tahoma,sans-serif;max-width:700px;margin:32px auto;padding:20px;line-height:1.8;color:#172e28}h1{border-bottom:2px solid #1d4d40}p{white-space:pre-wrap}button{padding:10px 24px}@media print{button{display:none}body{margin:0}}";
  doc.head.append(style);
  const title = doc.createElement("h1"); title.textContent = "ใบนัดหมาย · ทะเบียนวัณโรค"; doc.body.append(title);
  const lines = [
    person?.name ?? "", `HN ${person?.hn || "-"}`,
    `วันนัด: ${formatThaiDate(appt.appt_date)}  เวลา ${appt.appt_time || "ไม่ระบุ"}${appt.appt_time_end ? ` – ${appt.appt_time_end}` : ""}`,
    `เรื่องที่นัด: ${appt.purpose}`, `คลินิก: ${appt.place || "-"}`, `ห้องตรวจ: ${appt.department || "-"}`,
    `จุดติดต่อ: ${appt.contact_point || "-"}`, `แพทย์ / ผู้นัด: ${appt.doctor_name || "-"}`,
    appt.telemed ? "นัดผ่าน Telemed" : "",
    !compact && appt.instructions ? `การปฏิบัติตัวก่อนพบแพทย์:\n${appt.instructions}` : "",
    appt.note ? `หมายเหตุ:\n${appt.note}` : "",
  ];
  for (const line of lines.filter(Boolean)) { const p = doc.createElement("p"); p.textContent = line; doc.body.append(p); }
  const button = doc.createElement("button"); button.textContent = "พิมพ์ใบนัด"; button.onclick = () => win.print(); doc.body.append(button);
  win.focus(); win.print();
}
