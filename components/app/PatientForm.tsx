"use client";
// ฟอร์มผู้ป่วย (P_FORM เดิม) + ติดตามระหว่างรักษาได้ถึง 12 ช่อง (§6.4) + ดึงข้อมูลจาก HOSxP ตาม HN
import { useState } from "react";
import { Button, ComboInput, Field, Grid, Input, Modal, Section, Select, Textarea, toast } from "@/components/ui";
import { MAX_FOLLOWUP_SLOTS } from "@/lib/tb/constants";
import { fyOf } from "@/lib/tb/dates";
import { FOLLOWUP_TESTS, followupsForForm, nextFreeSlot, toFollowupInput, type FollowupInput } from "@/lib/tb/followups";
import { OPTIONS } from "@/lib/tb/options";
import { api, ApiError } from "./api";
import { patientAddress } from "./bits";
import { useHosxp } from "./hosxp";
import { useApp } from "./store";
import type { Patient } from "./types";

type Form = Record<string, string>;
const KEYS = [
  "name", "hn", "tb_no", "cid", "sex", "age", "rights", "phone", "address", "area", "amphoe", "province", "postcode", "current_address", "unit_id", "lat", "lng", "comorbid", "hiv",
  "patient_type", "reg_place", "diag_basis", "rr", "diag_date", "start_date", "regimen", "admit_date", "dc_date", "lft",
  "outcome", "outcome_date", "notes", "seq",
] as const;

const toForm = (p: Partial<Patient>): Form =>
  Object.fromEntries(KEYS.map((k) => [k, p[k as keyof Patient] === null || p[k as keyof Patient] === undefined ? "" : String(p[k as keyof Patient])]));

export function PatientForm({ patient }: { patient: Partial<Patient> | null }) {
  const { open, data, reload, followupsOf } = useApp();
  const units = data.units;
  const isNew = !patient?.id;
  const [f, setF] = useState<Form>(() => toForm({ outcome: "กำลังรักษา", reg_place: "รพ.พลับพลาชัย", patient_type: "NEW", ...patient }));
  const [fus, setFus] = useState<FollowupInput[]>(() =>
    followupsForForm(patient?.id ? followupsOf(patient.id).map(toFollowupInput) : []),
  );
  const [busy, setBusy] = useState(false);
  const bind = (k: string) => ({ value: f[k] ?? "", onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })) });
  const date = f.start_date || f.diag_date;
  const otherEpisodes = f.hn ? data.patients.filter((x) => x.hn === f.hn.trim() && x.id !== patient?.id) : [];
  const back = () => (isNew ? open(null) : open({ type: "patient", id: patient!.id! }));

  // HOSxP: กรอก HN แล้วออกจากช่อง / เลขบัตรครบ 13 หลัก → เติมช่องว่างให้เอง, ปุ่ม = ดึงใหม่ทับทุกช่อง
  const hx = useHosxp(data.features.hosxp, f, setF, (r) => ({
    hn: r.hn, name: r.name, cid: r.cid, sex: r.sex, age: r.age, rights: r.rights, phone: r.phone,
    address: r.address, area: r.area, amphoe: r.amphoe, province: r.province, postcode: r.postcode,
  }));
  const regAddress = patientAddress(f);

  function setFu(slot: number, patch: Partial<FollowupInput>) {
    setFus((list) => list.map((x) => (x.slot === slot ? { ...x, ...patch } : x)));
  }

  async function save() {
    if (!f.name.trim()) return toast("กรุณากรอกชื่อ-สกุล", "bad");
    if (!date) return toast("กรุณากรอกวันเริ่มยาหรือวันวินิจฉัย", "bad");
    setBusy(true);
    const body = {
      data: { ...f, unit_id: f.unit_id ? Number(f.unit_id) : null, followups: fus },
      version: patient?.version,
    };
    try {
      const r = isNew ? await api<{ id: string }>("POST", "/api/patients", body) : await api<{ id: string }>("PUT", `/api/patients/${patient!.id}`, body);
      toast("บันทึกแล้ว");
      await reload();
      open({ type: "patient", id: r.id });
    } catch (err) {
      toast((err as Error).message, "bad");
      if (err instanceof ApiError && err.status === 409) await reload();
    } finally {
      setBusy(false);
    }
  }

  const free = nextFreeSlot(fus.map((x) => x.slot));
  const unitOpts = units.filter((u) => u.role === "unit").map((u) => ({ value: u.id, label: u.name }));

  return (
    <Modal
      open
      wide
      onClose={back}
      title={isNew ? "ลงทะเบียนผู้ป่วยวัณโรค" : `แก้ไข: ${patient!.name}`}
      subtitle={`* จำเป็น · ปีงบคำนวณจากวันเริ่มยาอัตโนมัติ (ต.ค.–ก.ย.)${date ? ` → ปีงบ ${fyOf(date)}` : ""}`}
      footer={<><Button variant="ghost" onClick={back}>ยกเลิก</Button><Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button></>}
    >
      <Section title="ข้อมูลทั่วไป">
        <Grid>
          <Field label="HN" hint={otherEpisodes.length ? `เคยขึ้นทะเบียน: ${otherEpisodes.map((x) => `ปีงบ ${x.fy} (${x.outcome})`).join(", ")}` : undefined}>
            <div className="flex gap-2">
              <Input {...bind("hn")} inputMode="numeric" onBlur={() => isNew && hx.lookup({ hn: f.hn }, false)} />
              {data.features.hosxp && <Button variant="ghost" size="sm" disabled={hx.loading} onClick={() => hx.lookup({ hn: f.hn, cid: f.cid }, true)} className="flex-none">{hx.loading ? "กำลังดึง…" : "ดึงจาก HOSxP"}</Button>}
            </div>
          </Field>
          <Field label="ชื่อ-สกุล *"><Input {...bind("name")} /></Field>
          <Field label="TB number"><Input {...bind("tb_no")} /></Field>
          <Field label="เลขบัตรประชาชน">
            <Input {...bind("cid")} inputMode="numeric" maxLength={17}
              onBlur={() => isNew && !f.hn.trim() && hx.lookup({ cid: f.cid }, false)} />
          </Field>
          <Field label="เพศ"><Select options={OPTIONS.sex} {...bind("sex")} /></Field>
          <Field label="อายุ (ปี)"><Input type="number" min={0} max={150} {...bind("age")} /></Field>
          <Field label="สิทธิการรักษา"><ComboInput listId="dl-rights" options={OPTIONS.pttype} {...bind("rights")} /></Field>
          <Field label="โทรศัพท์"><Input type="tel" {...bind("phone")} /></Field>
          <Field label="บ้านเลขที่ / หมู่"><Input {...bind("address")} /></Field>
          <Field label="ตำบล / พื้นที่"><Input {...bind("area")} /></Field>
          <Field label="อำเภอ"><Input {...bind("amphoe")} /></Field>
          <Field label="จังหวัด"><Input {...bind("province")} /></Field>
          <Field label="รหัสไปรษณีย์"><Input {...bind("postcode")} inputMode="numeric" maxLength={5} /></Field>
          <Field label="รพ.สต.รับผิดชอบ"><Select options={unitOpts} {...bind("unit_id")} /></Field>
          <Field label="โรคร่วม (U/D)"><Input {...bind("comorbid")} /></Field>
          <Field label="ผล HIV"><Select options={OPTIONS.hiv} {...bind("hiv")} /></Field>
          <Field label="Latitude"><Input inputMode="decimal" {...bind("lat")} /></Field>
          <Field label="Longitude"><Input inputMode="decimal" {...bind("lng")} /></Field>
          <Field label={<span className="flex flex-wrap items-center gap-2">ที่อยู่ปัจจุบัน (ที่อยู่จริง ใช้ลงเยี่ยม)
            {regAddress && <button type="button" className="text-brand-2 underline" onClick={() => setF((x) => ({ ...x, current_address: regAddress }))}>เหมือนที่อยู่ตามทะเบียน</button>}</span>} wide>
            <Input {...bind("current_address")} placeholder="ว่าง = อยู่ตามที่อยู่ทะเบียน" />
          </Field>
        </Grid>
      </Section>

      <Section title="1–3 วินิจฉัยและเริ่มรักษา">
        <Grid>
          <Field label="ประเภทผู้ป่วย"><Select options={OPTIONS.patientType} {...bind("patient_type")} /></Field>
          <Field label="สถานที่ลงทะเบียน"><Input {...bind("reg_place")} /></Field>
          <Field label="วิธีวินิจฉัย / ผล"><ComboInput listId="dl-diag" options={OPTIONS.diagMethod} {...bind("diag_basis")} /></Field>
          <Field label="ผลดื้อ Rifampicin"><Select options={OPTIONS.rifResistance} {...bind("rr")} /></Field>
          <Field label="วันวินิจฉัย"><Input type="date" {...bind("diag_date")} /></Field>
          <Field label="วันเริ่มยา *"><Input type="date" {...bind("start_date")} /></Field>
          <Field label="สูตรยา"><ComboInput listId="dl-regimen" options={OPTIONS.regimen} {...bind("regimen")} /></Field>
          <Field label="วัน admit"><Input type="date" {...bind("admit_date")} /></Field>
          <Field label="วัน discharge"><Input type="date" {...bind("dc_date")} /></Field>
          <Field label="LFT ก่อนเริ่มยา" wide><Textarea rows={2} {...bind("lft")} /></Field>
        </Grid>
      </Section>

      <Section title={`4 ติดตามระหว่างรักษา (${fus.length}/${MAX_FOLLOWUP_SLOTS} ช่อง)`}>
        <div className="space-y-2">
          {fus.map((x) => (
            <div key={x.slot} className="grid grid-cols-2 gap-2 rounded-xl bg-background p-2 sm:grid-cols-[5rem_7rem_1fr_1fr_auto]">
              <Field label="เดือนที่"><Input type="number" min={0} max={24} value={x.month_no} onChange={(e) => setFu(x.slot, { month_no: Number(e.target.value) })} /></Field>
              <Field label="ตรวจ"><Select options={FOLLOWUP_TESTS} placeholder={false} value={x.test} onChange={(e) => setFu(x.slot, { test: e.target.value as FollowupInput["test"] })} /></Field>
              <Field label="วันที่"><Input type="date" value={x.test_date ?? ""} onChange={(e) => setFu(x.slot, { test_date: e.target.value || null })} /></Field>
              <Field label="ผล">
                <ComboInput listId={`dl-fu-${x.test}`} options={x.test === "AFB" ? OPTIONS.afb : x.test === "CXR" ? OPTIONS.cxr : []} value={x.result ?? ""} onChange={(e) => setFu(x.slot, { result: e.target.value || null })} />
              </Field>
              <div className="flex items-end">
                {x.slot > 5 ? (
                  <Button variant="plain" size="sm" onClick={() => setFus((l) => l.filter((y) => y.slot !== x.slot))} aria-label="ลบช่องนี้">ลบ</Button>
                ) : (
                  (x.test_date || x.result) && <Button variant="plain" size="sm" onClick={() => setFu(x.slot, { test_date: null, result: null })}>ล้าง</Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {free !== null && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setFus((l) => [...l, { slot: free, month_no: 8, test: "AFB" as const, test_date: null, result: null, note: null }].sort((a, b) => a.slot - b.slot))}>
            + เพิ่มเติม
          </Button>
        )}
      </Section>

      <Section title="5 สรุปผลการรักษา">
        <Grid>
          <Field label="ผลการรักษา"><Select options={OPTIONS.outcome} placeholder={false} {...bind("outcome")} /></Field>
          <Field label="วันสรุปผล"><Input type="date" {...bind("outcome_date")} /></Field>
          <Field label="บันทึก" wide><Textarea {...bind("notes")} /></Field>
        </Grid>
      </Section>
    </Modal>
  );
}
