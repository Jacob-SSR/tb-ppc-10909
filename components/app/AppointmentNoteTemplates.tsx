"use client";
import { useState } from "react";
import { Button, ComboInput, toast } from "@/components/ui";

export function AppointmentNoteTemplates({ userId, note, disabled, onSelect }: {
  userId: number; note: string; disabled: boolean; onSelect: (note: string) => void;
}) {
  const key = `tb:appointment-note-templates:${userId}`;
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const read = () => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) || "{}");
      const valid = Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {}).filter(([k, v]) => k.length <= 80 && typeof v === "string" && v.length <= 2000));
      setTemplates(valid);
      return valid;
    } catch { toast("อ่านแม่แบบในเครื่องไม่ได้", "bad"); return {}; }
  };
  const write = (remove = false) => {
    const n = name.trim();
    if (!n || n.length > 80 || (!remove && !note.trim())) return toast("ระบุชื่อแม่แบบ (ไม่เกิน 80 ตัวอักษร) และข้อความหมายเหตุ", "bad");
    const next = { ...read() };
    if (remove) delete next[n]; else next[n] = note;
    try { localStorage.setItem(key, JSON.stringify(next)); setTemplates(next); toast(remove ? "ลบแม่แบบแล้ว" : "เก็บแม่แบบในเครื่องแล้ว"); }
    catch { toast("บันทึกแม่แบบในเครื่องไม่ได้", "bad"); }
  };
  return <div className="mb-2">
    <div className="flex flex-wrap gap-2">
      <ComboInput className="min-w-40 flex-1" listId="appt-note-templates" placeholder="ค้นหา / ตั้งชื่อแม่แบบหมายเหตุ" maxLength={80} value={name} disabled={disabled}
        options={Object.keys(templates)} onFocus={read} onChange={(e) => { setName(e.target.value); if (Object.hasOwn(templates, e.target.value)) onSelect(templates[e.target.value]); }} />
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => write()}>เก็บแม่แบบ</Button>
      <Button variant="ghost" size="sm" disabled={disabled || !Object.hasOwn(templates, name.trim())} onClick={() => write(true)}>ลบแม่แบบ</Button>
    </div>
    <p className="mt-1 text-xs text-muted">แม่แบบเก็บในเบราว์เซอร์ของผู้ใช้รายนี้ · ใช้ข้อความทั่วไปที่ไม่มีข้อมูลผู้ป่วย</p>
  </div>;
}
