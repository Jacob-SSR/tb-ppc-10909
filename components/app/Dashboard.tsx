"use client";
// แดชบอร์ด (admin) — §6.1 การ์ด A/B ตามช่วงเวลา, §6.2 ไม่มีการ์ด "เส้นทางผู้สัมผัส"
// หน้าตาตามแดชบอร์ดระบบเดิม (Index.html): hero · การ์ดเป้า · เส้นทางผู้ป่วย 6 การ์ด · กราฟ 5 ตัว
import type { ChartConfiguration, ChartType } from "chart.js";
import { useState } from "react";
import { INDICATORS } from "@/lib/indicators";
import { computeIndicators, countBy, FY_MONTH_LABELS, monthlyRegistrations, patientsInPeriod, type IndicatorResult } from "@/lib/tb/dashboard";
import { formatThaiDate } from "@/lib/tb/dates";
import { findTarget, isNewOrRelapse, PERIOD_LABEL, type PeriodQuarter } from "@/lib/tb/targets";
import { isConcluded } from "@/lib/tb/tasks";
import { isRR, th, useAppointments } from "./bits";
import { ChartCanvas, COL, OUTCOME_COL, PALETTE } from "./Chart";
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

function Kpi({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: string }) {
  return (
    <div className="rounded-2xl border border-line border-t-4 bg-card px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,.03)]" style={{ borderTopColor: color }}>
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-[13px] text-muted">{label}</span>
        <span className="flex size-8 flex-none items-center justify-center rounded-[10px] text-[15px] font-bold text-white" style={{ background: color }}>{icon}</span>
      </div>
      <div className="mt-0.5 text-[28px] font-bold leading-tight">{value}</div>
      <div className="text-xs text-muted">{sub || "\u00a0"}</div>
    </div>
  );
}

function ChartBox<T extends ChartType>({ title, meta, wide, height, config }: { title: string; meta?: string; wide?: boolean; height?: number; config: ChartConfiguration<T> }) {
  return (
    <div className={`rounded-2xl border border-line bg-card px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,.03)] ${wide ? "min-[1050px]:col-span-2" : ""}`}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <b>{title}</b>
        {meta && <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] text-brand">{meta}</span>}
      </div>
      <ChartCanvas config={config} height={height} />
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a * 100) / b)}%` : "–");
const AGE_BINS = ["0–14", "15–29", "30–44", "45–59", "60–74", "75+"];
const AGE_COL = ["#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#115e59"];
const legendRight = { display: true, position: "right" as const, labels: { boxWidth: 12, padding: 10 } };
const countAxis = { beginAtZero: true, ticks: { precision: 0 } };

export function DashboardTab() {
  const { data, fy, open } = useApp();
  const appts = useAppointments();
  const [q, setQ] = useState<PeriodQuarter>(0);
  const [mode, setMode] = useState<"quarter" | "ytd">("quarter");
  const { range, results } = computeIndicators(data.patients, data.targets, fy, q, mode);
  const P = patientsInPeriod(data.patients, range);
  const ids = new Set(P.map((p) => p.id));
  const contactCount = data.contacts.filter((c) => c.patient_id && ids.has(c.patient_id)).length;
  const missed = appts.filter((a) => a.appt < data.today).length;
  const today = appts.filter((a) => a.appt === data.today).length;

  const final = P.filter((p) => isConcluded(p.outcome));
  const success = final.filter((p) => p.outcome === "หาย" || p.outcome === "รักษาครบ").length;
  const onTx = P.length - final.length;
  const died = P.filter((p) => p.outcome === "เสียชีวิต").length;
  const ltfu = P.filter((p) => p.outcome === "ขาดยา").length;
  const ages = P.map((p) => p.age).filter((a): a is number => a !== null && a !== undefined && !Number.isNaN(Number(a))).map(Number);
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : "–";
  const ageCnt = [0, 0, 0, 0, 0, 0];
  for (const a of ages) ageCnt[a < 15 ? 0 : a < 30 ? 1 : a < 45 ? 2 : a < 60 ? 3 : a < 75 ? 4 : 5]++;

  const outs = countBy(P, (p) => p.outcome || "กำลังรักษา");
  const types = countBy(P, (p) => p.patient_type);
  const typeN = (t: string) => types.find(([k]) => k === t)?.[1] ?? 0;
  const areas = countBy(P, (p) => p.area).slice(0, 10);

  // แนวโน้มทั้งปีงบเสมอ (ต.ค.–ก.ย.) + สะสมใหม่/กลับเป็นซ้ำ + เส้นเป้าสะสมถ้าตั้งเป้าทั้งปีแล้ว
  const monthly = monthlyRegistrations(data.patients, fy);
  const nrMonthly = monthlyRegistrations(data.patients.filter(isNewOrRelapse), fy);
  const cumul = nrMonthly.reduce<number[]>((acc, v, i) => [...acc, (acc[i - 1] ?? 0) + v], []);
  const yearTarget = findTarget(data.targets, fy, 0, "case_finding");

  return (
    <>
      <div className="mb-1.5 mt-1 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[linear-gradient(120deg,#1d4d40_0%,#0f766e_55%,#14b8a6_100%)] px-5 py-4 text-white shadow-[0_8px_24px_rgba(15,118,110,.18)]">
        <div>
          <div className="text-xl font-bold">แดชบอร์ดวัณโรค · ปีงบประมาณ {fy}</div>
          <div className="mt-0.5 text-[13px] opacity-85">
            โรงพยาบาลพลับพลาชัย และ รพ.สต. ในเครือข่าย · {PERIOD_LABEL[q]}{q ? (mode === "ytd" ? " (สะสม)" : " (เฉพาะ 3 เดือน)") : ""} {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => document.dispatchEvent(new CustomEvent("tb:tab", { detail: "settings" }))} className="rounded-lg border border-white/40 bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30">⚙ ตั้งเป้าหมาย</button>
          <div className="rounded-[14px] border border-white/30 bg-white/15 px-4 py-2 text-center text-xs leading-tight">
            <span>ผู้ป่วย</span><b className="block text-[26px]">{P.length}</b><span>ผู้สัมผัส {contactCount}</span>
          </div>
        </div>
      </div>

      {(missed > 0 || today > 0) && (
        <button onClick={() => document.dispatchEvent(new CustomEvent("tb:tab", { detail: "appt" }))} className="mt-1.5 w-full rounded-xl border border-[#f5c26b] bg-[#fff7e6] px-3.5 py-2.5 text-left">
          📅 นัดวันนี้ <b>{today}</b> ราย{missed > 0 && <> · <span className="text-bad">ขาดนัด <b>{missed}</b> ราย</span></>} <u>ดูรายการนัด</u>
        </button>
      )}

      <div className="my-3 flex flex-wrap items-center gap-2">
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
      </div>

      <div className="mb-1 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))]">
        {INDICATORS.map((i) => <GoalCard key={i.id} r={results[i.id]} />)}
      </div>

      <h2 className="mb-2.5 mt-5 text-[17px] font-semibold text-brand">เส้นทางผู้ป่วยวัณโรค</h2>
      <div className="mb-3.5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(175px,100%),1fr))]">
        <Kpi label="ผู้ป่วยขึ้นทะเบียน" value={P.length} sub={`${typeN("NEW")} รายใหม่ · ${typeN("Relapse")} กลับเป็นซ้ำ`} color={COL.teal} icon="👥" />
        <Kpi label="อัตราสำเร็จ" value={pct(success, final.length)} sub={`${success}/${final.length} รายที่สรุปผลแล้ว`} color={COL.green} icon="✓" />
        <Kpi label="กำลังรักษา" value={onTx} sub={`${pct(onTx, P.length)} ของทั้งหมด`} color={COL.orange} icon="⏱" />
        <Kpi label="เสียชีวิต" value={died} sub={pct(died, P.length)} color={COL.red} icon="✚" />
        <Kpi label="ขาดยา" value={ltfu} sub={pct(ltfu, P.length)} color={COL.purple} icon="⚠" />
        <Kpi label="ดื้อ Rifampicin" value={P.filter(isRR).length} sub={`อายุเฉลี่ย ${avgAge} ปี`} color={COL.pink} icon="⛨" />
      </div>

      <div className="mb-3.5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(330px,100%),1fr))]">
        <ChartBox title="ผลการรักษา" meta={`${outs.length} หมวด`} height={260} config={{
          type: "doughnut",
          data: { labels: outs.map(([k]) => k), datasets: [{ data: outs.map(([, n]) => n), backgroundColor: outs.map(([k], i) => OUTCOME_COL[k] ?? PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: "#fff" }] },
          options: { cutout: "62%", plugins: { legend: legendRight } },
        }} />
        <ChartBox title="ประเภทการขึ้นทะเบียน" meta={`${types.length} ประเภท`} height={260} config={{
          type: "bar",
          data: { labels: types.map(([k]) => k), datasets: [{ data: types.map(([, n]) => n), backgroundColor: types.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 8 }] },
          options: { scales: { y: countAxis, x: { grid: { display: false } } } },
        }} />
        <ChartBox title="ผู้ป่วยตามตำบล" meta={`${areas.length} พื้นที่`} height={260} config={{
          type: "bar",
          data: { labels: areas.map(([k]) => k), datasets: [{ data: areas.map(([, n]) => n), backgroundColor: COL.green, borderRadius: 6 }] },
          options: { indexAxis: "y", scales: { x: countAxis, y: { grid: { display: false } } } },
        }} />
        <ChartBox title="การกระจายของอายุ" meta={`${ages.length} รายที่มีอายุ`} config={{
          type: "bar",
          data: { labels: AGE_BINS, datasets: [{ data: ageCnt, backgroundColor: AGE_COL, borderRadius: 8 }] },
          options: { scales: { y: countAxis, x: { grid: { display: false } } } },
        }} />
        <ChartBox title="แนวโน้มการขึ้นทะเบียนรายเดือน" meta="ต.ค.–ก.ย." wide config={{
          type: "bar",
          data: {
            labels: FY_MONTH_LABELS,
            datasets: [
              { type: "bar", label: "ขึ้นทะเบียนรายเดือน", data: monthly, backgroundColor: "rgba(20,184,166,.75)", borderRadius: 6, yAxisID: "y" },
              { type: "line", label: "สะสม (ใหม่+กลับเป็นซ้ำ)", data: cumul, borderColor: COL.orange, backgroundColor: COL.orange, tension: 0.35, pointRadius: 3, yAxisID: "y1" },
              ...(yearTarget ? [{ type: "line" as const, label: "เป้าสะสม", data: FY_MONTH_LABELS.map((_, i) => Math.round((yearTarget * (i + 1) * 10) / 12) / 10), borderColor: COL.red, borderDash: [6, 5], pointRadius: 0, borderWidth: 2, yAxisID: "y1" }] : []),
            ],
          },
          options: {
            plugins: { legend: { display: true, position: "top", align: "end", labels: { boxWidth: 12 } } },
            scales: {
              y: { ...countAxis, title: { display: true, text: "ราย/เดือน" } },
              y1: { ...countAxis, position: "right", grid: { display: false }, title: { display: true, text: "สะสม" } },
              x: { grid: { display: false } },
            },
          },
        }} />
      </div>

      <p className="mt-3 text-xs text-muted">
        นับผู้ป่วยเข้าช่วงตามวันเริ่มยา (ไม่มีใช้วันวินิจฉัย) · อัตราสำเร็จ/เสียชีวิตคิดจากผู้ป่วยในช่วงที่สรุปผลแล้ว · แนวโน้มรายเดือนแสดงทั้งปีงบ · ข้อมูล ณ {th(data.today)}
        {" "}· <button className="underline" onClick={() => open({ type: "patientForm", patient: null })}>+ ลงทะเบียนผู้ป่วยใหม่</button>
      </p>
    </>
  );
}
