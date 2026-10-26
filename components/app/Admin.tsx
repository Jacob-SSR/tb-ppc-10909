"use client";
// แท็บ นำเข้า/ส่งออก, ตั้งเป้าหมาย, ผู้ใช้
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Field, Input, Section, Select, Spinner, Textarea, toast } from "@/components/ui";
import { INDICATORS } from "@/lib/indicators";
import { PERIOD_LABEL, type PeriodQuarter } from "@/lib/tb/targets";
import { api } from "./api";
import { useApp } from "./store";

// ── นำเข้า / ส่งออก ────────────────────────────────────────────────────────────

interface Report {
  kind: string; sheet: string; dry: boolean; read: number; added: number; updated: number; unchanged: number;
  skipped: { row: number; reason: string }[]; unknownHeaders: string[];
}

interface MigrateResult {
  dry: boolean; source: string; warnings: string[];
  reports: { tab: string; report: Omit<Report, "kind" | "sheet" | "dry"> }[];
  log: { read: number; added: number };
  inDb: { patients: number; contacts: number; visits: number };
  inSource: { patients: number; contacts: number; visits: number };
}

/** ย้ายข้อมูลจากระบบเดิมจากเว็บ (แทนการรันสคริปต์) — อ่าน Google Sheet ตรง หรือไฟล์ .xlsx ที่ดาวน์โหลดมา */
function MigratePanel() {
  const { data, reload } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<MigrateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const canSheet = data.features.sheet;

  async function run(dry: boolean) {
    if (!dry && !confirm(`ยืนยันย้ายข้อมูลจาก ${res?.source ?? "ระบบเดิม"} เข้าระบบ? (รันซ้ำได้ — ข้อมูลเดิมถูกอัปเดตตามรหัส ไม่ซ้ำ)`)) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("dry", dry ? "1" : "0");
    if (file) fd.set("file", file);
    try {
      const r = await api<MigrateResult>("POST", "/api/migrate", fd);
      setRes(r);
      if (!dry) {
        toast(`ย้ายข้อมูลแล้ว: ผู้ป่วยในระบบ ${r.inDb.patients} ราย`);
        await reload();
      }
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }

  const skipped = res ? res.reports.reduce((n, x) => n + x.report.skipped.length, 0) : 0;
  return (
    <Section title="ย้ายข้อมูลจากระบบเดิม (Google Sheet → ระบบนี้)">
      <p className="mb-3 text-sm text-muted">
        ดึง DB_Patients / DB_Contacts / DB_Visits / DB_Log จากระบบเดิม คงรหัสเดิม รันซ้ำได้ (ไม่เพิ่มซ้ำ) · ไม่ดึง DB_Users (PIN)
        · {canSheet ? "ไม่เลือกไฟล์ = อ่านจาก Google Sheet ตรง" : "ยังไม่ได้ตั้ง Google Sheet — ดาวน์โหลด Sheet เป็น .xlsx แล้วเลือกไฟล์"}
      </p>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-dashed border-line bg-background p-3">
        <Field label={canSheet ? "ไฟล์ .xlsx (ไม่บังคับ)" : "ไฟล์ .xlsx"}><Input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} /></Field>
        <Button onClick={() => run(true)} disabled={busy || (!canSheet && !file)}>{busy ? "กำลังอ่าน…" : "1) ตรวจก่อน (ยังไม่บันทึก)"}</Button>
      </div>
      {res && (
        <Card className="mt-3">
          <div className="font-semibold">{res.dry ? "ผลตรวจ (ยังไม่บันทึก)" : "ย้ายข้อมูลเสร็จ"} · จาก {res.source}</div>
          {res.warnings.map((w) => <div key={w} className="text-sm text-warn">⚠ {w}</div>)}
          <ul className="mt-1 space-y-0.5 text-sm">
            {res.reports.map(({ tab, report: r }) => (
              <li key={tab}>{tab}: อ่าน {r.read} · <b className="text-ok">เพิ่ม {r.added}</b> · <b className="text-brand">อัปเดต {r.updated}</b> · ไม่เปลี่ยน {r.unchanged} · <b className="text-bad">ปฏิเสธ {r.skipped.length}</b></li>
            ))}
            <li>DB_Log: นำเข้าเป็นประวัติ {res.log.added} จาก {res.log.read}</li>
          </ul>
          <div className={`mt-2 text-sm font-semibold ${res.inDb.patients >= res.inSource.patients ? "text-ok" : "text-bad"}`}>
            ผู้ป่วยในระบบหลังย้าย {res.inDb.patients} · ในแหล่ง {res.inSource.patients}
            {res.inDb.patients > res.inSource.patients && <span className="font-normal text-muted"> (เกินเพราะมีรายที่คีย์ในระบบนี้อยู่แล้ว เช่น ข้อมูลทดสอบ)</span>}
          </div>
          {skipped > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto text-sm text-bad">
              {res.reports.flatMap(({ tab, report }) => report.skipped.map((x) => <li key={`${tab}${x.row}`}>{tab} แถว {x.row}: {x.reason}</li>))}
            </ul>
          )}
          {res.dry && <Button className="mt-3" onClick={() => run(false)} disabled={busy}>2) ย้ายข้อมูลจริง</Button>}
        </Card>
      )}
    </Section>
  );
}

export function ImportExportTab() {
  const { fy, isAdmin, reload } = useApp();
  const [kind, setKind] = useState<"patient" | "contact">("patient");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dry: boolean) {
    if (!file) return toast("กรุณาเลือกไฟล์", "bad");
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    fd.set("dry", dry ? "1" : "0");
    try {
      const r = await api<Report>("POST", "/api/import", fd);
      setReport(r);
      if (!dry) {
        toast(`นำเข้าแล้ว: เพิ่ม ${r.added} · อัปเดต ${r.updated} · ข้าม ${r.skipped.length}`);
        setFile(null);
        await reload();
      }
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="ส่งออก Excel">
        <p className="mb-3 text-sm text-muted">หัวคอลัมน์เดียวกับ Sheet เดิม · วันที่เป็น วว/ดด/ปปปป (พ.ศ.){isAdmin ? " · มีแผ่นงาน ผู้ป่วย, ผู้สัมผัส, ติดตามระหว่างรักษา" : " · เฉพาะผู้สัมผัสในเขตของหน่วยท่าน"}</p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/export?fy=${fy}`}><Button>ส่งออกปีงบ {fy}</Button></a>
          <a href="/api/export?fy=all"><Button variant="ghost">ส่งออกทุกปีงบ</Button></a>
        </div>
      </Section>
      {isAdmin && <MigratePanel />}
      {isAdmin ? (
        <Section title="นำเข้าจาก Excel">
          <p className="mb-3 text-sm text-muted">
            ใช้หัวคอลัมน์ตามแบบฟอร์ม (หรือไฟล์ที่ส่งออกจากระบบ) · จับคู่ผู้ป่วยด้วย <b>รหัสระบบ</b> หรือ <b>ปีงบ + HN</b>, ผู้สัมผัสด้วย <b>รหัสระบบ</b> หรือ <b>HN ผู้ป่วย index + ชื่อ</b> · <b>ช่องว่างในไฟล์ไม่ลบข้อมูลเดิม</b> · ทุกแถวผ่านการตรวจและบันทึกประวัติเหมือนคีย์เอง
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <a href="/api/export?template=patient"><Button variant="ghost" size="sm">แบบฟอร์มผู้ป่วย</Button></a>
            <a href="/api/export?template=contact"><Button variant="ghost" size="sm">แบบฟอร์มผู้สัมผัส</Button></a>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-dashed border-line bg-background p-3">
            <Field label="ข้อมูล"><Select className="w-auto" placeholder={false} options={[{ value: "patient", label: "ผู้ป่วย" }, { value: "contact", label: "ผู้สัมผัส" }]} value={kind} onChange={(e) => { setKind(e.target.value as "patient"); setReport(null); }} /></Field>
            <Field label="ไฟล์ .xlsx"><Input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} /></Field>
            <Button variant="ghost" onClick={() => run(true)} disabled={!file || busy}>ตรวจไฟล์ (ยังไม่บันทึก)</Button>
          </div>
          {report && (
            <Card className="mt-3">
              <div className="font-semibold">{report.dry ? "ผลตรวจไฟล์ (ยังไม่บันทึก)" : "นำเข้าเสร็จ"} · แผ่นงาน &quot;{report.sheet}&quot;</div>
              <div className="mt-1 text-sm">อ่าน {report.read} แถว · <b className="text-ok">เพิ่มใหม่ {report.added}</b> · <b className="text-brand">อัปเดต {report.updated}</b> · ไม่เปลี่ยน {report.unchanged} · <b className="text-bad">ข้าม {report.skipped.length}</b></div>
              {report.unknownHeaders.length > 0 && <div className="mt-1 text-xs text-warn">ข้ามคอลัมน์ที่ไม่รู้จัก: {report.unknownHeaders.slice(0, 8).join(", ")}</div>}
              {report.skipped.length > 0 && (
                <ul className="mt-2 max-h-48 overflow-y-auto text-sm text-bad">{report.skipped.map((s) => <li key={s.row}>แถว {s.row}: {s.reason}</li>)}</ul>
              )}
              {report.dry && report.added + report.updated > 0 && (
                <Button className="mt-3" onClick={() => run(false)} disabled={busy}>ยืนยันนำเข้า {report.added + report.updated} แถว</Button>
              )}
            </Card>
          )}
        </Section>
      ) : (
        <p className="text-sm text-muted">การนำเข้าไฟล์ทำได้โดยทีม รพ. · หน่วยของท่านคีย์ข้อมูลผ่านแท็บ &quot;ผู้สัมผัส&quot;</p>
      )}
    </>
  );
}

// ── ตั้งเป้าหมาย + การแจ้งเตือน ────────────────────────────────────────────────

const QUARTER_MONTHS: Record<PeriodQuarter, string> = { 0: "ต.ค.–ก.ย.", 1: "ต.ค.–ธ.ค.", 2: "ม.ค.–มี.ค.", 3: "เม.ย.–มิ.ย.", 4: "ก.ค.–ก.ย." };

export function SettingsTab() {
  const { data, fys, fy: currentFy, reload } = useApp();
  const [fy, setFy] = useState(currentFy);
  const key = (q: number, ind: string) => `${q}:${ind}`;
  const valuesFor = (y: number) => Object.fromEntries(
    data.targets.filter((t) => t.fy === y).map((t) => [key(Number(t.quarter), t.indicator), String(Number(t.target))]),
  );
  const [vals, setVals] = useState<Record<string, string>>(() => valuesFor(fy));
  const changeFy = (y: number) => {
    setFy(y);
    setVals(valuesFor(y));
  };
  const [emails, setEmails] = useState(data.settings.reminder_emails ?? "");
  const [busy, setBusy] = useState(false);

  /** แบ่งเป้าทั้งปีลง Q1–Q4: จำนวนราย = หาร 4 (เศษให้ไตรมาสแรกๆ), ร้อยละ = ใช้ค่าเดียวกันทุกไตรมาส */
  function splitYear(ind: (typeof INDICATORS)[number]) {
    const year = Number(vals[key(0, ind.id)]);
    if (!vals[key(0, ind.id)]?.trim() || !Number.isFinite(year)) return toast("กรอกช่อง \"ทั้งปีงบ\" ก่อน", "bad");
    const next = { ...vals };
    for (const q of [1, 2, 3, 4]) {
      next[key(q, ind.id)] = ind.unit === "percent"
        ? String(year)
        : String(Math.floor(year / 4) + (q <= Math.round(year) % 4 ? 1 : 0));
    }
    setVals(next);
  }

  async function save() {
    setBusy(true);
    const targets = INDICATORS.flatMap((ind) => ([0, 1, 2, 3, 4] as PeriodQuarter[]).map((q) => {
      const v = vals[key(q, ind.id)]?.trim();
      return { fy, quarter: q, indicator: ind.id, target: v ? Number(v) : null };
    }));
    try {
      await api("PUT", "/api/settings", { targets, reminder_emails: emails });
      toast("บันทึกเป้าหมายแล้ว");
      await reload();
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }

  async function test(channel: "line" | "email") {
    try {
      const r = await api<{ message: string }>("POST", "/api/notify/test", { channel });
      toast(r.message);
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  const years = [...new Set([...fys, currentFy + 1])].sort((a, b) => b - a);
  return (
    <>
      <Section title="ตั้งเป้าหมายตัวชี้วัด (ค่า B ในการ์ด A/B)">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-muted">ปีงบ</span>
          <Select className="w-auto" placeholder={false} options={years.map((y) => ({ value: y, label: String(y) }))} value={fy} onChange={(e) => changeFy(Number(e.target.value))} />
        </div>
        <div className="mb-3 rounded-xl bg-mint p-3 text-sm leading-relaxed">
          <div className="mb-1 font-semibold text-brand">กรอกอะไร?</div>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>แถวแรก <b>ผู้ป่วยใหม่ + กลับเป็นซ้ำ</b> → กรอก <b>จำนวนคน (ราย)</b> ที่จังหวัดให้เป็นเป้า เช่น เป้าทั้งปี 60 ราย → ทั้งปีงบ <b>60</b>, แต่ละไตรมาส <b>15</b></li>
            <li>แถวที่เป็น <b>%</b> → กรอก<b>ตัวเลขร้อยละ</b> ไม่ต้องพิมพ์เครื่องหมาย % เช่น Success Rate เป้า 88% → กรอก <b>88</b></li>
            <li><b>อัตราเสียชีวิต</b> ยิ่งต่ำยิ่งดี → กรอก<b>ค่าสูงสุดที่ยอมรับได้</b> เช่น ไม่เกิน 5% → กรอก <b>5</b></li>
            <li><b>Q1</b> ต.ค.–ธ.ค. · <b>Q2</b> ม.ค.–มี.ค. · <b>Q3</b> เม.ย.–มิ.ย. · <b>Q4</b> ก.ค.–ก.ย. — ถ้าไม่ดูรายไตรมาส กรอกแค่ <b>ทั้งปีงบ</b> ก็พอ หรือกด <b>&quot;แบ่งลงไตรมาส&quot;</b> ให้ระบบเติมให้</li>
            <li>Treatment Coverage คำนวณจากแถวแรก — ต้องกรอกเป้าจำนวนผู้ป่วยของช่วงนั้นก่อนจึงจะแสดงผลได้</li>
            <li>ช่องที่เว้นว่าง = ยังไม่ตั้งเป้า (แดชบอร์ดแสดง &quot;ยังไม่ตั้งเป้า&quot; ไม่ใช่ 0%)</li>
          </ul>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-2 font-medium">ตัวชี้วัด</th>
                {([0, 1, 2, 3, 4] as PeriodQuarter[]).map((q) => (
                  <th key={q} className="px-1 font-medium">{PERIOD_LABEL[q]}<div className="text-[11px] font-normal">{QUARTER_MONTHS[q]}</div></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INDICATORS.map((ind) => (
                <tr key={ind.id} className="border-t border-line align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{ind.label} <span className="text-xs text-muted">({ind.unit === "cases" ? "ราย" : "%"})</span></div>
                    <div className="text-xs text-muted">{ind.hint}</div>
                    <button type="button" className="mt-1 text-xs text-brand-2 underline" onClick={() => splitYear(ind)}>
                      แบ่งลงไตรมาส {ind.unit === "cases" ? "(ทั้งปี ÷ 4)" : "(ใช้ค่าเดียวกับทั้งปี)"}
                    </button>
                  </td>
                  {([0, 1, 2, 3, 4] as PeriodQuarter[]).map((q) => (
                    <td key={q} className="px-1 py-2">
                      <div className="relative w-24">
                        <Input type="number" min={0} max={ind.unit === "percent" ? 100 : undefined} step={ind.unit === "percent" ? 0.1 : 1}
                          aria-label={`${ind.label} ${PERIOD_LABEL[q]}`}
                          value={vals[key(q, ind.id)] ?? ""} onChange={(e) => setVals({ ...vals, [key(q, ind.id)]: e.target.value })} className="pr-9" />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{ind.unit === "percent" ? "%" : "ราย"}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="แจ้งเตือนนัดทุกเช้า 07:00" tone="contact">
        <Field label="อีเมลผู้รับ (คั่นด้วยจุลภาค)"><Textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="nurse.tb@example.com, pcu1@example.com" /></Field>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          LINE OA: {data.features.line ? <Badge tone="ok">ตั้งค่าแล้ว</Badge> : <Badge tone="muted">ยังไม่ตั้ง (LINE_CHANNEL_ACCESS_TOKEN ใน env)</Badge>}
          {data.features.line && <Button size="sm" variant="ghost" onClick={() => test("line")}>ส่งข้อความทดสอบ</Button>}
          · อีเมล: {data.features.email ? <Badge tone="ok">ตั้งค่าแล้ว</Badge> : <Badge tone="muted">ยังไม่ตั้ง (SMTP_* ใน env)</Badge>}
          {data.features.email && <Button size="sm" variant="ghost" onClick={() => test("email")}>ส่งอีเมลทดสอบ</Button>}
          · Google Sheet: {data.features.sheet ? <Badge tone="ok">sync อยู่</Badge> : <Badge tone="muted">ยังไม่ตั้ง</Badge>}
        </div>
        <p className="mt-2 text-xs text-muted">token / รหัสต่างๆ เก็บใน env ของเซิร์ฟเวอร์เท่านั้น ไม่เก็บในฐานข้อมูลและไม่แสดงบนหน้าเว็บ</p>
      </Section>
      {data.features.sheet && <SheetStatus />}
      <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกเป้าหมายและอีเมล"}</Button></div>
    </>
  );
}

interface SheetState { pending: number; oldest: string | null; last_error: string | null; last_sent: string | null; blocked: string | null }

function SheetStatus() {
  const [st, setSt] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<SheetState>("GET", "/api/sheet").then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  async function rebuild() {
    if (!confirm("เขียน Google Sheet ใหม่ทั้งหมดจากฐานข้อมูลตอนนี้?")) return;
    setBusy(true);
    try {
      const r = await api<{ counts: Record<string, number> }>("POST", "/api/sheet");
      toast(`เขียน Sheet ใหม่แล้ว: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
      load();
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Google Sheet (สำเนาสำหรับดู — ระบบเขียนให้อัตโนมัติ)">
      {st?.blocked && <p className="mb-2 rounded-xl bg-bad-bg p-3 text-sm text-bad">⛔ {st.blocked}</p>}
      {!st ? <Spinner /> : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {Number(st.pending) ? <Badge tone="warn">รอส่ง {st.pending} รายการ</Badge> : <Badge tone="ok">ส่งครบแล้ว</Badge>}
          {st.last_sent && <span className="text-muted">ส่งล่าสุด {String(st.last_sent).slice(0, 16)}</span>}
          {st.last_error && <span className="text-bad">ผิดพลาดล่าสุด: {st.last_error}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={rebuild} disabled={busy || !!st.blocked}>{busy ? "กำลังเขียน…" : "เขียน Sheet ใหม่ทั้งหมดตอนนี้"}</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">ส่งทุก 1 นาที · เขียนใหม่ทั้งหมดทุกคืน 02:00 · ค้างเกิน 1 ชม. แจ้ง LINE · แก้ข้อมูลที่เว็บนี้ (แก้ใน Sheet จะถูกเขียนทับรอบถัดไป)</p>
    </Section>
  );
}

// ── ผู้ใช้ ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: number; username: string; display_name: string; unit_id: number; unit_name: string; role: string; active: number;
  must_change_password: number; locked_until: string | null; last_login_at: string | null;
}

export function UsersTab() {
  const { data } = useApp();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", unitId: "" });
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const load = () => api<{ users: UserRow[] }>("GET", "/api/users").then((r) => setUsers(r.users)).catch((e) => toast(e.message, "bad"));
  useEffect(() => { load(); }, []);

  async function create() {
    try {
      const r = await api<{ tempPassword: string }>("POST", "/api/users", { ...form, unitId: Number(form.unitId) });
      setSecret({ username: form.username.toLowerCase(), password: r.tempPassword });
      setForm({ username: "", displayName: "", unitId: "" });
      load();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  async function patch(u: UserRow, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const r = await api<{ tempPassword: string | null }>("PATCH", `/api/users/${u.id}`, body);
      if (r.tempPassword) setSecret({ username: u.username, password: r.tempPassword });
      else toast("บันทึกแล้ว");
      load();
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  }

  return (
    <>
      {secret && (
        <div className="mb-3 rounded-2xl border-2 border-warn bg-warn-bg p-4">
          <div className="font-semibold">รหัสผ่านชั่วคราวของ {secret.username}</div>
          <div className="my-2 select-all font-mono text-2xl tracking-wider">{secret.password}</div>
          <p className="text-sm text-muted">แสดงครั้งเดียว — แจ้งผู้ใช้โดยตรง (ไม่ส่งในกลุ่ม) ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งแรก</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSecret(null)}>ปิด</Button>
        </div>
      )}
      <Section title="เพิ่มผู้ใช้ (บัญชีรายคน)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="ชื่อผู้ใช้ (a-z 0-9 . _ -)"><Input autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="ชื่อ-สกุล"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="หน่วยบริการ"><Select options={data.units.map((u) => ({ value: u.id, label: `${u.name}${u.role === "admin" ? " (ผู้ดูแล)" : ""}` }))} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} /></Field>
          <div className="flex items-end"><Button onClick={create} disabled={!form.username || !form.displayName || !form.unitId} className="w-full">+ สร้างบัญชี</Button></div>
        </div>
        <p className="mt-2 text-xs text-muted">สิทธิ์ตามหน่วย: รพ.พลับพลาชัย = ผู้ดูแล (เห็น/แก้ได้ทั้งหมด), รพ.สต. = เฉพาะผู้สัมผัสในเขตตัวเอง</p>
      </Section>
      {!users ? <Spinner /> : !users.length ? <Empty>ยังไม่มีผู้ใช้</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-background text-left text-muted"><th className="p-2 font-medium">ผู้ใช้</th><th className="font-medium">หน่วย</th><th className="font-medium">สถานะ</th><th className="font-medium">เข้าล่าสุด</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="p-2"><div className="font-medium">{u.display_name}</div><div className="text-xs text-muted">{u.username}</div></td>
                  <td>
                    <select className="rounded-lg border border-line px-2 py-1" value={u.unit_id} onChange={(e) => patch(u, { unitId: Number(e.target.value) }, `ย้าย ${u.display_name} ไปหน่วยอื่น? (ผู้ใช้จะถูกออกจากระบบ)`)}>
                      {data.units.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </td>
                  <td className="space-x-1">
                    {u.active ? <Badge tone="ok">ใช้งาน</Badge> : <Badge tone="muted">ปิดแล้ว</Badge>}
                    {u.locked_until && <Badge tone="bad">ล็อกถึง {u.locked_until.slice(11, 16)}</Badge>}
                    {u.must_change_password ? <Badge tone="warn">รอเปลี่ยนรหัส</Badge> : null}
                  </td>
                  <td className="text-xs text-muted">{u.last_login_at?.slice(0, 16) ?? "-"}</td>
                  <td className="space-x-1 whitespace-nowrap p-2 text-right">
                    {u.locked_until && <Button size="sm" variant="ghost" onClick={() => patch(u, { unlock: true })}>ปลดล็อก</Button>}
                    <Button size="sm" variant="ghost" onClick={() => patch(u, { resetPassword: true }, `reset รหัสผ่านของ ${u.display_name}?`)}>reset รหัส</Button>
                    {u.id !== data.user.id && (u.active
                      ? <Button size="sm" variant="danger" onClick={() => patch(u, { active: false }, `ปิดบัญชี ${u.display_name}?`)}>ปิดบัญชี</Button>
                      : <Button size="sm" variant="ghost" onClick={() => patch(u, { active: true })}>เปิดบัญชี</Button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
