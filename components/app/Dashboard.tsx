"use client";
// แดชบอร์ด (admin) — §6.1 การ์ด A/B ตามช่วงเวลา, §6.2 ไม่มีการ์ด "เส้นทางผู้สัมผัส"
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { INDICATORS } from "@/lib/indicators";
import { computeIndicators, countBy, FY_MONTH_LABELS, monthlyRegistrations, patientsInPeriod, type IndicatorResult } from "@/lib/tb/dashboard";
import { formatThaiDate } from "@/lib/tb/dates";
import { PERIOD_LABEL, type PeriodQuarter } from "@/lib/tb/targets";
import { isRR, th, useAppointments } from "./bits";
import { useApp } from "./store";

function GoalCard({ r }: { r: IndicatorResult }) {
  const def = INDICATORS.find((i) => i.id === r.id)!;
  const pct = def.unit === "percent";
  const target = r.progress.target;
  const color = r.pass === null ? "var(--muted)" : r.pass ? "var(--ok)" : "var(--bad)";
  // แถบ: ร้อยละ = ค่าจริง 0–100 + เส้นเป้าที่ค่าเป้า, จำนวนราย = A/B + เส้นเป้าที่ 100%
  const bar = pct ? Math.min(100, r.actual ?? 0) : r.progress.barPct;
  const line = pct ? (target ?? null) : target ? 100 : null;
  return (
    <div className="rounded-2xl border border-line border-l-[6px] bg-card p-4" style={{ borderLeftColor: color }}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{def.label}</div>
        {r.pass !== null && <span className="rounded-full px-2.5 py-0.5 text-xs text-white" style={{ background: color }}>{r.pass ? "ผ่านเป้า" : "ยังไม่ถึงเป้า"}</span>}
      </div>
      <div className="mt-1 text-3xl font-bold" style={{ color }}>
        {r.actual === null ? "–" : pct ? `${r.actual}%` : r.actual}
        <span className="ml-1 text-lg font-medium text-muted">/ {target === null ? "ยังไม่ตั้งเป้า" : pct ? `${target}%` : target}</span>
      </div>
      <div className="relative my-2 h-3 rounded-full bg-[#eef0ef]">
        <span className="block h-full rounded-full" style={{ width: `${bar}%`, background: color }} />
        {line !== null && <i className="absolute -top-1.5 h-6 w-[3px] rounded bg-foreground" style={{ left: `calc(${Math.min(line, 100)}% - 1px)` }} title={`เป้า ${target}`} />}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>
          {r.id === "case_finding" && target !== null && `ร้อยละ ${r.progress.pct}% ของเป้า`}
          {r.id === "coverage" && r.denominator && `ผู้ป่วยใหม่+กลับเป็นซ้ำ ${r.numerator} / เป้า ${r.denominator} ราย`}
          {r.id === "success_rate" && r.denominator ? `หาย+รักษาครบ ${r.numerator} / สรุปผลแล้ว ${r.denominator} ราย` : null}
          {r.id === "death_rate" && r.denominator ? `เสียชีวิต ${r.numerator} / สรุปผลแล้ว ${r.denominator} ราย` : null}
          {r.note && <span className="text-warn">{r.note}</span>}
        </span>
        {target !== null && <span>{def.lowerIsBetter ? "เป้า ≤" : "เป้า ≥"} {pct ? `${target}%` : `${target} ราย`}</span>}
      </div>
    </div>
  );
}

function Bars({ title, rows, total, color = "var(--brand-2)" }: { title: string; rows: [string, number][]; total: number; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Card>
      <div className="mb-2 font-semibold">{title}</div>
      {rows.length === 0 && <p className="text-sm text-muted">ไม่มีข้อมูล</p>}
      {rows.map(([label, n]) => (
        <div key={label} className="my-1.5 flex items-center gap-2 text-sm">
          <span className="w-28 flex-none truncate text-muted" title={label}>{label}</span>
          <span className="h-3.5 flex-1 overflow-hidden rounded-md bg-[#eef0ef]"><span className="block h-full" style={{ width: `${(n * 100) / max}%`, background: color }} /></span>
          <span className="w-16 flex-none text-right">{n}{total ? ` (${Math.round((n * 100) / total)}%)` : ""}</span>
        </div>
      ))}
    </Card>
  );
}

export function DashboardTab() {
  const { data, fy, open } = useApp();
  const appts = useAppointments();
  const [q, setQ] = useState<PeriodQuarter>(0);
  const [mode, setMode] = useState<"quarter" | "ytd">("quarter");
  const { range, results, inPeriod } = computeIndicators(data.patients, data.targets, fy, q, mode);
  const P = patientsInPeriod(data.patients, range);
  const monthly = monthlyRegistrations(data.patients, fy);
  const maxM = Math.max(1, ...monthly);
  const missed = appts.filter((a) => a.appt < data.today).length;
  const today = appts.filter((a) => a.appt === data.today).length;
  const onTx = P.filter((p) => !p.outcome || p.outcome === "กำลังรักษา").length;
  const ages = P.map((p) => Number(p.age)).filter((a) => a > 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-brand to-[#0f766e] p-4 text-white sm:p-5">
        <div>
          <div className="text-xl font-semibold">แดชบอร์ดวัณโรค · ปีงบประมาณ {fy}</div>
          <div className="text-sm opacity-85">{PERIOD_LABEL[q]}{q ? (mode === "ytd" ? " (สะสมตั้งแต่ต้นปีงบ)" : " (เฉพาะ 3 เดือน)") : ""} · {formatThaiDate(range.from)} – {formatThaiDate(range.to)}</div>
        </div>
        <div className="rounded-xl bg-white/15 px-4 py-2 text-center text-xs">ผู้ป่วยในช่วงนี้<b className="block text-2xl">{inPeriod}</b></div>
      </div>

      {(missed > 0 || today > 0) && (
        <button onClick={() => document.dispatchEvent(new CustomEvent("tb:tab", { detail: "appt" }))} className="mb-3 w-full rounded-xl border border-warn bg-warn-bg p-3 text-left">
          📅 นัดวันนี้ <b>{today}</b> ราย{missed > 0 && <> · <span className="text-bad">ขาดนัด <b>{missed}</b> ราย</span></>} <u>ดูรายการนัด</u>
        </button>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-brand">
          {([0, 1, 2, 3, 4] as PeriodQuarter[]).map((x) => (
            <button key={x} onClick={() => setQ(x)} className={`px-3 py-2 text-sm ${q === x ? "bg-brand text-white" : "bg-white text-brand"}`}>{PERIOD_LABEL[x]}</button>
          ))}
        </div>
        {q > 0 && (
          <div className="flex overflow-hidden rounded-xl border border-line">
            {(["quarter", "ytd"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-2 text-sm ${mode === m ? "bg-mint text-brand" : "bg-white text-muted"}`}>{m === "quarter" ? "เฉพาะไตรมาส" : "สะสม"}</button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => document.dispatchEvent(new CustomEvent("tb:tab", { detail: "settings" }))}>⚙ ตั้งเป้าหมาย</Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {INDICATORS.map((i) => <GoalCard key={i.id} r={results[i.id]} />)}
      </div>

      <h2 className="mb-2 text-lg font-semibold text-brand">ผู้ป่วยวัณโรค</h2>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ["ขึ้นทะเบียน", inPeriod, `${P.filter((p) => p.patient_type === "NEW").length} รายใหม่`],
          ["กำลังรักษา", onTx, ""],
          ["ดื้อ Rifampicin", P.filter(isRR).length, ""],
          ["อายุเฉลี่ย", ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : "–", "ปี"],
        ].map(([l, v, s]) => (
          <Card key={String(l)}><div className="text-sm text-muted">{l}</div><div className="text-2xl font-bold text-brand">{v}</div><div className="text-xs text-muted">{s || " "}</div></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Bars title="ผลการรักษา" rows={countBy(P, (p) => p.outcome || "กำลังรักษา")} total={P.length} />
        <Bars title="ประเภทการขึ้นทะเบียน" rows={countBy(P, (p) => p.patient_type)} total={P.length} color="var(--brand)" />
        <Bars title="ผู้ป่วยตามตำบล" rows={countBy(P, (p) => p.area).slice(0, 10)} total={P.length} color="var(--contact)" />
        <Card>
          <div className="mb-2 font-semibold">ขึ้นทะเบียนรายเดือน · ปีงบ {fy}</div>
          <div className="flex h-40 items-end gap-1">
            {monthly.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs">{n || ""}</span>
                <span className="w-full rounded-t-md bg-brand-2/80" style={{ height: `${(n * 100) / maxM}%`, minHeight: n ? 4 : 0 }} />
                <span className="text-[10px] text-muted">{FY_MONTH_LABELS[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted">
        นับผู้ป่วยเข้าช่วงตามวันเริ่มยา (ไม่มีใช้วันวินิจฉัย) · Success/Death Rate คิดจากผู้ป่วยในช่วงที่สรุปผลแล้ว · ข้อมูล ณ {th(data.today)}
        {" "}· <button className="underline" onClick={() => open({ type: "patientForm", patient: null })}>+ ลงทะเบียนผู้ป่วยใหม่</button>
      </p>
    </>
  );
}
