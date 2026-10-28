// เนื้อหาไฟล์ Word 4 แบบ ตามระบบเดิม: ประวัติผู้ป่วย / รายการติดตาม (ลงพื้นที่) / รายการนัด / สรุปแดชบอร์ด
import { toast } from "@/components/ui";
import { CONTACT_TYPE_LABEL } from "@/lib/tb/constants";
import { isTB } from "@/lib/tb/contacts";
import { addDays, diffDays, formatThaiDate } from "@/lib/tb/dates";
import { followupsForForm, toFollowupInput } from "@/lib/tb/followups";
import { isConcluded, patientStart, screened } from "@/lib/tb/tasks";
import { contactStatus, isRR, patientAddress, th } from "./bits";
import type { DueItem, useApp } from "./store";
import type { Contact, Patient } from "./types";
import { downloadWord, type Block } from "./word";

type Store = ReturnType<typeof useApp>;
const d = (x: string | null | undefined) => formatThaiDate(x); // วว/ดด/ปปปป พ.ศ.
const pct = (a: number, b: number) => (b ? `${Math.round((a * 100) / b)}%` : "–");
const fuMonths = (c: Contact) => (c.contact_type === "close" ? [12, 24] : [6, 12, 18, 24]);

async function save(s: Store, filename: string, title: string, blocks: Block[], landscape = false) {
  toast("กำลังสร้างไฟล์ Word…");
  try {
    await downloadWord(filename, title, blocks, {
      landscape,
      footer: `พิมพ์จากระบบทะเบียนวัณโรค รพ.พลับพลาชัย · ${d(s.data.today)} · ผู้พิมพ์ ${s.data.user.displayName} (${s.data.user.unitName})`,
    });
    toast("ดาวน์โหลดไฟล์ Word แล้ว");
  } catch (err) {
    toast(`สร้างไฟล์ Word ไม่สำเร็จ: ${(err as Error).message}`, "bad");
  }
}

export function exportPatientWord(s: Store, p: Patient) {
  const cs = s.contactsOf(p.id);
  const vs = [...s.visitsOf(p.id)].sort((a, b) => a.visit_date.localeCompare(b.visit_date));
  const fus = followupsForForm(s.followupsOf(p.id).map(toFollowupInput));
  const eps = s.data.patients.filter((x) => x.id !== p.id && ((p.hn && x.hn === p.hn) || (p.cid && x.cid === p.cid)));
  const blocks: Block[] = [
    { t: "h1", text: "ประวัติผู้ป่วยวัณโรค" },
    { t: "sub", text: `ปีงบประมาณ ${p.fy} · โรงพยาบาลพลับพลาชัย` },
    { t: "h2", text: "ข้อมูลทั่วไป" },
    { t: "kv", rows: [
      ["ชื่อ-สกุล", p.name], ["HN", p.hn], ["TB number", p.tb_no], ["เลขบัตรประชาชน", p.cid],
      ["เพศ / อายุ", [p.sex, p.age ? `${p.age} ปี` : ""].filter(Boolean).join(" / ")], ["สิทธิการรักษา", p.rights],
      ["ที่อยู่ตามทะเบียน", patientAddress(p)], ["ที่อยู่ปัจจุบัน", p.current_address], ["รพ.สต.รับผิดชอบ", s.unitName(p.unit_id)], ["โทรศัพท์", p.phone],
      ["โรคร่วม", p.comorbid], ["ผล HIV", p.hiv],
    ] },
    { t: "h2", text: "การวินิจฉัยและการรักษา" },
    { t: "kv", rows: [
      ["ประเภทผู้ป่วย", p.patient_type], ["สถานที่ลงทะเบียน", p.reg_place], ["วิธีวินิจฉัย", p.diag_basis], ["ผลดื้อ Rifampicin", p.rr],
      ["วันวินิจฉัย", d(p.diag_date)], ["วันเริ่มยา", d(p.start_date)], ["สูตรยา", p.regimen],
      ["Admit – D/C", [d(p.admit_date), d(p.dc_date)].filter(Boolean).join(" – ")], ["LFT ก่อนเริ่มยา", p.lft],
    ] },
    ...(isRR(p) ? [{ t: "warn", text: "ดื้อ Rifampicin: ส่งต่อศูนย์วัณโรคดื้อยาจังหวัด" } as Block] : []),
    { t: "h2", text: "ผลการติดตามระหว่างรักษา" },
    { t: "table", head: ["เดือนที่", "ตรวจ", "วันที่", "ผล"], rows: fus.map((f) => [f.month_no, f.test, d(f.test_date), f.result]), widths: [15, 20, 25, 40] },
    { t: "h2", text: "ผลการรักษา" },
    { t: "kv", rows: [["ผลการรักษา", p.outcome || "กำลังรักษา"], ["วันสรุปผล", d(p.outcome_date)]] },
    { t: "h2", text: `บันทึกการรักษา / ติดตาม (${vs.length} ครั้ง)` },
    { t: "table", head: ["วันที่", "ประเภท", "รายละเอียด", "ผู้บันทึก"], rows: vs.map((v) => [d(v.visit_date), v.visit_type, v.detail, v.by_name]), widths: [15, 20, 47, 18] },
    ...(p.notes ? [{ t: "h2", text: "บันทึก" } as Block, { t: "p", text: p.notes } as Block] : []),
    ...(eps.length ? [
      { t: "h2", text: "เคยขึ้นทะเบียนวัณโรค" } as Block,
      { t: "table", head: ["ปีงบ", "ประเภท", "วันเริ่มยา", "สูตรยา", "ผลการรักษา"], rows: eps.map((x) => [x.fy, x.patient_type, d(x.start_date), x.regimen, x.outcome || "กำลังรักษา"]) } as Block,
    ] : []),
    { t: "h2", text: `ผู้สัมผัส (${cs.length} คน)` },
    { t: "table",
      head: ["ชื่อ-สกุล", "ความสัมพันธ์", "ประเภท", "สอบสวน", "คัดกรอง / ผล", "TPT", "ติดตาม", "สถานะ"],
      rows: cs.map((c) => [
        c.name, c.relation, CONTACT_TYPE_LABEL[c.contact_type], d(c.invest_date),
        [d(c.screen_date), c.screen_result].filter(Boolean).join(" / "), [c.tpt_regimen, c.tpt_status].filter(Boolean).join(" "),
        fuMonths(c).map((n) => `${n}ด:${c[`fu${n}_date` as "fu6_date"] ? "✓" : "–"}`).join(" "),
        contactStatus(c, s.tasksOfContact(c), s.data.today).text,
      ]),
      widths: [17, 11, 9, 11, 14, 9, 13, 16] },
  ];
  return save(s, `ประวัติผู้ป่วย_${p.name}_HN${p.hn ?? ""}`, "ประวัติผู้ป่วยวัณโรค", blocks);
}

/** รายการติดตาม — พิมพ์ไปลงพื้นที่ มีช่อง "ผล / ลงชื่อ" ว่างไว้เขียน */
export function exportDueWord(s: Store, items: DueItem[], unitLabel: string) {
  const t = s.data.today;
  const week = addDays(t, 7);
  const groups: [string, DueItem[]][] = [
    ["เกินกำหนด", items.filter((x) => x.due! < t)],
    ["ภายใน 7 วัน", items.filter((x) => x.due! >= t && x.due! <= week)],
    ["8–30 วัน", items.filter((x) => x.due! > week)],
  ];
  const row = (x: DueItem) => {
    const c = x.kind === "C" ? (x.rec as Contact) : null;
    const idx = c ? s.patientById(c.patient_id) : null;
    return [
      th(x.due) + (x.due! < t ? ` (เกิน ${diffDays(x.due!, t)} วัน)` : ""), `${x.step} ${x.what}`, x.rec.name,
      c ? `${c.relation ?? ""} ของ ${idx?.name ?? ""}` : `ผู้ป่วย HN ${(x.rec as Patient).hn ?? ""}`,
      c ? s.unitName(c.unit_id) : (x.rec as Patient).area, x.rec.phone, c ? (c.current_address || c.address) : ((x.rec as Patient).current_address || patientAddress(x.rec as Patient)), "",
    ];
  };
  const blocks: Block[] = [
    { t: "h1", text: "รายการติดตามผู้ป่วยวัณโรคและผู้สัมผัส" },
    { t: "sub", text: `${unitLabel ? `${unitLabel} · ` : ""}ข้อมูล ณ ${d(t)} · งานที่เกินกำหนดและถึงกำหนดภายใน 30 วัน` },
    ...groups.flatMap(([title, g]) => g.length ? [
      { t: "h2", text: `${title} (${g.length})` } as Block,
      { t: "table", head: ["กำหนด", "งาน", "ชื่อ-สกุล", "ความเกี่ยวข้อง", "หน่วย/พื้นที่", "โทรศัพท์", "ที่อยู่", "ผล / ลงชื่อ"], rows: g.map(row), widths: [11, 17, 15, 17, 11, 10, 9, 10] } as Block,
    ] : []),
  ];
  return save(s, `รายการติดตาม_${unitLabel || "ทุกหน่วย"}_${t}`, "รายการติดตาม", blocks, true);
}

export interface ApptEntry { appt: string; kind: "P" | "C"; rec: Patient | Contact; summary: string }

export function exportApptWord(s: Store, groups: [string, ApptEntry[]][], unitLabel: string) {
  const row = (a: ApptEntry) => {
    const c = a.kind === "C" ? (a.rec as Contact) : null;
    const idx = c ? s.patientById(c.patient_id) : null;
    return [
      th(a.appt), a.rec.name, c ? "ผู้สัมผัส" : "ผู้ป่วย", c ? `${c.relation ?? ""} ของ ${idx?.name ?? ""}` : `HN ${(a.rec as Patient).hn ?? ""}`,
      s.unitName(a.rec.unit_id) || (a.rec as Patient).area, a.rec.phone, a.summary, "",
    ];
  };
  const blocks: Block[] = [
    { t: "h1", text: "รายการนัดหมาย ผู้ป่วยวัณโรคและผู้สัมผัส" },
    { t: "sub", text: `${unitLabel ? `${unitLabel} · ` : ""}ข้อมูล ณ ${d(s.data.today)}` },
    ...groups.flatMap(([title, list]) => list.length ? [
      { t: "h2", text: `${title} (${list.length})` } as Block,
      { t: "table", head: ["วันนัด", "ชื่อ-สกุล", "ประเภท", "HN / ความเกี่ยวข้อง", "หน่วย/พื้นที่", "โทรศัพท์", "เรื่องที่นัด", "มา / ลงชื่อ"], rows: list.map(row), widths: [10, 16, 9, 17, 12, 10, 16, 10] } as Block,
    ] : []),
  ];
  return save(s, `รายการนัด_${unitLabel || "ทุกหน่วย"}_${s.data.today}`, "รายการนัดหมาย", blocks, true);
}

/** สรุปผลการดำเนินงานตามช่วงที่เลือกบนแดชบอร์ด (รายงานพิมพ์ — มีหัวข้อผู้สัมผัสแบบระบบเดิม) */
export function exportDashWord(s: Store, P: Patient[], periodLabel: string) {
  const ids = new Set(P.map((p) => p.id));
  const C = s.data.contacts.filter((c) => ids.has(c.patient_id));
  const final = P.filter((p) => isConcluded(p.outcome));
  const success = final.filter((p) => p.outcome === "หาย" || p.outcome === "รักษาครบ").length;
  const count = (f: (p: Patient) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const p of P) { const k = f(p) || "ไม่ระบุ"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n, pct(n, P.length)]);
  };
  const typeN = (t: string) => P.filter((p) => p.patient_type === t).length;
  const inv = C.filter((c) => c.invest_date);
  const inv7 = inv.filter((c) => {
    const st = patientStart(s.patientById(c.patient_id));
    return st && diffDays(st, c.invest_date!) <= 7;
  });
  const scr = C.filter(screened);
  const tb = C.filter(isTB);
  const tptE = C.filter((c) => c.tpt_eligible === "ใช่");
  const tptS = tptE.filter((c) => c.tpt_start);
  const late = (c: Contact) => { const t = s.tasksOfContact(c)[0]; return !!t?.due && t.due < s.data.today; };
  const units = s.data.units
    .map((u) => { const x = C.filter((c) => c.unit_id === u.id); return [u.name, x.length, x.filter(screened).length, x.filter(isTB).length, x.filter((c) => c.tpt_start).length, x.filter(late).length]; })
    .filter((r) => Number(r[1]) > 0);
  const blocks: Block[] = [
    { t: "h1", text: `สรุปผลการดำเนินงานวัณโรค ปีงบประมาณ ${s.fy}` },
    { t: "sub", text: `โรงพยาบาลพลับพลาชัย และ รพ.สต. ในเครือข่าย · ${periodLabel} · ข้อมูล ณ ${d(s.data.today)}` },
    { t: "h2", text: "1. ผู้ป่วยวัณโรค" },
    { t: "table", head: ["ตัวชี้วัด", "ผล"], widths: [45, 55], rows: [
      ["ผู้ป่วยขึ้นทะเบียน", `${P.length} ราย`], ["รายใหม่ (NEW)", `${typeN("NEW")} ราย`], ["กลับเป็นซ้ำ (Relapse)", `${typeN("Relapse")} ราย`],
      ["อัตราความสำเร็จการรักษา (หาย+รักษาครบ)", `${pct(success, final.length)} (${success}/${final.length} รายที่สรุปผลแล้ว)`],
      ["กำลังรักษา", `${P.length - final.length} ราย`], ["เสียชีวิต", `${P.filter((p) => p.outcome === "เสียชีวิต").length} ราย`],
      ["ขาดยา", `${P.filter((p) => p.outcome === "ขาดยา").length} ราย`], ["ดื้อ Rifampicin", `${P.filter(isRR).length} ราย`],
    ] },
    { t: "h2", text: "2. ผลการรักษา" }, { t: "table", head: ["รายการ", "จำนวน", "ร้อยละ"], rows: count((p) => p.outcome || "กำลังรักษา") },
    { t: "h2", text: "3. ประเภทการขึ้นทะเบียน" }, { t: "table", head: ["รายการ", "จำนวน", "ร้อยละ"], rows: count((p) => p.patient_type) },
    { t: "h2", text: "4. ผู้ป่วยตามพื้นที่" }, { t: "table", head: ["รายการ", "จำนวน", "ร้อยละ"], rows: count((p) => p.area) },
    { t: "h2", text: "5. การค้นหาและติดตามผู้สัมผัส" },
    { t: "table", head: ["ตัวชี้วัด", "ผล"], widths: [45, 55], rows: [
      ["ผู้สัมผัสที่ระบุได้", `${C.length} คน (ร่วมบ้าน ${C.filter((c) => c.contact_type !== "close").length} · ใกล้ชิด ${C.filter((c) => c.contact_type === "close").length})`],
      ["ผู้ป่วยที่ยังไม่มีข้อมูลผู้สัมผัส", `${P.filter((p) => !s.contactsOf(p.id).length).length} จาก ${P.length} ราย`],
      ["A สอบสวนภายใน 7 วัน", `${pct(inv7.length, inv.length)} (${inv7.length}/${inv.length})`],
      ["B คัดกรองแล้ว", `${pct(scr.length, C.length)} (${scr.length}/${C.length})`],
      ["พบป่วยวัณโรค (yield)", `${tb.length} คน (${pct(tb.length, scr.length)} ของผู้ที่คัดกรอง)`],
      ["C เริ่ม TPT / เข้าเกณฑ์", `${tptS.length}/${tptE.length}`],
      ["D ติดตามครบ 2 ปี", `${C.filter((c) => c.fu24_date).length} คน`],
    ] },
    ...(units.length ? [
      { t: "h2", text: "6. แยกตาม รพ.สต." } as Block,
      { t: "table", head: ["หน่วยบริการ", "ผู้สัมผัส", "คัดกรอง", "ป่วย TB", "เริ่ม TPT", "เกินกำหนด"], rows: units } as Block,
    ] : []),
  ];
  return save(s, `สรุปวัณโรค_ปีงบ${s.fy}`, "สรุปผลการดำเนินงานวัณโรค", blocks);
}
