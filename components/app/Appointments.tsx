"use client";
// นัดหมาย: ฟอร์มเพิ่ม/แก้/เลื่อน/มาตามนัด/ยกเลิก/ลบ, รายการนัดในหน้าผู้ป่วย-ผู้สัมผัส, เลือกคนก่อนนัด, ดึงนัดจาก HOSxP
import { useEffect, useState } from "react";
import { Badge, Button, Card, ComboInput, Empty, Field, Grid, Input, Modal, Section, Select, Spinner, Textarea, toast } from "@/components/ui";
import { APPT_PURPOSES, APPT_SOURCE_LABEL, APPT_STATUS_LABEL, apptSummary, type ApptStatus } from "@/lib/tb/appointments";
import { api, ApiError } from "./api";
import { th } from "./bits";
import { useApp, type ModalState } from "./store";
import type { Appt } from "./types";
import { AppointmentTimePicker } from "./AppointmentTimePicker";
import { AppointmentNoteTemplates } from "./AppointmentNoteTemplates";
import { printAppointment } from "./printAppointment";
import { APPT_INSTRUCTIONS } from "@/lib/tb/appointmentSlots";

type AppointmentOptions = { clinics: string[]; departments: string[]; doctors: string[]; purposes: string[]; contactPoints: string[] };

/** คลินิกนัดผู้สัมผัส (ชื่อเดียวกับคลินิกใน HOSxP) */
const APPT_CLINICS = ["Household", "Close contact"] as const;

const STATUS_TONE: Record<ApptStatus, "brand" | "ok" | "bad" | "muted"> = { scheduled: "brand", done: "ok", missed: "bad", cancelled: "muted" };

/** ป้ายสถานะ — นัดไว้แต่เลยวันแล้ว = ขาดนัด (ยังไม่บันทึก) */
export function ApptStatusBadge({ a, today }: { a: Pick<Appt, "status" | "appt_date">; today: string }) {
  if (a.status === "scheduled" && a.appt_date < today) return <Badge tone="bad">เลยนัด ยังไม่บันทึก</Badge>;
  return <Badge tone={STATUS_TONE[a.status]}>{APPT_STATUS_LABEL[a.status]}</Badge>;
}

const toTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** ส่งเฉพาะช่องที่ API รับ */
function body(a: Partial<Appt>, patch: Partial<Appt> = {}) {
  const x = { ...a, ...patch };
  return {
    patient_id: x.patient_id ?? null, contact_id: x.contact_id ?? null, appt_date: x.appt_date, appt_time: x.appt_time || null,
    purpose: x.purpose, place: x.place || null, doctor_name: x.doctor_name || null, note: x.note || null, status: x.status ?? "scheduled",
    hosxp_oapp_id: x.hosxp_oapp_id ?? null,
    appt_time_end: x.appt_time_end || null, department: x.department || null, contact_point: x.contact_point || null,
    instructions: x.instructions || null, telemed: !!x.telemed,
  };
}

/** เปลี่ยนสถานะเร็ว (มาตามนัด / ขาดนัด / ยกเลิก) จากรายการ */
export function useApptStatus() {
  const { reload } = useApp();
  return async (a: Appt, status: ApptStatus) => {
    try {
      await api("PUT", `/api/appointments/${a.id}`, { data: body(a, { status }), version: a.version });
      toast(`${APPT_STATUS_LABEL[status]}แล้ว`);
      await reload();
    } catch (err) {
      toast((err as Error).message, "bad");
      if (err instanceof ApiError && err.status === 409) await reload();
    }
  };
}

export function AppointmentForm({ appt, back }: { appt: Partial<Appt>; back?: ModalState }) {
  const { data, isAdmin, open, reload, patientById, contactById, unitName } = useApp();
  const isNew = !appt.id;
  const refId = appt.patient_id ?? appt.contact_id ?? "";
  const person = appt.patient_id ? patientById(appt.patient_id) : appt.contact_id ? contactById(appt.contact_id) : undefined;
  const canEdit = isAdmin || !!appt.contact_id; // user unit เห็นเฉพาะผู้สัมผัสในเขตอยู่แล้ว
  const [f, setF] = useState({
    appt_date: appt.appt_date ?? data.today, appt_time: toTime(appt.appt_time), appt_time_end: toTime(appt.appt_time_end),
    department: appt.department ?? "", contact_point: appt.contact_point ?? "", instructions: appt.instructions ?? "", telemed: !!appt.telemed, purpose: appt.purpose ?? "",
    place: appt.place ?? (isNew && person && "contact_type" in person ? APPT_CLINICS[person.contact_type === "close" ? 1 : 0] : isAdmin ? "" : data.user.unitName), doctor_name: appt.doctor_name ?? "", note: appt.note ?? "",
    status: (appt.status ?? "scheduled") as ApptStatus,
  });
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<AppointmentOptions>({ clinics: [], departments: [], doctors: [], purposes: [], contactPoints: [] });
  const [optionsError, setOptionsError] = useState("");
  const [printAfter, setPrintAfter] = useState(false);
  const [printForm, setPrintForm] = useState("full");
  const [instruction, setInstruction] = useState("");
  useEffect(() => {
    if (!isAdmin || !data.features.hosxp) return;
    const controller = new AbortController();
    api<AppointmentOptions>("GET", "/api/hosxp/appointment-options")
      .then((r) => { if (!controller.signal.aborted) setOptions(r); })
      .catch((e: Error) => { if (!controller.signal.aborted) setOptionsError(e.message); });
    return () => controller.abort();
  }, [isAdmin, data.features.hosxp]);
  const bind = <K extends Exclude<keyof typeof f, "telemed">>(k: K) => ({ value: f[k], disabled: !canEdit || busy, onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })) });
  const close = () => open(back ?? null);
  // บันทึกเสร็จ: กลับหน้ารายละเอียดที่เปิดมา — แต่ถ้ามาจากหน้าเลือกคน (แท็บนัดหมาย) ปิดไปเลย
  const done = () => open(back?.type === "pickAppt" ? null : back ?? null);

  async function save(patch: Partial<typeof f> = {}) {
    if (busy) return;
    const v = { ...f, ...patch };
    if (!v.appt_date) return toast("กรุณาระบุวันนัด", "bad");
    if (!v.purpose.trim()) return toast("กรุณาระบุเรื่องที่นัด", "bad");
    if (isNew && !v.appt_time) return toast("กรุณาเลือกเวลานัด", "bad");
    if (v.appt_time_end && v.appt_time_end < v.appt_time) return toast("เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม", "bad");
    const printWindow = printAfter ? window.open("", "_blank") : null;
    if (printWindow) printWindow.opener = null;
    if (printAfter && !printWindow) return toast("กรุณาอนุญาตหน้าต่างป๊อปอัปเพื่อพิมพ์ใบนัด", "bad");
    setBusy(true);
    const payload = body(appt, { ...v, appt_time: v.appt_time || null });
    try {
      if (isNew) await api("POST", "/api/appointments", payload);
      else await api("PUT", `/api/appointments/${appt.id}`, { data: payload, version: appt.version });
      toast(patch.status ? `${APPT_STATUS_LABEL[patch.status]}แล้ว` : "บันทึกนัดแล้ว");
      if (printWindow) {
        try { printAppointment(printWindow, person, v, printForm === "compact"); }
        catch { toast("บันทึกนัดแล้ว แต่เปิดใบนัดไม่สำเร็จ", "bad"); printWindow.close(); }
      }
      await reload();
      done();
    } catch (err) {
      printWindow?.close();
      toast((err as Error).message, "bad");
      if (err instanceof ApiError && err.status === 409) await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("ลบนัดนี้? (ถ้าแค่ไม่มาตามนัดหรือยกเลิก ให้ใช้ปุ่มสถานะแทน)")) return;
    try {
      await api("DELETE", `/api/appointments/${appt.id}?version=${appt.version}`);
      toast("ลบนัดแล้ว");
      await reload();
      done();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  const who = person ? `${person.name}${appt.patient_id ? ` (ผู้ป่วย · HN ${(person as { hn?: string | null }).hn || "-"})` : ` (ผู้สัมผัส · ${unitName(person.unit_id) || "-"})`}` : "";
  return (
    <Modal
      open
      wide
      scrollable
      onClose={() => { if (!busy) close(); }}
      title={isNew ? "เพิ่มนัดหมาย" : "นัดหมาย"}
      subtitle={<>{who}{!isNew && <> · <ApptStatusBadge a={appt as Appt} today={data.today} /> <span className="text-xs">{APPT_SOURCE_LABEL[appt.source ?? "manual"]}{appt.by_name ? ` · แก้ล่าสุดโดย ${appt.by_name}` : ""}</span></>}</>}
      footer={
        <>
          {!isNew && isAdmin && <Button variant="danger" size="sm" disabled={busy} onClick={remove}>ลบ</Button>}
          {!isNew && canEdit && refId && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => open({
              type: "history", id: refId, title: `ประวัติ · ${person?.name ?? ""}`, back: { type: "appointment", appt, back },
            })}>ประวัติการแก้ไข</Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" disabled={busy} onClick={close}>{canEdit ? "ยกเลิก" : "ปิด"}</Button>
          {canEdit && <Button onClick={() => save()} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกนัด"}</Button>}
        </>
      }
    >
      {appt.source === "hosxp" && (
        <p className="mb-3 rounded-xl bg-mint p-3 text-sm">นัดนี้ดึงมาจาก HOSxP (oapp {appt.hosxp_oapp_id}) — ระบบอัปเดตสถานะ/วันเลื่อนตาม HOSxP ทุกเช้า 06:00 · การแก้ที่นี่ไม่ได้แก้ใน HOSxP</p>
      )}
      <Grid>
        <Field label="วันนัด *"><Input type="date" {...bind("appt_date")} /></Field>
        <Field label="เวลาเริ่ม *"><Input type="time" {...bind("appt_time")} /></Field>
        <Field label="เวลาสิ้นสุด"><Input type="time" {...bind("appt_time_end")} /></Field>
        <Field label="สถานะ">
          <Select placeholder={false} options={(Object.keys(APPT_STATUS_LABEL) as ApptStatus[]).map((s) => ({ value: s, label: APPT_STATUS_LABEL[s] }))} {...bind("status")} />
        </Field>
      </Grid>
      <AppointmentTimePicker date={f.appt_date} time={f.appt_time} place={f.place} excludeId={appt.id} disabled={!canEdit || busy}
        onSelect={(start, end) => setF((x) => ({ ...x, appt_time: start, appt_time_end: end }))} />
      {optionsError && <p role="status" className="mb-3 text-sm text-warn">{optionsError}</p>}
      <Grid>
        <Field label="เรื่องที่นัด *" wide><ComboInput listId="dl-appt-purpose" options={[...new Set([...options.purposes, ...APPT_PURPOSES])]} {...bind("purpose")} /></Field>
        <Field label="คลินิก / สถานที่"><ComboInput listId="dl-appt-place" options={[...new Set([...options.clinics, ...APPT_CLINICS, "คลินิกวัณโรค", data.user.unitName].filter(Boolean))]} {...bind("place")} /></Field>
        <Field label="แพทย์ / ผู้นัด"><ComboInput listId="appt-doctors" options={options.doctors} {...bind("doctor_name")} /></Field>
        <Field label="ห้องตรวจ"><ComboInput listId="appt-departments" options={options.departments} {...bind("department")} placeholder="เลือกหรือพิมพ์ห้องตรวจ" /></Field>
        <Field label="จุดติดต่อ"><ComboInput listId="appt-contact-points" options={options.contactPoints} {...bind("contact_point")} placeholder="เลือกหรือพิมพ์จุดติดต่อ" /></Field>
        <Field label="การปฏิบัติตัวก่อนพบแพทย์" wide>
          <div className="mb-2 flex gap-2">
            <ComboInput listId="appt-instructions" options={APPT_INSTRUCTIONS} value={instruction} disabled={!canEdit || busy} maxLength={200}
              onChange={(e) => setInstruction(e.target.value)} placeholder="เลือกหรือพิมพ์คำแนะนำทีละรายการ" />
            <Button variant="ghost" disabled={!canEdit || busy || !instruction.trim()} onClick={() => {
              const lines = [...new Set([...f.instructions.split("\n").filter(Boolean), instruction.trim()])].join("\n");
              if (lines.length > 2000) return toast("คำแนะนำยาวเกิน 2000 ตัวอักษร", "bad");
              setF((x) => ({ ...x, instructions: lines })); setInstruction("");
            }}>เพิ่ม</Button>
          </div>
          <Textarea rows={3} maxLength={2000} {...bind("instructions")} placeholder="รายการที่เลือก · แก้ไขหรือลบข้อความได้" />
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.telemed} disabled={!canEdit || busy} onChange={(e) => setF((x) => ({ ...x, telemed: e.target.checked }))} />Telemed</label>
        <Field label="หมายเหตุ" wide>
          <AppointmentNoteTemplates userId={data.user.id} note={f.note} disabled={!canEdit || busy} onSelect={(note) => setF((x) => ({ ...x, note }))} />
          <Textarea rows={3} maxLength={2000} {...bind("note")} placeholder="พิมพ์ข้อความที่นี่" />
          <div className="text-right text-xs text-muted">{f.note.length}/2000</div>
        </Field>
        <Field label="ฟอร์มใบนัด" wide>
          <Select options={[{ value: "full", label: "ใบนัดพร้อมคำแนะนำ" }, { value: "compact", label: "ใบนัดแบบย่อ" }]} placeholder={false} value={printForm} onChange={(e) => setPrintForm(e.target.value)} disabled={busy} />
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} disabled={!canEdit || busy} />พิมพ์ใบนัดหลังจากบันทึก</label>
        </Field>
      </Grid>
      {!isNew && canEdit && f.status === "scheduled" && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-background p-3">
          <span className="w-full text-xs text-muted">บันทึกผลนัดเร็ว</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ status: "done" })}>✓ มาตามนัด</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ status: "missed" })}>✗ ขาดนัด</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ status: "cancelled" })}>ยกเลิกนัด</Button>
          <span className="text-xs text-muted">· เลื่อนนัด = เปลี่ยนวันแล้วกด &quot;บันทึกนัด&quot;</span>
        </div>
      )}
    </Modal>
  );
}

/** รายการนัดของผู้ป่วย/ผู้สัมผัส 1 ราย (ในหน้ารายละเอียด) */
export function ApptSection({ patientId, contactId, hn, canAdd, back }: {
  patientId?: string; contactId?: string; hn?: string | null; canAdd: boolean; back: ModalState;
}) {
  const { data, isAdmin, open, apptsOf } = useApp();
  const status = useApptStatus();
  const ref = (patientId ?? contactId)!;
  const [all, setAll] = useState(false);
  const list = apptsOf(ref);
  const pending = list.filter((a) => a.status === "scheduled");
  const history = list.filter((a) => a.status !== "scheduled").sort((a, b) => b.appt_date.localeCompare(a.appt_date));
  const shown = all ? history : history.slice(0, 3);
  const row = (a: Appt) => (
    <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm first:border-t-0">
      <button className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left" onClick={() => open({ type: "appointment", appt: a, back })}>
        <b className="whitespace-nowrap">{th(a.appt_date)}</b>
        <span className="min-w-0">{apptSummary(a)}</span>
        <ApptStatusBadge a={a} today={data.today} />
        {a.source === "hosxp" && <Badge tone="muted">HOSxP</Badge>}
      </button>
      {a.status === "scheduled" && canAdd && <Button size="sm" variant="ghost" onClick={() => status(a, "done")}>✓ มาแล้ว</Button>}
    </div>
  );
  return (
    <Section title={`นัดหมาย (${pending.length} นัดค้าง)`}>
      {pending.length ? pending.map(row) : <p className="text-sm text-muted">ไม่มีนัดค้าง</p>}
      {history.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-muted">ประวัตินัด</div>
          {shown.map(row)}
          {history.length > 3 && <button className="text-xs text-brand-2 underline" onClick={() => setAll(!all)}>{all ? "ย่อ" : `ดูทั้งหมด ${history.length} รายการ`}</button>}
        </div>
      )}
      {canAdd && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => open({ type: "appointment", appt: { patient_id: patientId ?? null, contact_id: contactId ?? null }, back })}>+ นัดหมาย</Button>
          {isAdmin && hn && data.features.hosxp && (
            <Button size="sm" variant="ghost" onClick={() => open({ type: "hosxpAppts", patientId, contactId, back })}>ดึงนัดจาก HOSxP</Button>
          )}
        </div>
      )}
    </Section>
  );
}

/** เพิ่มนัดจากแท็บนัดหมาย — เลือกผู้ป่วย (admin) หรือผู้สัมผัสในเขตก่อน */
export function PickApptRef() {
  const { data, isAdmin, open, patientById } = useApp();
  const [q, setQ] = useState("");
  const norm = (s: unknown) => String(s ?? "").toLowerCase();
  const term = norm(q.trim());
  const patients = isAdmin ? data.patients.filter((p) => p.outcome === "กำลังรักษา" || !p.outcome) : [];
  const ps = patients.filter((p) => !term || norm(`${p.name} ${p.hn}`).includes(term)).slice(0, 30);
  const cs = data.contacts.filter((c) => !term || norm(`${c.name} ${c.hn ?? ""} ${c.phone ?? ""}`).includes(term)).slice(0, 30);
  return (
    <Modal open onClose={() => open(null)} title="เพิ่มนัดหมาย – เลือกผู้ป่วย/ผู้สัมผัส" subtitle={isAdmin ? "ผู้ป่วยที่กำลังรักษา และผู้สัมผัส" : `ผู้สัมผัสในเขต ${data.user.unitName}`}>
      <Input type="search" autoFocus placeholder="ค้นหาชื่อ / HN / เบอร์โทร" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="grid grid-cols-1 gap-2">
        {ps.map((p) => (
          <Card key={p.id} onClick={() => open({ type: "appointment", appt: { patient_id: p.id, contact_id: null }, back: { type: "pickAppt" } })}>
            <div className="font-semibold">{p.name} <Badge>ผู้ป่วย</Badge></div>
            <div className="text-sm text-muted">HN {p.hn || "-"} · เริ่มยา {th(p.start_date) || "-"}</div>
          </Card>
        ))}
        {cs.map((c) => (
          <Card key={c.id} onClick={() => open({ type: "appointment", appt: { contact_id: c.id, patient_id: null }, back: { type: "pickAppt" } })}>
            <div className="font-semibold">{c.name} <Badge tone="contact">ผู้สัมผัส</Badge></div>
            <div className="text-sm text-muted">{c.relation ?? ""} ของ {patientById(c.patient_id)?.name ?? "?"}{c.phone ? ` · ${c.phone}` : ""}</div>
          </Card>
        ))}
        {!ps.length && !cs.length && <Empty>ไม่พบ</Empty>}
      </div>
    </Modal>
  );
}

interface HosxpAppt {
  timeEnd?: string | null; department?: string; contactPoint?: string;
  oapp_id: string; date: string; time: string | null; clinic: string; place: string; doctor: string; cause: string; note: string;
  status: string | null; active: boolean; came: boolean; tbClinic: boolean; imported: string | null;
}

/** นัดใน HOSxP (oapp) ของผู้ป่วย/ผู้สัมผัสตาม HN → เลือกดึงเข้าระบบ (ดึงซ้ำ = อัปเดตรายการเดิม)
 *  นัดคลินิก household / close contact ระบบดึงเองทุกชั่วโมงอยู่แล้ว — หน้านี้ไว้ดึงนัดคลินิกอื่นหรือดึงทันที */
export function HosxpApptPicker({ patientId, contactId, back }: { patientId?: string; contactId?: string; back: ModalState }) {
  const { open, patientById, contactById, reload } = useApp();
  const p = patientId ? patientById(patientId) : contactId ? contactById(contactId) : undefined;
  const [list, setList] = useState<HosxpAppt[] | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!p?.hn) return;
    api<{ appointments: HosxpAppt[] }>("GET", `/api/hosxp/appointments?hn=${encodeURIComponent(p.hn)}`)
      .then((r) => {
        setList(r.appointments);
        setPick(new Set(r.appointments.filter((a) => a.active && !a.came && !a.imported).map((a) => a.oapp_id)));
      })
      .catch((e: Error) => setErr(e.message));
  }, [p?.hn]);

  async function importPicked() {
    setBusy(true);
    let n = 0;
    try {
      for (const a of (list ?? []).filter((x) => pick.has(x.oapp_id))) {
        await api("POST", "/api/appointments", {
          patient_id: patientId ?? null, contact_id: contactId ?? null, appt_date: a.date, appt_time: a.time,
          appt_time_end: a.timeEnd, department: a.department, contact_point: a.contactPoint, purpose: (a.cause || a.clinic || "นัด HOSxP").slice(0, 100),
          place: [a.clinic, a.place].filter(Boolean).join(" · ").slice(0, 150) || null, doctor_name: a.doctor || null, note: a.note || null,
          status: a.came ? "done" : a.active ? "scheduled" : "cancelled", hosxp_oapp_id: a.oapp_id, hosxp_status: a.status,
        });
        n++;
      }
      toast(`ดึงนัดจาก HOSxP แล้ว ${n} รายการ`);
      await reload();
      open(back);
    } catch (e) {
      toast(`${(e as Error).message}${n ? ` (ดึงแล้ว ${n} รายการ)` : ""}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={() => open(back)}
      title="ดึงนัดจาก HOSxP"
      subtitle={`${p?.name ?? ""} · HN ${p?.hn ?? "-"} · นัดตั้งแต่ 30 วันก่อน (ทุกคลินิก) — อ่านอย่างเดียว ไม่แก้ใน HOSxP · คลินิก household / close contact ระบบดึงให้เองทุกชั่วโมง`}
      footer={<><Button variant="ghost" onClick={() => open(back)}>ปิด</Button><Button onClick={importPicked} disabled={busy || !pick.size}>{busy ? "กำลังดึง…" : `ดึงที่เลือก ${pick.size} รายการ`}</Button></>}
    >
      {err && <p className="text-bad">{err}</p>}
      {!list && !err && <Spinner label="กำลังอ่าน HOSxP…" />}
      {list && !list.length && <Empty>ไม่มีนัดใน HOSxP</Empty>}
      {list?.map((a) => (
        <label key={a.oapp_id} className="flex cursor-pointer items-start gap-3 border-t border-line py-2 text-sm first:border-t-0">
          <input type="checkbox" className="mt-1 size-4" checked={pick.has(a.oapp_id)}
            onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(a.oapp_id); else n.delete(a.oapp_id); return n; })} />
          <span className="flex-1">
            <b>{th(a.date)}{a.time ? ` ${a.time.slice(0, 5)}` : ""}</b> · {a.cause || "-"}
            <span className="block text-muted">{[a.clinic, a.place, a.doctor].filter(Boolean).join(" · ")}{a.note ? ` · ${a.note}` : ""}</span>
          </span>
          <span className="flex flex-col items-end gap-1">
            {a.tbClinic && <Badge tone="contact">คลินิกผู้สัมผัส</Badge>}
            {a.came ? <Badge tone="ok">มาตามนัดแล้ว</Badge> : a.active ? <Badge>นัดไว้</Badge> : <Badge tone="muted">ยกเลิกใน HOSxP</Badge>}
            {a.imported && <Badge tone="muted">ดึงแล้ว (ดึงซ้ำ = อัปเดต)</Badge>}
          </span>
        </label>
      ))}
    </Modal>
  );
}
