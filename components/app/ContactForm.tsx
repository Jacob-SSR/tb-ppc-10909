"use client";
// ฟอร์มผู้สัมผัส (C_FORM เดิม) + เบอร์โทร/ที่อยู่ปัจจุบัน (§6.5) + สถานที่รักษาเมื่อป่วย (§6.3)
import { useState } from "react";
import { Badge, Button, ComboInput, Field, Grid, Input, Modal, Section, Select, Textarea, toast } from "@/components/ui";
import { CONTACT_FOLLOWUP_MONTHS, CONTACT_TYPE_LABEL, TB_RESULT, type ContactType } from "@/lib/tb/constants";
import { isTB } from "@/lib/tb/contacts";
import { addDays, addMonths } from "@/lib/tb/dates";
import { OPTIONS } from "@/lib/tb/options";
import { patientStart } from "@/lib/tb/tasks";
import { api, ApiError } from "./api";
import { Tel, TaskLine, th } from "./bits";
import { useHosxp } from "./hosxp";
import { useApp } from "./store";
import { Timeline } from "./Timeline";
import type { Contact } from "./types";

const KEYS = [
  "patient_id", "name", "cid", "hn", "sex", "age", "relation", "contact_type", "ring", "unit_id", "address", "current_address",
  "phone", "tb_treat_place", "risk", "invest_date", "screen_date", "symptom", "cxr_date", "cxr_result", "screen_result",
  "tpt_eligible", "tpt_regimen", "tpt_start", "tpt_end", "tpt_status",
  "fu6_date", "fu6_result", "fu12_date", "fu12_result", "fu18_date", "fu18_result", "fu24_date", "fu24_result", "notes",
] as const;
type Form = Record<(typeof KEYS)[number], string>;

const toForm = (c: Partial<Contact>) =>
  Object.fromEntries(KEYS.map((k) => [k, c[k as keyof Contact] == null ? "" : String(c[k as keyof Contact])])) as Form;

export function ContactForm({ contact }: { contact: Partial<Contact> }) {
  const { open, data, isAdmin, patientById, reload, unitName, tasksOfContact } = useApp();
  const isNew = !contact.id;
  const p = patientById(contact.patient_id);
  const canEdit = isAdmin || isNew || contact.unit_id === data.user.unitId;
  const [f, setF] = useState<Form>(() => toForm({ contact_type: "household", ...contact, unit_id: contact.unit_id ?? (isAdmin ? undefined : data.user.unitId) }));
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof Form) => ({
    value: f[k], disabled: !canEdit,
    onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })),
  });
  const type = (f.contact_type || "household") as ContactType;
  const months = CONTACT_FOLLOWUP_MONTHS[type];
  const base = f.screen_date || f.cxr_date || f.invest_date;
  const sick = [f.screen_result, f.fu6_result, f.fu12_result, f.fu18_result, f.fu24_result].includes(TB_RESULT);
  const tasks = isNew ? [] : tasksOfContact(contact as Contact);
  const start = patientStart(p);
  const back = () => (p ? open({ type: "patient", id: p.id }) : open(null));
  const unitOpts = data.units.map((u) => ({ value: u.id, label: u.name }));
  // HOSxP เฉพาะทีม รพ. (มีข้อมูลทั้งโรงพยาบาล — CLAUDE.md §12 ข้อ 8): HN / เลขบัตร → เติมช่องว่างให้เอง
  const hosxpOn = data.features.hosxp && isAdmin && canEdit;
  const hx = useHosxp(hosxpOn, f, setF, (r) => ({
    hn: r.hn, name: r.name, cid: r.cid, sex: r.sex, age: r.age, phone: r.phone, address: r.fullAddress,
  }));

  async function save() {
    if (!f.name.trim()) return toast("กรุณากรอกชื่อผู้สัมผัส", "bad");
    if (isAdmin && !f.unit_id) return toast("กรุณาเลือก รพ.สต.รับผิดชอบ", "bad");
    setBusy(true);
    const body = {
      data: { ...f, unit_id: f.unit_id ? Number(f.unit_id) : null, ring: f.ring || null },
      version: contact.version,
    };
    try {
      if (isNew) await api("POST", "/api/contacts", body);
      else await api("PUT", `/api/contacts/${contact.id}`, body);
      toast("บันทึกแล้ว");
      await reload();
      back();
    } catch (err) {
      toast((err as Error).message, "bad");
      if (err instanceof ApiError && err.status === 409) await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`ยืนยันลบ "${contact.name}" ?`)) return;
    try {
      await api("DELETE", `/api/contacts/${contact.id}?version=${contact.version}`);
      toast("ลบแล้ว");
      await reload();
      back();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  async function convert() {
    const sd = prompt("วันเริ่มยาของผู้ป่วยรายใหม่ (วว/ดด/ปปปป พ.ศ.) — เว้นว่างได้", "");
    if (sd === null) return;
    try {
      const r = await api<{ patientId: string }>("POST", `/api/contacts/${contact.id}/convert`, { startDate: sd.trim() || null });
      toast("ลงทะเบียนผู้ป่วยใหม่แล้ว กรุณากรอกข้อมูลการรักษาให้ครบ");
      await reload();
      open({ type: "patient", id: r.patientId });
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  const hidden = (m: number) => !months.includes(m as 6) && !f[`fu${m}_date` as keyof Form] && !f[`fu${m}_result` as keyof Form];

  return (
    <Modal
      open
      wide
      onClose={back}
      title={isNew ? "เพิ่มผู้สัมผัส" : contact.name}
      subtitle={p ? <>ผู้ป่วย index: <b>{p.name}</b> (HN {p.hn || "-"}) · เริ่มยา {th(start) || "-"}{start ? ` · ควรสอบสวนภายใน ${th(addDays(start, 7))}` : ""}</> : "ไม่พบผู้ป่วย index"}
      footer={
        <>
          {!isNew && isAdmin && <Button variant="danger" size="sm" onClick={remove}>ลบ</Button>}
          {!isNew && canEdit && <Button variant="ghost" size="sm" onClick={() => open({ type: "history", id: contact.id!, title: `${contact.name} (ผู้สัมผัส)`, back: { type: "contact", contact } })}>ประวัติการแก้ไข</Button>}
          {!isNew && isAdmin && isTB(contact as Contact) && !contact.new_patient_id && <Button size="sm" onClick={convert}>ลงทะเบียนเป็นผู้ป่วยรายใหม่ →</Button>}
          {contact.new_patient_id && <Button variant="ghost" size="sm" onClick={() => open({ type: "patient", id: contact.new_patient_id! })}>ดูผู้ป่วยรายใหม่</Button>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={back}>{canEdit ? "ยกเลิก" : "ปิด"}</Button>
          {canEdit && <Button variant="contact" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>}
        </>
      }
    >
      {tasks.length > 0 && (
        <div className="mb-3 flex flex-col gap-0.5 rounded-xl bg-warn-bg p-3 text-sm">
          <span className="text-xs text-muted">งานถัดไป</span>
          {tasks.map((t) => <TaskLine key={t.step + t.what} t={t} today={data.today} />)}
        </div>
      )}
      <Section title="ข้อมูลผู้สัมผัส" tone="contact">
        <Grid>
          <Field label="ชื่อ-สกุล *"><Input {...bind("name")} /></Field>
          <Field label="ประเภทการสัมผัส">
            <Select placeholder={false} options={(["household", "close"] as const).map((v) => ({ value: v, label: CONTACT_TYPE_LABEL[v] }))} {...bind("contact_type")} />
          </Field>
          <Field label="ความสัมพันธ์กับผู้ป่วย"><ComboInput listId="dl-rel" options={OPTIONS.relation} {...bind("relation")} /></Field>
          <Field label={<>โทรศัพท์ {f.phone && <Tel phone={f.phone} />}</>}><Input type="tel" inputMode="tel" {...bind("phone")} /></Field>
          <Field label="เลขบัตรประชาชน">
            <Input inputMode="numeric" maxLength={17} {...bind("cid")} onBlur={() => isNew && !f.hn.trim() && hx.lookup({ cid: f.cid }, false)} />
          </Field>
          <Field label="HN">
            <div className="flex gap-2">
              <Input {...bind("hn")} onBlur={() => isNew && hx.lookup({ hn: f.hn }, false)} />
              {hosxpOn && <Button variant="ghost" size="sm" disabled={hx.loading} onClick={() => hx.lookup({ hn: f.hn, cid: f.cid }, true)} className="flex-none">{hx.loading ? "กำลังดึง…" : "ดึงจาก HOSxP"}</Button>}
            </div>
          </Field>
          <Field label="เพศ"><Select options={OPTIONS.sex} {...bind("sex")} /></Field>
          <Field label="อายุ (ปี)"><Input type="number" min={0} max={150} {...bind("age")} /></Field>
          <Field label="วงรัศมี (1 ร่วมบ้าน / 2 10–50 ม. / 3 100–200 ม.)"><Select options={OPTIONS.ring} {...bind("ring")} /></Field>
          <Field label="รพ.สต.รับผิดชอบ">
            {isAdmin ? <Select options={unitOpts} {...bind("unit_id")} /> : <Input value={unitName(Number(f.unit_id)) || data.user.unitName} readOnly />}
          </Field>
          <Field label="กลุ่มเสี่ยง"><ComboInput listId="dl-risk" options={OPTIONS.riskGroup} {...bind("risk")} /></Field>
          <Field label="ที่อยู่ตามทะเบียนบ้าน" wide><Input {...bind("address")} /></Field>
          <Field label={<span className="flex flex-wrap items-center gap-2">ที่อยู่ปัจจุบัน (ที่อยู่จริง ใช้ลงเยี่ยม)
            {canEdit && <button type="button" className="text-brand-2 underline" onClick={() => setF((x) => ({ ...x, current_address: x.address }))}>เหมือนที่อยู่ตามทะเบียน</button>}</span>} wide>
            <Input {...bind("current_address")} />
          </Field>
        </Grid>
      </Section>

      <Section title="A สอบสวนผู้สัมผัส (ภายใน 7 วัน)" tone="contact">
        <Grid><Field label="วันสอบสวน"><Input type="date" {...bind("invest_date")} /></Field></Grid>
      </Section>

      <Section title="B คัดกรอง (ซักอาการ + CXR)" tone="contact">
        <Grid>
          <Field label="วันคัดกรอง"><Input type="date" {...bind("screen_date")} /></Field>
          <Field label="ซักอาการ"><Select options={OPTIONS.symptoms} {...bind("symptom")} /></Field>
          <Field label="วันทำ CXR"><Input type="date" {...bind("cxr_date")} /></Field>
          <Field label="ผล CXR"><Select options={OPTIONS.cxrResult} {...bind("cxr_result")} /></Field>
          <Field label="สรุปผลคัดกรอง"><Select options={OPTIONS.screenResult} {...bind("screen_result")} /></Field>
          {(sick || f.tb_treat_place) && !contact.new_patient_id && (
            <Field label="สถานที่รักษา (ถ้าไม่ได้ลงทะเบียนที่ รพ.พลับพลาชัย)" hint="ถ้ารักษาที่ รพ. เรา ให้ทีม รพ. กด 'ลงทะเบียนเป็นผู้ป่วยรายใหม่'">
              <Input {...bind("tb_treat_place")} placeholder="เช่น รพ.บุรีรัมย์" />
            </Field>
          )}
        </Grid>
      </Section>

      <Section title="C TPT ในผู้เข้าเกณฑ์" tone="contact">
        <Grid>
          <Field label="เข้าเกณฑ์ TPT"><Select options={OPTIONS.tptEligible} {...bind("tpt_eligible")} /></Field>
          <Field label="สูตร TPT"><Select options={OPTIONS.tptRegimen} {...bind("tpt_regimen")} /></Field>
          <Field label="วันเริ่ม TPT">
            <Input type="date" {...bind("tpt_start")} onChange={(e) => setF((x) => ({ ...x, tpt_start: e.target.value, tpt_status: e.target.value && !x.tpt_status ? "กำลังกิน" : x.tpt_status }))} />
          </Field>
          <Field label="วันกินครบ/หยุด"><Input type="date" {...bind("tpt_end")} /></Field>
          <Field label="สถานะ TPT"><Select options={OPTIONS.tptStatus} {...bind("tpt_status")} /></Field>
        </Grid>
      </Section>

      <Section title={`D ติดตามซักอาการ + CXR ครบ 2 ปี (${type === "close" ? "ใกล้ชิด: ปีละครั้ง" : "ร่วมบ้าน: ทุก 6 เดือน"})`} tone="contact">
        <p className="mb-2 text-xs text-contact">
          {base ? `กำหนดติดตาม: ${months.map((n) => `${n} ด. ${th(addMonths(base, n))}`).join(" · ")}` : "กำหนดติดตามจะคำนวณหลังบันทึกวันคัดกรอง"}
        </p>
        <Grid>
          {[6, 12, 18, 24].filter((m) => !hidden(m)).map((m) => (
            <div key={m} className="contents">
              <Field label={`${m} เดือน: วันที่`}><Input type="date" {...bind(`fu${m}_date` as keyof Form)} /></Field>
              <Field label={`${m} เดือน: ผล`}><Select options={OPTIONS.followupResult} {...bind(`fu${m}_result` as keyof Form)} /></Field>
            </div>
          ))}
          <Field label="บันทึก" wide><Textarea {...bind("notes")} /></Field>
        </Grid>
      </Section>

      {!isNew && <Timeline refId={contact.id!} label={contact.name ?? ""} canAdd={canEdit} />}
      {!canEdit && <Badge tone="muted">ดูได้อย่างเดียว — อยู่นอกเขตรับผิดชอบของหน่วยท่าน</Badge>}
    </Modal>
  );
}
