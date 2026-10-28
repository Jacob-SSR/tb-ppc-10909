"use client";
// แท็บ นัดหมาย (รายการ/ปฏิทิน) และ ต้องติดตาม
import { useState } from "react";
import { Badge, Button, Empty, Select } from "@/components/ui";
import { apptSummary, groupAppointments, type Appointment } from "@/lib/tb/appointments";
import { addDays, diffDays, formatThaiDate } from "@/lib/tb/dates";
import { Tel, th, useAppointments } from "./bits";
import { useApp, type DueItem } from "./store";
import { useApptStatus } from "./Appointments";
import type { Appt, Contact, Patient } from "./types";
import { exportApptWord, exportDueWord } from "./wordExports";

function Row({ date, late, tone, title, kind, sub, onClick, action }: {
  date: string; late?: number; tone: "late" | "soon" | "later"; title: React.ReactNode; kind: "P" | "C"; sub: React.ReactNode; onClick: () => void;
  action?: React.ReactNode;
}) {
  const border = tone === "late" ? "border-l-bad" : tone === "soon" ? "border-l-warn" : "border-l-brand-2";
  return (
    <div onClick={onClick} className={`mb-2 flex cursor-pointer gap-3 rounded-xl border border-line border-l-4 ${border} bg-white p-3 hover:border-brand-2`}>
      <div className="w-24 flex-none text-sm font-semibold">
        {th(date)}
        {late ? <div className="text-xs font-normal text-bad">เกิน {late} วัน</div> : null}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div>{title} <Badge tone={kind === "C" ? "contact" : "brand"}>{kind === "C" ? "ผู้สัมผัส" : "ผู้ป่วย"}</Badge></div>
        <div className="mt-0.5 text-muted">{sub}</div>
      </div>
      {action && <div className="flex-none self-center" onClick={(e) => e.stopPropagation()}>{action}</div>}
    </div>
  );
}

function useRefLookup() {
  const { patientById, contactById, unitName, open } = useApp();
  return (kind: "P" | "C", id: string) => {
    const rec = kind === "P" ? patientById(id) : contactById(id);
    if (!rec) return null;
    const c = kind === "C" ? (rec as Contact) : null;
    const idx = c ? patientById(c.patient_id) : null;
    const unit = unitName(rec.unit_id);
    return {
      rec,
      unit,
      sub: (
        <span className="flex flex-wrap gap-x-2">
          <span>{c ? `${c.relation ?? "ผู้สัมผัส"} ของ ${idx?.name ?? "?"}` : `HN ${(rec as Patient).hn || "-"}`}</span>
          {unit && <span>· {unit}</span>}
          <Tel phone={rec.phone} />
        </span>
      ),
      onClick: () => open(c ? { type: "contact", contact: c } : { type: "patient", id }),
    };
  };
}

export function AppointmentsTab() {
  const store = useApp();
  const { data, isAdmin, unitName } = store;
  const all = useAppointments();
  const lookup = useRefLookup();
  const [unit, setUnit] = useState("");
  const [view, setView] = useState<"list" | "cal">("list");
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [day, setDay] = useState("");

  const setStatus = useApptStatus();
  const items = all
    .map((a) => ({ a, r: lookup(a.kind, a.refId) }))
    .filter((x): x is { a: Appointment<Appt>; r: NonNullable<ReturnType<typeof lookup>> } => !!x.r)
    .filter((x) => !unit || String(x.r.rec.unit_id) === unit);
  const g = groupAppointments(items.map((x) => ({ ...x, appt: x.a.appt })), data.today);
  const row = (x: (typeof items)[number]) => (
    <Row key={x.a.row.id} date={x.a.appt} late={x.a.appt < data.today ? diffDays(x.a.appt, data.today) : 0}
      tone={x.a.appt < data.today ? "late" : x.a.appt <= addDays(data.today, 1) ? "soon" : "later"}
      title={<b>{x.r.rec.name}</b>} kind={x.a.kind}
      sub={<>{x.r.sub}<div className="text-foreground">{apptSummary(x.a.row)}{x.a.row.source === "hosxp" ? " · HOSxP" : ""}</div></>}
      onClick={() => store.open({ type: "appointment", appt: x.a.row })}
      action={(isAdmin || x.a.kind === "C") && <Button size="sm" variant="ghost" onClick={() => setStatus(x.a.row, "done")}>✓ มาแล้ว</Button>} />
  );
  const groups: [string, typeof items, string][] = [
    ["ขาดนัด (เลยวันนัดแล้วยังไม่มีบันทึกการมา)", g.missed, "text-bad"], ["นัดวันนี้", g.today, "text-warn"], ["นัดพรุ่งนี้", g.tomorrow, "text-warn"],
    ["ภายใน 7 วัน", g.week, "text-brand"], ["หลังจากนั้น", g.later, "text-brand"],
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted">นัดที่ยังค้าง · กดที่รายการเพื่อแก้/เลื่อน/ยกเลิก · บันทึกการรักษาใหม่ = มาตามนัดให้อัตโนมัติ · ใส่ &quot;วันนัดครั้งถัดไป&quot; ในบันทึก = สร้างนัดให้</p>
        <Button size="sm" onClick={() => store.open({ type: "pickAppt" })}>+ เพิ่มนัด</Button>
        {isAdmin && <Select className="w-auto" options={data.units.map((u) => ({ value: u.id, label: u.name }))} placeholder="ทุกหน่วย" value={unit} onChange={(e) => setUnit(e.target.value)} />}
        <div className="flex overflow-hidden rounded-xl border border-brand">
          {(["list", "cal"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-2 text-sm ${view === v ? "bg-brand text-white" : "bg-white text-brand"}`}>{v === "list" ? "☰ รายการ" : "📅 ปฏิทิน"}</button>
          ))}
        </div>
        <Button variant="ghost" size="sm" disabled={!items.length} onClick={() => exportApptWord(
          store,
          groups.map(([title, list]) => [title, list.map((x) => ({ appt: x.a.appt, kind: x.a.kind, rec: x.r.rec, summary: apptSummary(x.a.row) }))]),
          unit ? unitName(Number(unit)) : isAdmin ? "" : data.user.unitName,
        )}>📄 ส่งออก Word</Button>
      </div>
      {!items.length && <Empty>ยังไม่มีนัดค้าง · กด &quot;+ เพิ่มนัด&quot; หรือใส่ &quot;วันนัดครั้งถัดไป&quot; ตอนบันทึกการรักษา</Empty>}
      {view === "list"
        ? groups.map(([title, list, cls]) => list.length > 0 && (
            <div key={title} className="mb-4"><h3 className={`mb-2 text-base font-semibold ${cls}`}>{title} ({list.length})</h3>{list.map(row)}</div>
          ))
        : <Calendar month={month} setMonth={(m) => { setMonth(m); setDay(""); }} day={day} setDay={setDay} items={items} today={data.today} row={row} />}
    </>
  );
}

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function Calendar<T extends { a: Appointment; r: { rec: { name: string } } }>({ month, setMonth, day, setDay, items, today, row }: {
  month: string; setMonth: (m: string) => void; day: string; setDay: (d: string) => void; items: T[]; today: string; row: (x: T) => React.ReactNode;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map<string, T[]>();
  for (const x of items) byDay.set(x.a.appt, [...(byDay.get(x.a.appt) ?? []), x]);
  const move = (k: number) => {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => move(-1)}>‹</Button>
        <b className="min-w-36 text-center">{MONTHS[m - 1]} {y + 543}</b>
        <Button variant="ghost" size="sm" onClick={() => move(1)}>›</Button>
        <Button variant="ghost" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>เดือนนี้</Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => <div key={d} className="py-1 text-center text-xs text-muted">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`x${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          const list = byDay.get(key) ?? [];
          return (
            <button key={key} onClick={() => setDay(key)}
              className={`min-h-14 overflow-hidden rounded-lg border bg-white p-1 text-left sm:min-h-24 ${key === today ? "border-2 border-brand-2" : "border-line"} ${key === day ? "bg-mint" : ""}`}>
              <div className="flex justify-between text-xs font-semibold">
                {i + 1}
                {list.length > 0 && <span className={`rounded-full px-1.5 text-[10px] text-white ${key < today ? "bg-bad" : "bg-brand-2"}`}>{list.length}</span>}
              </div>
              <div className="hidden sm:block">
                {list.slice(0, 3).map((x) => <div key={x.a.row.id} className={`mt-0.5 truncate rounded px-1 text-[11px] ${key < today ? "bg-bad-bg text-bad" : x.a.kind === "C" ? "bg-contact-bg text-contact" : "bg-mint text-brand"}`}>{x.r.rec.name}</div>)}
                {list.length > 3 && <div className="text-[11px] text-muted">+{list.length - 3} ราย</div>}
              </div>
            </button>
          );
        })}
      </div>
      {day && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold">นัดวันที่ {formatThaiDate(day)} ({(byDay.get(day) ?? []).length})</h3>
          {(byDay.get(day) ?? []).map(row)}
          {!(byDay.get(day) ?? []).length && <Empty>ไม่มีนัด</Empty>}
        </div>
      )}
    </>
  );
}

export function DueTab() {
  const store = useApp();
  const { data, isAdmin, allDue, unitName } = store;
  const lookup = useRefLookup();
  const [unit, setUnit] = useState("");
  const horizon = addDays(data.today, 30);
  const soon = addDays(data.today, 7);
  const items = allDue().filter((x) => x.due! <= horizon && (!unit || String(x.rec.unit_id) === unit));
  const groups: [string, DueItem[], "late" | "soon" | "later", string][] = [
    ["เกินกำหนด", items.filter((x) => x.due! < data.today), "late", "text-bad"],
    ["ภายใน 7 วัน", items.filter((x) => x.due! >= data.today && x.due! <= soon), "soon", "text-warn"],
    ["8–30 วัน", items.filter((x) => x.due! > soon), "later", "text-brand"],
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted">งานที่ถึงกำหนดภายใน 30 วัน และงานที่เกินกำหนด (ทุกปีงบ){!isAdmin ? ` · ${data.user.unitName}` : ""}</p>
        <Button variant="ghost" size="sm" disabled={!items.length}
          onClick={() => exportDueWord(store, items, unit ? unitName(Number(unit)) : isAdmin ? "" : data.user.unitName)}>📄 ส่งออก Word (ใช้ลงพื้นที่)</Button>
        {isAdmin && <Select className="w-auto" options={data.units.map((u) => ({ value: u.id, label: u.name }))} placeholder="ทุกหน่วย" value={unit} onChange={(e) => setUnit(e.target.value)} />}
      </div>
      {!items.length && <Empty>ไม่มีงานค้าง 🎉</Empty>}
      {groups.map(([title, list, tone, cls]) => list.length > 0 && (
        <div key={title} className="mb-4">
          <h3 className={`mb-2 text-base font-semibold ${cls}`}>{title} ({list.length})</h3>
          {list.map((x) => {
            const r = lookup(x.kind, x.rec.id);
            if (!r) return null;
            return (
              <Row key={`${x.rec.id}-${x.step}-${x.what}`} date={x.due!} tone={tone}
                late={tone === "late" ? diffDays(x.due!, data.today) : 0}
                title={<><b>{x.step}</b> {x.what} · <b>{x.rec.name}</b></>} kind={x.kind}
                sub={<>{r.sub}{x.kind === "C" && !r.unit && unitName(x.rec.unit_id)}</>}
                onClick={r.onClick} />
            );
          })}
        </div>
      ))}
    </>
  );
}
