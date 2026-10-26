"use client";
// แท็บผู้ป่วย / ผู้สัมผัส + เลือกผู้ป่วย index ก่อนเพิ่มผู้สัมผัส
import { useEffect, useState } from "react";
import { Button, Card, Empty, Input, Modal, Select } from "@/components/ui";
import { isTB } from "@/lib/tb/contacts";
import { OPTIONS } from "@/lib/tb/options";
import { api } from "./api";
import { ContactCard, PatientCard, patientAddress, th } from "./bits";
import { useApp } from "./store";
import type { Patient } from "./types";

const norm = (s: unknown) => String(s ?? "").toLowerCase();

export function PatientsTab() {
  const { data, fy, isAdmin, open } = useApp();
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const list = data.patients
    .filter((p) => Number(p.fy) === fy)
    .filter((p) => !q || norm(`${p.name} ${p.hn} ${p.tb_no ?? ""} ${p.area ?? ""}`).includes(norm(q)))
    .filter((p) => !outcome || (p.outcome || "กำลังรักษา") === outcome)
    .sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || String(a.start_date).localeCompare(String(b.start_date)));
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="search" placeholder="ค้นหา ชื่อ / HN / TB number / ตำบล" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-48 flex-1" />
        <Select className="w-auto" options={OPTIONS.outcome} placeholder="ผลการรักษา: ทั้งหมด" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        {isAdmin && <Button onClick={() => open({ type: "patientForm", patient: null })}>+ ผู้ป่วยใหม่</Button>}
      </div>
      <p className="mb-2 text-sm text-muted">ปีงบ {fy}: {list.length} ราย</p>
      {list.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{list.map((p) => <PatientCard key={p.id} p={p} />)}</div> : <Empty>ยังไม่มีผู้ป่วยในปีงบนี้</Empty>}
    </>
  );
}

const STEPS = [["", "ทุกขั้นตอน"], ["A", "A รอสอบสวน"], ["B", "B รอคัดกรอง"], ["C", "C TPT"], ["D", "D ติดตาม"], ["late", "เกินกำหนด"], ["TB", "ป่วยเป็นวัณโรค"], ["done", "ครบ 2 ปี"]] as const;

export function ContactsTab() {
  const { data, fy, isAdmin, open, patientById, tasksOfContact } = useApp();
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("");
  const [step, setStep] = useState("");
  const allFy = !isAdmin; // รพ.สต. เห็นผู้สัมผัสในเขตทุกปีงบ (รายชื่อไม่เยอะ ลงพื้นที่ต้องเห็นครบ)
  const list = data.contacts.filter((c) => {
    const p = patientById(c.patient_id);
    if (!allFy && Number(p?.fy) !== fy) return false;
    if (q && !norm(`${c.name} ${c.hn ?? ""} ${c.cid ?? ""} ${c.phone ?? ""} ${p?.name ?? ""}`).includes(norm(q))) return false;
    if (unit && String(c.unit_id) !== unit) return false;
    if (step) {
      const t = tasksOfContact(c);
      if (step === "TB") return isTB(c);
      if (step === "done") return !isTB(c) && !t.length;
      if (step === "late") return !!t[0]?.due && t[0].due < data.today;
      return t[0]?.step === step;
    }
    return true;
  });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="search" placeholder="ค้นหา ชื่อ / เบอร์โทร / ผู้ป่วย index" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-48 flex-1" />
        {isAdmin && <Select className="w-auto" options={data.units.map((u) => ({ value: u.id, label: u.name }))} placeholder="ทุกหน่วย" value={unit} onChange={(e) => setUnit(e.target.value)} />}
        <Select className="w-auto" placeholder={false} options={STEPS.map(([v, l]) => ({ value: v, label: l }))} value={step} onChange={(e) => setStep(e.target.value)} />
        <Button variant="contact" onClick={() => open({ type: "pickIndex" })}>+ ผู้สัมผัส</Button>
      </div>
      <p className="mb-2 text-sm text-muted">{allFy ? `ผู้สัมผัสในเขต ${data.user.unitName}` : `ปีงบ ${fy}`}: {list.length} คน</p>
      {list.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{list.map((c) => <ContactCard key={c.id} c={c} />)}</div> : <Empty>ยังไม่มีผู้สัมผัส</Empty>}
    </>
  );
}

/** เลือกผู้ป่วย index — admin เลือกจากทะเบียน, รพ.สต. ค้นจาก server (ได้เฉพาะช่องที่จำเป็น) */
export function PickIndex() {
  const { data, fy, isAdmin, open, contactsOf } = useApp();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Patient[]>([]);
  useEffect(() => {
    if (isAdmin || q.trim().length < 2) return;
    const t = setTimeout(() => {
      api<{ patients: Patient[] }>("GET", `/api/patients/search?q=${encodeURIComponent(q.trim())}`).then((r) => setRemote(r.patients)).catch(() => setRemote([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, isAdmin]);
  const shown = isAdmin
    ? data.patients.filter((p) => Number(p.fy) === fy && (!q || norm(`${p.name} ${p.hn}`).includes(norm(q))))
    : q.trim().length < 2 ? [] : remote;
  const pick = (p: Patient) =>
    open({ type: "contact", contact: { patient_id: p.id, contact_type: "household", ring: 1, unit_id: isAdmin ? (p.unit_id ?? undefined) : data.user.unitId, address: patientAddress(p) || null, current_address: p.current_address ?? null } });
  return (
    <Modal open onClose={() => open(null)} title="เพิ่มผู้สัมผัส – เลือกผู้ป่วย index" subtitle={isAdmin ? `ปีงบ ${fy}` : "พิมพ์ HN หรือชื่อผู้ป่วยอย่างน้อย 2 ตัวอักษร"}>
      <Input type="search" autoFocus placeholder="ค้นหาชื่อ / HN" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="grid grid-cols-1 gap-2">
        {shown.map((p) => (
          <Card key={p.id} onClick={() => pick(p)}>
            <div className="font-semibold">{p.name}</div>
            <div className="text-sm text-muted">HN {p.hn || "-"} · เริ่มยา {th(p.start_date) || "-"}{isAdmin ? ` · ผู้สัมผัส ${contactsOf(p.id).length}` : ""}</div>
          </Card>
        ))}
        {!shown.length && <Empty>{q.trim().length < 2 && !isAdmin ? "พิมพ์เพื่อค้นหา" : "ไม่พบผู้ป่วย"}</Empty>}
      </div>
    </Modal>
  );
}
