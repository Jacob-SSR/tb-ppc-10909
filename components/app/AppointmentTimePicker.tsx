"use client";
import { useState } from "react";
import { APPT_PERIODS, appointmentSlots, inAppointmentSlot, type ApptPeriod } from "@/lib/tb/appointmentSlots";
import { formatThaiDate } from "@/lib/tb/dates";
import { useApp } from "./store";

export function AppointmentTimePicker({ date, time, place, excludeId, disabled, onSelect }: {
  date: string; time: string; place: string; excludeId?: string; disabled: boolean;
  onSelect: (start: string, end: string) => void;
}) {
  const { data } = useApp();
  const [period, setPeriod] = useState<ApptPeriod>(time >= "16:00" ? "เย็น" : time >= "12:00" ? "บ่าย" : "เช้า");
  const appointments = data.appointments.filter((a) => a.id !== excludeId && a.appt_date === date && a.status === "scheduled" && (!place || a.place === place));
  return <section className="my-4 rounded-2xl border border-line bg-mint p-3 sm:p-4" aria-label="เลือกช่วงเวลานัด">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <b>{date ? `นัดวันที่ ${formatThaiDate(date)}` : "เลือกวันนัดเพื่อดูช่วงเวลา"}</b>
      <span className="text-xs text-muted">นัดในระบบ{place ? ` · ${place}` : ""} {appointments.length} ราย</span>
    </div>
    <div className="mb-3 flex gap-2" role="group" aria-label="ช่วงเวลา">
      {APPT_PERIODS.map((p) => <button type="button" key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} className={`flex-1 rounded-xl border px-3 py-2 ${period === p ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>{p}</button>)}
    </div>
    <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
      {appointmentSlots(period).map((slot) => {
        const n = appointments.filter((a) => inAppointmentSlot(a.appt_time, slot.start, slot.end)).length;
        const selected = inAppointmentSlot(time, slot.start, slot.end);
        return <button key={slot.start} type="button" disabled={disabled || !date} aria-pressed={selected}
          onClick={() => onSelect(slot.start, slot.end)} className={`flex items-center justify-between rounded-xl border p-3 text-left disabled:opacity-50 ${selected ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand"}`}>
          <span><b className="text-sm">{slot.label}</b><span className="block text-xs opacity-75">{n} นัดในช่วงนี้</span></span>
          <span aria-hidden="true" className="text-xl">{selected ? "✓" : "+"}</span>
        </button>;
      })}
    </div>
    <p className="mt-2 text-xs text-muted">เลือกช่วงละ 30 นาที หรือระบุเวลาเองด้านบน · จำนวนนี้เฉพาะนัดที่ท่านมีสิทธิ์ดูในระบบ TB</p>
  </section>;
}
