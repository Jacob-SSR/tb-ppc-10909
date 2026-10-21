// lib/tb/dates.ts
// วันที่ทั้งหมดในระบบเป็นสตริง "YYYY-MM-DD" (ค.ศ.) — ตรงกับคอลัมน์ DATE ใน MySQL
// (tbDb ตั้ง dateStrings: true จึงได้สตริงกลับมาตรงๆ ไม่ผ่าน Date/timezone)
// คำนวณด้วย UTC ล้วน กันวันเลื่อนจาก timezone ของเครื่อง
// แสดงผลเป็น พ.ศ. ด้วย formatThaiDate() เท่านั้น — ห้ามเก็บ พ.ศ. ลง DB

export type IsoDate = string; // "YYYY-MM-DD"

const TZ = "Asia/Bangkok";
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BE_OFFSET = 543;

// Excel/Sheets นับวันจาก 1899-12-30 (รวมบั๊ก 29 ก.พ. 1900 ไว้แล้ว)
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** สร้าง IsoDate จาก ปี/เดือน/วัน (ค.ศ.) — คืน null ถ้าไม่ใช่วันที่จริง (เช่น 31/02) */
function makeIso(y: number, m: number, d: number): IsoDate | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`วันที่ไม่ใช่รูปแบบ YYYY-MM-DD: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toUtcMs(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** วันที่ (เวลาไทย) ของ instant นั้น */
function bangkokDate(instant: Date): IsoDate {
  // en-CA จัดรูปแบบเป็น YYYY-MM-DD อยู่แล้ว
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== "string") return false;
  const m = ISO_RE.exec(v);
  return !!m && makeIso(Number(m[1]), Number(m[2]), Number(m[3])) === v;
}

/** วันนี้ตามเวลาไทย */
export function todayBangkok(now: Date = new Date()): IsoDate {
  return bangkokDate(now);
}

/**
 * แปลงค่าวันที่จากทุกแหล่ง (Sheet, Excel, ฟอร์ม) เป็น "YYYY-MM-DD" ค.ศ.
 * รับ: dd/mm/yyyy (พ.ศ. หรือ ค.ศ.), yyyy-mm-dd (มีเวลาต่อท้ายได้, ปี พ.ศ. ได้),
 *      ISO ที่มี timezone (เช่น จาก Apps Script) → ใช้วันที่ตามเวลาไทย,
 *      Excel serial (ตัวเลข), Date
 * คืน null ถ้าว่างหรืออ่านไม่ออก — ผู้เรียกตัดสินเองว่าจะปฏิเสธแถวหรือเก็บ NULL
 */
export function toIso(v: unknown): IsoDate | null {
  if (v === null || v === undefined) return null;

  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : bangkokDate(v);
  }

  if (typeof v === "number") return fromExcelSerial(v);

  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // Excel serial ที่มาเป็นสตริง (เช่น "45567") — 5 หลักเท่านั้น กันสับสนกับปี 4 หลัก
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s));

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) return makeIso(ceYear(Number(dmy[3])), Number(dmy[2]), Number(dmy[1]));

  // ISO ที่ระบุ timezone ชัด = instant จริง → แปลงเป็นวันที่ไทย
  // (Apps Script ส่ง 2026-03-01T17:00:00.000Z ซึ่งคือ 2 มี.ค. เวลาไทย)
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return bangkokDate(dt);
  }

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (ymd) return makeIso(ceYear(Number(ymd[1])), Number(ymd[2]), Number(ymd[3]));

  return null;
}

function ceYear(y: number): number {
  return y > 2400 ? y - BE_OFFSET : y;
}

function fromExcelSerial(n: number): IsoDate | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  return fromUtcMs(EXCEL_EPOCH_MS + Math.floor(n) * DAY_MS);
}

/** ปีงบประมาณ พ.ศ. — ต.ค. ขึ้นปีงบใหม่ */
export function fyOf(date: IsoDate): number {
  const [y, m] = parts(date);
  return y + BE_OFFSET + (m >= 10 ? 1 : 0);
}

export type Quarter = 1 | 2 | 3 | 4;

/** ไตรมาสของปีงบ: Q1 ต.ค.–ธ.ค., Q2 ม.ค.–มี.ค., Q3 เม.ย.–มิ.ย., Q4 ก.ค.–ก.ย. */
export function quarterOf(date: IsoDate): Quarter {
  const [, m] = parts(date);
  if (m >= 10) return 1;
  if (m <= 3) return 2;
  if (m <= 6) return 3;
  return 4;
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate; // รวมวันสุดท้าย
}

/** ช่วงวันที่ของปีงบ (พ.ศ.) ทั้งปี */
export function fyRange(fy: number): DateRange {
  const ce = fy - BE_OFFSET;
  return { from: `${ce - 1}-10-01`, to: `${ce}-09-30` };
}

/** ช่วงวันที่ของไตรมาสนั้น (เฉพาะ 3 เดือน) */
export function quarterRange(fy: number, q: Quarter): DateRange {
  const ce = fy - BE_OFFSET;
  switch (q) {
    case 1: return { from: `${ce - 1}-10-01`, to: `${ce - 1}-12-31` };
    case 2: return { from: `${ce}-01-01`, to: `${ce}-03-31` };
    case 3: return { from: `${ce}-04-01`, to: `${ce}-06-30` };
    case 4: return { from: `${ce}-07-01`, to: `${ce}-09-30` };
  }
}

/**
 * ช่วงเวลาที่ dashboard ใช้: quarter 0 = ทั้งปีงบ
 * mode "quarter" = เฉพาะ 3 เดือนนั้น, "ytd" = สะสมตั้งแต่ต้นปีงบถึงสิ้นไตรมาส
 * (ยังรอเจ้าของงานยืนยันว่าใช้แบบไหน — CLAUDE.md §11 ข้อ 2 — จึงรองรับทั้งสองแบบ)
 */
export function periodRange(
  fy: number,
  quarter: 0 | Quarter,
  mode: "quarter" | "ytd" = "quarter",
): DateRange {
  if (quarter === 0) return fyRange(fy);
  const q = quarterRange(fy, quarter);
  return mode === "ytd" ? { from: fyRange(fy).from, to: q.to } : q;
}

export function inRange(date: IsoDate | null | undefined, r: DateRange): boolean {
  return !!date && date >= r.from && date <= r.to; // สตริง ISO เทียบกันตรงๆ ได้
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** บวกเดือน — วันเกินสิ้นเดือนให้ตัดเป็นวันสุดท้าย (31 ม.ค. + 1 = 28/29 ก.พ.) */
export function addMonths(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(date);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return makeIso(ny, nm, Math.min(d, daysInMonth(ny, nm)))!;
}

/** จำนวนวันจาก a ถึง b (b - a) */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** อายุเต็มปี ณ วันที่ asOf */
export function ageOn(birthday: IsoDate, asOf: IsoDate): number {
  const [by, bm, bd] = parts(birthday);
  const [y, m, d] = parts(asOf);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * แสดงวันที่เป็น พ.ศ.
 *   "short" → 21/10/2569
 *   "long"  → 21 ต.ค. 2569
 */
export function formatThaiDate(
  date: IsoDate | null | undefined,
  style: "short" | "long" = "short",
): string {
  if (!date || !isIsoDate(date)) return "";
  const [y, m, d] = parts(date);
  const be = y + BE_OFFSET;
  return style === "long"
    ? `${d} ${THAI_MONTHS_SHORT[m - 1]} ${be}`
    : `${pad2(d)}/${pad2(m)}/${be}`;
}
