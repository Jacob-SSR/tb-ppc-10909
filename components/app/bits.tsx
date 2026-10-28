"use client";
// ชิ้นส่วนแสดงผลที่ใช้หลายหน้า
import { Badge, Card } from "@/components/ui";
import { pendingAppointments } from "@/lib/tb/appointments";
import { CONTACT_TYPE_LABEL, OUTCOME_ONGOING } from "@/lib/tb/constants";
import { emptyContactSummary, formatContactSummary, isTB } from "@/lib/tb/contacts";
import { diffDays, formatThaiDate } from "@/lib/tb/dates";
import { isConcluded, screened, type Task } from "@/lib/tb/tasks";
import { useMemo } from "react";
import { useApp } from "./store";
import type { Contact, Patient } from "./types";

export const th = (d: string | null | undefined) => formatThaiDate(d, "long");
export const thShort = (d: string | null | undefined) => formatThaiDate(d, "short");

const OUTCOME_TONE: Record<string, "ok" | "bad" | "brand" | "muted"> = {
  หาย: "ok", รักษาครบ: "ok", กำลังรักษา: "brand", เสียชีวิต: "bad", ล้มเหลว: "bad", ขาดยา: "bad", โอนออก: "muted", ประเมินไม่ได้: "muted",
};

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const o = outcome || OUTCOME_ONGOING;
  return <Badge tone={OUTCOME_TONE[o] ?? "muted"}>{o}</Badge>;
}

/** ที่อยู่ตามทะเบียนของผู้ป่วยเป็นข้อความเดียว: บ้านเลขที่/หมู่ ตำบล อ. จ. รหัสไปรษณีย์ */
export function patientAddress(p: { address?: string | null; area?: string | null; amphoe?: string | null; province?: string | null; postcode?: string | null }): string {
  const v = (x: string | null | undefined) => (x ?? "").trim();
  return [v(p.address), v(p.area), v(p.amphoe) && `อ.${v(p.amphoe)}`, v(p.province) && `จ.${v(p.province)}`, v(p.postcode)].filter(Boolean).join(" ");
}

export const isRR = (p: Pick<Patient, "rr">) => /RR|MDR|^ดื้อ/i.test(p.rr ?? "") && !/^ไม่/.test(p.rr ?? "");

/** เบอร์โทรกดโทรได้บนมือถือ (§6.5) */
export function Tel({ phone }: { phone: string | null | undefined }) {
  if (!phone) return null;
  const first = phone.split(/[,/ ]+/)[0].replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${first}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-brand-2 underline-offset-2 hover:underline">
      ☎ {phone}
    </a>
  );
}

/** นัดที่ยังค้าง (tb_appointments status = นัดไว้) — ไม่รวมผู้ป่วยที่สรุปผลแล้ว */
export function useAppointments() {
  const { data } = useApp();
  return useMemo(() => {
    const active = new Map(data.patients.map((p) => [p.id, !isConcluded(p.outcome)]));
    return pendingAppointments(data.appointments, (pid) => active.get(pid) ?? true);
  }, [data]);
}

export function ApptChip({ refId }: { refId: string }) {
  const { data } = useApp();
  const appts = useAppointments();
  const a = appts.find((x) => x.refId === refId);
  if (!a) return null;
  const late = a.appt < data.today;
  return <Badge tone={late ? "bad" : a.appt === data.today ? "warn" : "brand"}>📅 {late ? "ขาดนัด " : ""}{th(a.appt)}</Badge>;
}

export function TaskLine({ t, today }: { t: Task; today: string }) {
  const late = t.due && t.due < today;
  return (
    <span className={late ? "text-bad" : "text-muted"}>
      {t.step} {t.what}
      {t.due && ` · ${th(t.due)}`}
      {late && ` (เกิน ${diffDays(t.due!, today)} วัน)`}
    </span>
  );
}

/** §6.3: ผู้สัมผัส 5 · ร่วมบ้าน 3 (TB 1) · ใกล้ชิด 2 (TB 0) */
export function ContactSummaryLine({ patientId }: { patientId: string }) {
  const { data } = useApp();
  const s = data.contactSummary[patientId] ?? emptyContactSummary();
  return <Badge tone={s.total ? (s.tb ? "bad" : "contact") : "bad"}>{formatContactSummary(s)}</Badge>;
}

export function PatientCard({ p }: { p: Patient }) {
  const { open } = useApp();
  return (
    <Card onClick={() => open({ type: "patient", id: p.id })}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{p.name}</span>
        <OutcomeBadge outcome={p.outcome} />
      </div>
      <div className="mt-1 text-sm leading-relaxed text-muted">
        HN {p.hn || "-"}{p.patient_type ? ` · ${p.patient_type}` : ""} · เริ่มยา {th(p.start_date) || "-"}
        {p.area ? ` · ${p.area}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {isRR(p) && <Badge tone="bad">ดื้อ RIF</Badge>}
        <ContactSummaryLine patientId={p.id} />
        <ApptChip refId={p.id} />
      </div>
    </Card>
  );
}

export function contactStatus(c: Contact, tasks: Task[], today: string): { text: string; tone: "bad" | "ok" | "warn" | "brand" } {
  if (isTB(c)) return { text: "ป่วยเป็นวัณโรค", tone: "bad" };
  if (!tasks.length) return { text: "ครบ 2 ปี", tone: "ok" };
  const t = tasks[0];
  const late = !!t.due && t.due < today;
  return { text: `${t.step} ${t.what}${late ? " (เกินกำหนด)" : ""}`, tone: late ? "bad" : t.step === "D" ? "brand" : "warn" };
}

export function ContactCard({ c, showIndex = true }: { c: Contact; showIndex?: boolean }) {
  const { open, patientById, unitName, tasksOfContact, data } = useApp();
  const p = patientById(c.patient_id);
  const st = contactStatus(c, tasksOfContact(c), data.today);
  const fu = c.contact_type === "close" ? [12, 24] : [6, 12, 18, 24];
  const steps: [string, boolean][] = [
    ["A", !!c.invest_date],
    ["B", screened(c)],
    ["C", !!c.tpt_start || c.tpt_eligible === "ไม่ใช่" || c.tpt_eligible === "ปฏิเสธ"],
    ...fu.map((n) => [`${n}ด`, !!c[`fu${n}_date` as "fu6_date"]] as [string, boolean]),
  ];
  return (
    <Card onClick={() => open({ type: "contact", contact: c })}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{c.name}</span>
        <Badge tone={st.tone}>{st.text}</Badge>
      </div>
      <div className="mt-1 text-sm leading-relaxed text-muted">
        <Badge tone={c.contact_type === "close" ? "muted" : "contact"}>{CONTACT_TYPE_LABEL[c.contact_type]}</Badge>{" "}
        {c.relation ?? ""}{showIndex && p ? ` ของ ${p.name}` : ""} · {unitName(c.unit_id) || "ยังไม่ระบุหน่วย"}
      </div>
      {(c.phone || c.current_address || c.address) && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
          <Tel phone={c.phone} />
          {(c.current_address || c.address) && <span>📍 {c.current_address || c.address}</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {steps.map(([l, d]) => (
          <span key={l} className={`rounded-md px-1.5 py-0.5 text-[11px] ${d ? "bg-ok-bg text-ok" : "bg-[#eef0ef] text-muted"}`}>{l}</span>
        ))}
        <ApptChip refId={c.id} />
      </div>
    </Card>
  );
}

export function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-muted">{label}</div>
      <div>{children || "-"}</div>
    </div>
  );
}
