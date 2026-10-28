"use client";
// โครงหน้าหลัก: โหลดข้อมูล, แถบหัว, แท็บ, modal
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Spinner, Toaster, toast } from "@/components/ui";
import { ImportExportTab, SettingsTab, UsersTab } from "./Admin";
import { api } from "./api";
import { ContactForm } from "./ContactForm";
import { AppointmentForm, HosxpApptPicker, PickApptRef } from "./Appointments";
import { DashboardTab } from "./Dashboard";
import { History } from "./History";
import { ContactsTab, PatientsTab, PickIndex } from "./Lists";
import { PatientDetail } from "./PatientDetail";
import { PatientForm } from "./PatientForm";
import { AppointmentsTab, DueTab } from "./Schedule";
import { AppProvider, useApp } from "./store";
import type { AppData } from "./types";

type Tab = "dash" | "pat" | "con" | "appt" | "due" | "io" | "settings" | "users";
const TABS: { id: Tab; label: string; admin?: boolean }[] = [
  { id: "dash", label: "แดชบอร์ด", admin: true },
  { id: "pat", label: "ผู้ป่วย", admin: true },
  { id: "con", label: "ผู้สัมผัส" },
  { id: "appt", label: "นัดหมาย" },
  { id: "due", label: "ต้องติดตาม" },
  { id: "io", label: "นำเข้า / ส่งออก" },
  { id: "settings", label: "ตั้งเป้าหมาย", admin: true },
  { id: "users", label: "ผู้ใช้", admin: true },
];

function Shell() {
  const { data, isAdmin, fy, setFy, fys, reload, modal, allDue, drafts, syncDrafts } = useApp();
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const [tab, setTab] = useState<Tab>(isAdmin ? "dash" : "due");
  const lateCount = allDue().filter((x) => x.due! < data.today).length;

  useEffect(() => {
    const onTab = (e: Event) => setTab((e as CustomEvent).detail as Tab);
    document.addEventListener("tb:tab", onTab);
    return () => document.removeEventListener("tb:tab", onTab);
  }, []);

  async function logout() {
    await api("POST", "/api/auth/logout").catch(() => {});
    // โหลดหน้าใหม่ทั้งหมด ล้าง state ข้อมูลผู้ป่วยออกจากหน่วยความจำของเบราว์เซอร์
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-brand px-4 py-3 text-white">
        <h1 className="min-w-44 flex-1 text-lg font-semibold">ทะเบียนวัณโรคและผู้สัมผัส</h1>
        {drafts.length > 0 && (
          <button onClick={syncDrafts} title="กดเพื่อส่งตอนนี้"><Badge tone="warn">รอส่ง {drafts.length}</Badge></button>
        )}
        {isAdmin && (
          <label className="text-sm">ปีงบ{" "}
            <select value={fy} onChange={(e) => setFy(Number(e.target.value))} className="rounded-lg border-0 bg-white px-2 py-1 text-foreground">
              {fys.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        )}
        <span className="text-sm opacity-85">{data.user.displayName} · {data.user.unitName}</span>
        <button onClick={() => reload().then(() => toast("โหลดข้อมูลล่าสุดแล้ว")).catch((e) => toast(e.message, "bad"))} title="โหลดข้อมูลล่าสุด" className="rounded-lg border border-white/40 px-2.5 py-1">↻</button>
        <button onClick={logout} className="rounded-lg border border-white/40 px-2.5 py-1 text-sm">ออก</button>
      </header>
      <nav className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-line bg-white px-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-[3px] px-3 py-3 font-medium ${tab === t.id ? "border-brand text-brand" : "border-transparent text-muted"}`}>
            {t.label}
            {t.id === "due" && lateCount > 0 && <span className="ml-1 rounded-full bg-bad px-1.5 text-xs text-white">{lateCount}</span>}
          </button>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4">
        {tab === "dash" && <DashboardTab />}
        {tab === "pat" && <PatientsTab />}
        {tab === "con" && <ContactsTab />}
        {tab === "appt" && <AppointmentsTab />}
        {tab === "due" && <DueTab />}
        {tab === "io" && <ImportExportTab />}
        {tab === "settings" && <SettingsTab />}
        {tab === "users" && <UsersTab />}
      </main>
      {modal?.type === "patient" && <PatientDetail key={modal.id} id={modal.id} />}
      {modal?.type === "patientForm" && <PatientForm patient={modal.patient} />}
      {modal?.type === "contact" && <ContactForm key={modal.contact.id ?? "new"} contact={modal.contact} />}
      {modal?.type === "pickIndex" && <PickIndex />}
      {modal?.type === "history" && <History id={modal.id} title={modal.title} back={modal.back} />}
      {modal?.type === "appointment" && <AppointmentForm key={modal.appt.id ?? "new"} appt={modal.appt} back={modal.back} />}
      {modal?.type === "pickAppt" && <PickApptRef />}
      {modal?.type === "hosxpAppts" && <HosxpApptPicker patientId={modal.patientId} contactId={modal.contactId} back={modal.back} />}
    </>
  );
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const fetchData = useCallback(() => api<AppData>("GET", "/api/data").then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const load = () => {
    setError("");
    fetchData();
  };

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-bad">{error}</p>
        <Button onClick={load}>ลองใหม่</Button>
      </main>
    );
  }
  if (!data) return <Spinner label="กำลังโหลดข้อมูล…" />;
  return (
    <AppProvider initial={data}>
      <Shell />
      <Toaster />
    </AppProvider>
  );
}
