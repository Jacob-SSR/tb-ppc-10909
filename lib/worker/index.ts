// lib/worker/index.ts — งานเบื้องหลังตัวเดียว (leader election ผ่าน Redis แบบ ppc-hos cacheWarmer)
// เริ่มจาก instrumentation.ts — ปิดได้ด้วย WORKER=0
//   ทุก 1 นาที  : ส่งคิว outbox ไป Google Sheet
//   02:00       : rebuild ทุกแท็บจาก MySQL
//   07:00       : แจ้งนัด (LINE + อีเมล)
//   ทุกชั่วโมง  : คิวค้าง > 1 ชม. → แจ้ง LINE (ไม่เกินทุก 6 ชม.)
import { tbDb } from "../db.ts";
import { lineConfigured, sendLine } from "../notify.ts";
import { redis } from "../redis.ts";
import { sheetsConfigured } from "../sheets.ts";
import { todayBangkok } from "../tb/dates.ts";
import { Mirror } from "./mirror.ts";
import { checkStaleOutbox, sendDailyReminder } from "./reminders.ts";
import { googleSheetApi } from "./sheetApi.ts";

const LEADER_KEY = "tb:worker:leader";
const LEADER_TTL_MS = 60_000;
const TICK_MS = 60_000;
const INSTANCE = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let isLeader = false;
let started = false;
let running = false;

async function claimLeadership(): Promise<boolean> {
  try {
    if (isLeader) {
      if ((await redis.get(LEADER_KEY)) === INSTANCE) {
        await redis.pexpire(LEADER_KEY, LEADER_TTL_MS);
        return true;
      }
      isLeader = false;
    }
    isLeader = (await redis.set(LEADER_KEY, INSTANCE, "PX", LEADER_TTL_MS, "NX")) === "OK";
    return isLeader;
  } catch {
    // Redis ล่ม: ไม่ทำงานเลยดีกว่าทำซ้ำหลายตัว (คิวยังอยู่ใน MySQL ไม่หาย)
    return false;
  }
}

/** ทำครั้งเดียวต่อกุญแจ (เช่น ต่อวัน) แม้ leader เปลี่ยนตัว */
async function once(key: string, ttlSec: number): Promise<boolean> {
  try {
    return (await redis.set(`tb:once:${key}`, INSTANCE, "EX", ttlSec, "NX")) === "OK";
  } catch {
    return false;
  }
}

function bangkokClock(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const [h, m] = p.split(":").map(Number);
  return { h, m, today: todayBangkok(now) };
}

const log = (...a: unknown[]) => console.log("[worker]", ...a);

async function tick() {
  if (running || !(await claimLeadership())) return;
  running = true;
  try {
    const { h, today } = bangkokClock();
    const sheets = sheetsConfigured();
    const mirror = sheets ? new Mirror(googleSheetApi(), tbDb) : null;

    if (mirror && (await once(`sheet-setup:${process.env.TB_SPREADSHEET_ID}`, 24 * 3600))) {
      await mirror.ensureTabs(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL).catch((e) => log("ensureTabs ล้มเหลว:", e.message));
    }
    if (mirror) {
      const r = await mirror.processOutbox();
      if (r.sent || r.failed) log(`outbox ส่งแล้ว ${r.sent} ล้มเหลว ${r.failed}`);
    }
    if (mirror && h === 2 && (await once(`rebuild:${today}`, 26 * 3600))) {
      log("rebuild Sheet:", await mirror.rebuild());
    }
    if (h === 7 && (await once(`reminder:${today}`, 26 * 3600))) {
      log("แจ้งนัด:", await sendDailyReminder(tbDb, today));
    }
    if (sheets && lineConfigured() && (await once(`stale-check:${today}:${h}`, 3600))) {
      const s = await checkStaleOutbox(tbDb);
      if (s.pending && (await once("stale-alert", 6 * 3600))) {
        await sendLine(`⚠ ระบบทะเบียนวัณโรค: มีข้อมูลค้างส่งไป Google Sheet ${s.pending} รายการ (เก่าสุด ${s.oldest?.slice(0, 16)}) — ตรวจการเชื่อมต่อ Google`);
      }
    }
  } catch (err) {
    log("ผิดพลาด:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startWorker() {
  if (started) return;
  if (process.env.WORKER === "0") {
    log("ปิดอยู่ (WORKER=0)");
    return;
  }
  started = true;
  setTimeout(() => {
    log(`เริ่มทำงาน (Sheet ${sheetsConfigured() ? "เปิด" : "ปิด"}, LINE ${lineConfigured() ? "เปิด" : "ปิด"})`);
    tick();
    setInterval(tick, TICK_MS);
  }, 15_000);
}
