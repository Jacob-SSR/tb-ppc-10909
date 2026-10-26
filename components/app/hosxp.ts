"use client";
// ดึงข้อมูลจาก HOSxP ตาม HN / เลขบัตรประชาชน (ทีม รพ. เท่านั้น — API จำกัดสิทธิ์อยู่แล้ว)
//   auto   : กรอก HN แล้วออกจากช่อง หรือเลขบัตรครบ 13 หลัก → เติมเฉพาะช่องที่ยังว่าง
//   ปุ่ม   : ดึงใหม่และทับทุกช่องที่ HOSxP มีค่า
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui";
import { api, ApiError } from "./api";

export interface HosxpResult {
  hn: string;
  cid: string | null;
  name: string;
  sex: string | null;
  age: number | null;
  rights: string | null;
  address: string | null;
  area: string | null;
  amphoe: string | null;
  province: string | null;
  fullAddress: string | null;
  phone: string | null;
  deceased: boolean;
}

type Form = Record<string, string>;

/** map = ช่องในฟอร์ม → ค่าจาก HOSxP; overwrite=false เติมเฉพาะช่องว่าง — คืนจำนวนช่องที่เติม */
export function applyHosxp(form: Form, patch: Record<string, string | number | null | undefined>, overwrite: boolean): { form: Form; filled: number } {
  const next = { ...form };
  let filled = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || String(v).trim() === "") continue;
    if (!overwrite && String(next[k] ?? "").trim()) continue;
    if (next[k] !== String(v)) filled++;
    next[k] = String(v);
  }
  return { form: next, filled };
}

export function useHosxp<F extends Form>(
  enabled: boolean, form: F, setForm: (f: F) => void,
  toPatch: (r: HosxpResult) => Record<string, string | number | null | undefined>,
) {
  const [loading, setLoading] = useState(false);
  const tried = useRef(new Set<string>());
  const current = useRef(form);
  useEffect(() => { current.current = form; }, [form]); // ค่าล่าสุดตอนผลกลับมา (ผู้ใช้อาจพิมพ์ระหว่างรอ)

  async function lookup(by: { hn?: string; cid?: string }, overwrite: boolean) {
    if (!enabled) return;
    const hn = by.hn?.trim();
    const cid = by.cid?.replace(/\D/g, "");
    const key = hn ? `hn:${hn}` : cid && cid.length === 13 ? `cid:${cid}` : "";
    if (!key) return overwrite ? toast("กรอก HN หรือเลขบัตรประชาชน 13 หลักก่อน", "bad") : undefined;
    if (!overwrite && tried.current.has(key)) return; // auto ครั้งเดียวต่อค่า
    tried.current.add(key);
    setLoading(true);
    try {
      const r = await api<HosxpResult>("GET", `/api/hosxp?${hn ? `hn=${encodeURIComponent(hn)}` : `cid=${cid}`}`);
      const { form: next, filled } = applyHosxp(current.current, toPatch(r), overwrite);
      setForm(next as F);
      if (r.deceased) toast(`HOSxP ระบุว่า ${r.name} เสียชีวิตแล้ว — ตรวจสอบก่อนบันทึก`, "bad");
      else toast(filled ? `ดึงข้อมูลจาก HOSxP แล้ว ${filled} ช่อง — ตรวจสอบก่อนบันทึก` : "ข้อมูลตรงกับ HOSxP แล้ว");
    } catch (err) {
      // auto: ไม่พบ/ต่อไม่ได้ แจ้งแบบไม่รบกวน — ผู้ใช้กรอกเองต่อได้
      if (err instanceof ApiError && err.status === 404) toast(hn ? `ไม่พบ HN ${hn} ใน HOSxP` : "ไม่พบเลขบัตรนี้ใน HOSxP", overwrite ? "bad" : undefined);
      else toast((err as Error).message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return { loading, lookup };
}
