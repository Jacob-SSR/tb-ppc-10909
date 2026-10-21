"use client";
// บันทึกการรักษา/ติดตามรายครั้ง + นัดครั้งถัดไป
// มือถือนอกพื้นที่ (§6.6): แนบพิกัด GPS ได้ (ขออนุญาตก่อน ไม่บังคับ), เน็ตหลุด → เก็บร่างในเครื่องแล้วส่งเองทีหลัง
import { useState } from "react";
import { Badge, Button, Field, Input, Section, Select, Textarea, toast } from "@/components/ui";
import { addDays } from "@/lib/tb/dates";
import { OPTIONS } from "@/lib/tb/options";
import { api, NetworkError } from "./api";
import { th } from "./bits";
import { useApp } from "./store";
import type { Visit } from "./types";

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function Timeline({ refId, label, canAdd }: { refId: string; label: string; canAdd: boolean }) {
  const { data, visitsOf, isAdmin, reload, queueDraft, drafts } = useApp();
  const visits = [...visitsOf(refId)].sort((a, b) => (a.visit_date < b.visit_date ? 1 : a.visit_date > b.visit_date ? -1 : a.updated_at < b.updated_at ? 1 : -1));
  const pending = drafts.filter((d) => d.payload.patient_id === refId || d.payload.contact_id === refId);
  const empty = { visit_date: data.today, visit_type: OPTIONS.visitType[0] as string, next_appt: "", detail: "" };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [gps, setGps] = useState(!isAdmin); // ทีม รพ.สต. ลงพื้นที่ → ค่าเริ่มต้นแนบพิกัด
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    if (!f.visit_date) return toast("กรุณาระบุวันที่", "bad");
    if (!f.detail.trim()) return toast("กรุณากรอกรายละเอียด", "bad");
    if (f.next_appt && f.next_appt <= f.visit_date) return toast("วันนัดต้องอยู่หลังวันที่บันทึก", "bad");
    setBusy(true);
    const pos = gps && !editing ? await getPosition() : null;
    const payload: Record<string, unknown> = {
      [refId.startsWith("P") ? "patient_id" : "contact_id"]: refId,
      visit_date: f.visit_date, visit_type: f.visit_type, detail: f.detail.trim(), next_appt: f.next_appt || null,
      ...(pos ?? {}),
    };
    try {
      if (editing) {
        await api("PUT", `/api/visits/${editing.id}`, payload);
      } else {
        payload.client_uuid = crypto.randomUUID();
        try {
          await api("POST", "/api/visits", payload);
        } catch (err) {
          if (!(err instanceof NetworkError)) throw err;
          await queueDraft({ client_uuid: payload.client_uuid as string, payload, label, savedAt: new Date().toISOString() });
          toast("ไม่มีสัญญาณ — เก็บบันทึกไว้ในเครื่องแล้ว จะส่งให้อัตโนมัติเมื่อมีเน็ต");
          setF(empty);
          return;
        }
      }
      toast(editing ? "แก้ไขแล้ว" : pos ? "บันทึกแล้ว (แนบพิกัด)" : "บันทึกแล้ว");
      setF(empty);
      setEditing(null);
      await reload();
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: Visit) {
    if (!confirm(`ลบบันทึกวันที่ ${th(v.visit_date)}?`)) return;
    try {
      await api("DELETE", `/api/visits/${v.id}`);
      toast("ลบแล้ว");
      await reload();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  return (
    <Section title={`บันทึกการรักษา / ติดตาม (${visits.length})`}>
      {canAdd && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="วันที่"><Input type="date" value={f.visit_date} onChange={set("visit_date")} /></Field>
          <Field label="ประเภท"><Select options={OPTIONS.visitType} placeholder={false} value={f.visit_type} onChange={set("visit_type")} /></Field>
          <Field label="วันนัดครั้งถัดไป"><Input type="date" value={f.next_appt} onChange={set("next_appt")} /></Field>
          <div className="flex flex-wrap gap-1.5 sm:col-span-3">
            <span className="self-center text-xs text-muted">นัดด่วน:</span>
            {[[7, "1 สัปดาห์"], [14, "2 สัปดาห์"], [28, "4 สัปดาห์"], [56, "8 สัปดาห์"]].map(([d, l]) => (
              <Button key={d} size="sm" variant="ghost" onClick={() => setF({ ...f, next_appt: addDays(f.visit_date || data.today, d as number) })}>{l}</Button>
            ))}
          </div>
          <Field label="รายละเอียด" wide>
            <Textarea value={f.detail} onChange={set("detail")} placeholder="เช่น ซักอาการ ไม่ไอ ไม่มีไข้ · กินยาครบ · F/U LFT 1 wk" />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            {!editing && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="size-5 accent-brand" checked={gps} onChange={(e) => setGps(e.target.checked)} />
                แนบพิกัด GPS
              </label>
            )}
            <span className="flex-1" />
            {editing && <Button variant="ghost" onClick={() => { setEditing(null); setF(empty); }}>ยกเลิกแก้ไข</Button>}
            <Button onClick={submit} disabled={busy}>{busy ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "+ บันทึก"}</Button>
          </div>
        </div>
      )}
      {pending.map((d) => (
        <div key={d.client_uuid} className="mb-2 rounded-xl border border-dashed border-warn bg-warn-bg p-3 text-sm">
          <Badge tone="warn">รอส่ง (เก็บในเครื่อง)</Badge> {th(String(d.payload.visit_date))} · {String(d.payload.detail).slice(0, 80)}
          {d.lastError && <div className="mt-1 text-bad">ส่งไม่ผ่าน: {d.lastError}</div>}
        </div>
      ))}
      {visits.length === 0 && !pending.length && <p className="text-sm text-muted">ยังไม่มีบันทึก</p>}
      <div className="space-y-2">
        {visits.map((v) => {
          const mine = isAdmin || v.by_unit_id === data.user.unitId;
          return (
            <div key={v.id} className="flex gap-3 rounded-xl border border-line border-l-4 border-l-brand-2 bg-white p-3">
              <div className="w-24 flex-none text-sm font-semibold">{th(v.visit_date)}</div>
              <div className="min-w-0 flex-1 text-sm">
                <Badge>{v.visit_type}</Badge>
                <div className="mt-1 whitespace-pre-wrap">{v.detail}</div>
                {v.next_appt && <div className="mt-1"><Badge tone="warn">📅 นัดครั้งถัดไป {th(v.next_appt)}</Badge></div>}
                <div className="mt-1 text-xs text-muted">
                  โดย {v.by_name} ({v.by_unit_name}) · {v.updated_at?.slice(0, 16)}
                  {v.lat && v.lng && (
                    <> · <a className="text-brand-2 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}>พิกัด</a></>
                  )}
                  {canAdd && mine && <> · <button className="text-brand-2 underline" onClick={() => { setEditing(v); setF({ visit_date: v.visit_date, visit_type: v.visit_type, next_appt: v.next_appt ?? "", detail: v.detail ?? "" }); }}>แก้ไข</button></>}
                  {isAdmin && <> · <button className="text-bad underline" onClick={() => remove(v)}>ลบ</button></>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
