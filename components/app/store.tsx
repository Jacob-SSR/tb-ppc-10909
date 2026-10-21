"use client";
// store กลางของแอป: ข้อมูลจาก /api/data + ตัวช่วยค้นหา + เปิด modal + ส่งร่างออฟไลน์
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/ui";
import { fyOf } from "@/lib/tb/dates";
import { contactTasks, patientStart, patientTasks, type Task } from "@/lib/tb/tasks";
import { api, ApiError, NetworkError } from "./api";
import { deleteDraft, listDrafts, saveDraft, type VisitDraft } from "./drafts";
import type { AppData, Contact, Followup, Patient, Visit } from "./types";

export type ModalState =
  | { type: "patient"; id: string }
  | { type: "patientForm"; patient: Partial<Patient> | null }
  | { type: "contact"; contact: Partial<Contact> }
  | { type: "pickIndex" }
  | { type: "history"; id: string; title: string; back?: ModalState };

export interface DueItem extends Task {
  kind: "P" | "C";
  rec: Patient | Contact;
}

interface Store {
  data: AppData;
  isAdmin: boolean;
  fy: number;
  setFy: (fy: number) => void;
  fys: number[];
  reload: () => Promise<void>;
  modal: ModalState | null;
  open: (m: ModalState | null) => void;
  patientById: (id: string | null | undefined) => Patient | undefined;
  contactById: (id: string) => Contact | undefined;
  contactsOf: (patientId: string) => Contact[];
  followupsOf: (patientId: string) => Followup[];
  visitsOf: (refId: string) => Visit[];
  unitName: (id: number | null | undefined) => string;
  tasksOfContact: (c: Contact) => Task[];
  tasksOfPatient: (p: Patient) => Task[];
  allDue: () => DueItem[];
  drafts: VisitDraft[];
  queueDraft: (d: VisitDraft) => Promise<void>;
  syncDrafts: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useApp(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useApp ต้องอยู่ใน <AppProvider>");
  return s;
}

export function AppProvider({ initial, children }: { initial: AppData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [fy, setFy] = useState(() => fyOf(initial.today));
  const [modal, setModal] = useState<ModalState | null>(null);
  const [drafts, setDrafts] = useState<VisitDraft[]>([]);
  const syncing = useRef(false);

  const reload = useCallback(async () => {
    setData(await api<AppData>("GET", "/api/data"));
  }, []);

  const idx = useMemo(() => {
    const patients = new Map(data.patients.map((p) => [p.id, p]));
    const contacts = new Map(data.contacts.map((c) => [c.id, c]));
    const byPatient = new Map<string, Contact[]>();
    for (const c of data.contacts) byPatient.set(c.patient_id, [...(byPatient.get(c.patient_id) ?? []), c]);
    const fu = new Map<string, Followup[]>();
    for (const f of data.followups) fu.set(f.patient_id, [...(fu.get(f.patient_id) ?? []), f]);
    const visits = new Map<string, Visit[]>();
    for (const v of data.visits) {
      const ref = (v.patient_id ?? v.contact_id)!;
      visits.set(ref, [...(visits.get(ref) ?? []), v]);
    }
    const units = new Map(data.units.map((u) => [u.id, u.name]));
    return { patients, contacts, byPatient, fu, visits, units };
  }, [data]);

  const tasksOfContact = useCallback(
    (c: Contact) => contactTasks(c, { indexStart: patientStart(idx.patients.get(c.patient_id)), today: data.today }),
    [idx, data.today],
  );
  const tasksOfPatient = useCallback(
    (p: Patient) => patientTasks(p, { contactCount: idx.byPatient.get(p.id)?.length ?? 0, followups: idx.fu.get(p.id) ?? [], today: data.today }),
    [idx, data.today],
  );

  const fys = useMemo(() => {
    const s = new Set<number>(data.patients.map((p) => Number(p.fy)).filter(Boolean));
    s.add(fyOf(data.today));
    return [...s].sort((a, b) => b - a);
  }, [data]);

  const refreshDrafts = useCallback(async () => setDrafts(await listDrafts()), []);

  const syncDrafts = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const list = await listDrafts();
      let sent = 0;
      for (const d of list) {
        try {
          await api("POST", "/api/visits", d.payload);
          await deleteDraft(d.client_uuid);
          sent++;
        } catch (err) {
          if (err instanceof NetworkError) break; // ยังไม่มีเน็ต ไว้รอบหน้า
          // server ปฏิเสธ (ข้อมูลไม่ถูกต้อง/ไม่มีสิทธิ์) — ส่งซ้ำก็ไม่ผ่าน เก็บไว้ให้เห็นเหตุผล
          await saveDraft({ ...d, lastError: err instanceof ApiError ? err.message : String(err) });
        }
      }
      if (sent) {
        toast(`ส่งบันทึกที่ค้างในเครื่องแล้ว ${sent} รายการ`);
        await reload();
      }
    } finally {
      syncing.current = false;
      await refreshDrafts();
    }
  }, [reload, refreshDrafts]);

  const queueDraft = useCallback(async (d: VisitDraft) => {
    await saveDraft(d);
    await refreshDrafts();
  }, [refreshDrafts]);

  useEffect(() => {
    // ส่งร่างที่ค้าง: ตอนเปิดแอป, ตอนเน็ตกลับมา, และทุก 1 นาที
    const t0 = setTimeout(syncDrafts, 0);
    window.addEventListener("online", syncDrafts);
    const t = setInterval(syncDrafts, 60_000);
    return () => {
      clearTimeout(t0);
      window.removeEventListener("online", syncDrafts);
      clearInterval(t);
    };
  }, [syncDrafts]);

  const store: Store = {
    data,
    isAdmin: data.user.role === "admin",
    fy,
    setFy,
    fys,
    reload,
    modal,
    open: setModal,
    patientById: (id) => (id ? idx.patients.get(id) : undefined),
    contactById: (id) => idx.contacts.get(id),
    contactsOf: (pid) => idx.byPatient.get(pid) ?? [],
    followupsOf: (pid) => idx.fu.get(pid) ?? [],
    visitsOf: (ref) => idx.visits.get(ref) ?? [],
    unitName: (id) => (id ? idx.units.get(id) ?? "" : ""),
    tasksOfContact,
    tasksOfPatient,
    allDue: () => {
      const out: DueItem[] = [];
      for (const c of data.contacts) for (const t of tasksOfContact(c)) out.push({ ...t, kind: "C", rec: c });
      if (data.user.role === "admin") for (const p of data.patients) for (const t of tasksOfPatient(p)) out.push({ ...t, kind: "P", rec: p });
      return out.filter((x) => x.due).sort((a, b) => (a.due! < b.due! ? -1 : 1));
    },
    drafts,
    queueDraft,
    syncDrafts,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
