// หน้าแรกชั่วคราว ระหว่างพัฒนา — Phase 2 จะพาไปหน้า login, Phase 4 เป็นหน้าทะเบียนจริง
import { connection } from "next/server";
import { Suspense } from "react";
import { checkHealth } from "@/lib/health";

const PHASES: [string, boolean][] = [
  ["ฐานระบบ: Docker, MySQL + migration, logic ทะเบียน + test", true],
  ["เข้าสู่ระบบรายคน + ล็อกบัญชี + จัดการผู้ใช้", false],
  ["API ผู้ป่วย / ผู้สัมผัส / บันทึกการรักษา / เป้าหมาย + สิทธิ์ + audit log", false],
  ["หน้าจอทะเบียน, ต้องติดตาม, นัดหมาย, dashboard, นำเข้า/ส่งออก Excel", false],
  ["ย้ายข้อมูลเดิมจาก Google Sheet", false],
  ["sync กลับ Google Sheet + แจ้งเตือนนัด 07:00", false],
  ["backup ทุกคืน + เปิดใช้งานจริง", false],
];

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
        ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
      }`}
    >
      <span className={`size-2 rounded-full ${ok ? "bg-ok" : "bg-bad"}`} />
      {label} {ok ? "พร้อม" : "ต่อไม่ได้"}
    </span>
  );
}

async function SystemStatus() {
  await connection(); // เช็คสถานะตอนเปิดหน้า ไม่ prerender
  const h = await checkHealth();
  return (
    <div className="flex flex-wrap gap-2">
      <Dot ok={h.db} label="ฐานข้อมูล" />
      <Dot ok={h.redis} label="Redis" />
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:py-16">
      <div className="rounded-2xl bg-brand px-6 py-6 text-white shadow-sm">
        <p className="text-sm opacity-80">โรงพยาบาลพลับพลาชัย และ รพ.สต. ในเครือข่าย</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">ทะเบียนวัณโรคและผู้สัมผัส</h1>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5">
        <h2 className="text-base font-semibold text-brand">สถานะระบบ</h2>
        <div className="mt-3">
          <Suspense fallback={<p className="text-sm text-muted">กำลังตรวจสอบ…</p>}>
            <SystemStatus />
          </Suspense>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-card p-5">
        <h2 className="text-base font-semibold text-brand">อยู่ระหว่างพัฒนา</h2>
        <p className="mt-1 text-sm text-muted">
          ระหว่างนี้ยังใช้ระบบเดิม (Google Apps Script) ตามปกติ
        </p>
        <ol className="mt-4 space-y-2">
          {PHASES.map(([label, done], i) => (
            <li key={label} className="flex gap-3 text-sm">
              <span
                className={`flex size-6 flex-none items-center justify-center rounded-full text-xs font-semibold ${
                  done ? "bg-brand-2 text-white" : "bg-mint text-brand"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={done ? "text-foreground" : "text-muted"}>{label}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
