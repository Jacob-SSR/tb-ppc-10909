// Sheet mirror กับ MySQL จริง + Google Sheets ปลอม (ในหน่วยความจำ) — ข้อมูลสังเคราะห์
//   npm run test:db  (ต้องมี REDIS_URL ด้วย)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type mysql from "mysql2/promise";
import { closePools, tbDb } from "../../lib/db.ts";
import { redis } from "../../lib/redis.ts";
import { createPatient, deletePatient, updatePatient } from "../../lib/repo/patients.ts";
import { COLUMNS } from "../../lib/tb/sheetRows.ts";
import { patientInput } from "../../lib/validation.ts";
import { Mirror, MirrorBlocked, TABS } from "../../lib/worker/mirror.ts";
import { PROTECT_DESC, type SheetApi, type TabInfo } from "../../lib/worker/sheetApi.ts";

/** Google Sheets ปลอม: เก็บแต่ละแท็บเป็น string[][] (แถว 1 = index 0) */
class FakeSheets implements SheetApi {
  tabsData = new Map<string, { sheetId: number; rows: string[][]; rowCount: number; prot: { id: number; users: string[]; desc: string }[] }>();
  private protId = 1;
  fail = false;
  calls = 0;
  private parse(range: string) {
    const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?)?$/.exec(range)!;
    const col = (s?: string) => (s ? [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : undefined);
    return { tab: m[1].replace(/''/g, "'"), c1: col(m[2]) ?? 1, r1: Number(m[3] ?? 1), c2: col(m[4]), r2: m[5] ? Number(m[5]) : undefined };
  }
  private guard() {
    this.calls++;
    if (this.fail) throw new Error("Google API 503");
  }
  async tabs(): Promise<TabInfo[]> {
    this.guard();
    return [...this.tabsData].map(([title, t]) => ({
      title, sheetId: t.sheetId, rowCount: t.rowCount,
      protectedBy: t.prot.flatMap((p) => p.users), ourProtections: t.prot.filter((p) => p.desc === PROTECT_DESC).map((p) => p.id),
    }));
  }
  async get(range: string) {
    this.guard();
    const { tab, c1, r1, c2, r2 } = this.parse(range);
    const rows = this.tabsData.get(tab)?.rows ?? [];
    return rows.slice(r1 - 1, r2).map((r) => r.slice(c1 - 1, c2));
  }
  async write(data: { range: string; values: string[][] }[]) {
    this.guard();
    for (const d of data) {
      const { tab, c1, r1 } = this.parse(d.range);
      const t = this.tabsData.get(tab)!;
      d.values.forEach((vals, i) => {
        const row = (t.rows[r1 - 1 + i] ??= []);
        vals.forEach((v, j) => (row[c1 - 1 + j] = v));
      });
      for (let i = 0; i < t.rows.length; i++) t.rows[i] ??= [];
      assert.ok(t.rows.length <= t.rowCount, `เขียนเกินจำนวนแถวของแท็บ ${tab}`);
    }
  }
  async clear(range: string) {
    this.guard();
    const { tab, r1 } = this.parse(range);
    const t = this.tabsData.get(tab)!;
    t.rows = t.rows.slice(0, r1 - 1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ตัวปลอมของ Google API รับ request หลายรูปแบบ
  async batch(requests: Record<string, any>[]) {
    this.guard();
    for (const r of requests) {
      if (r.addSheet) this.tabsData.set(r.addSheet.properties.title, { sheetId: this.tabsData.size + 100, rows: [], rowCount: 1000, prot: [] });
      const byId = (id: number) => [...this.tabsData.values()].find((t) => t.sheetId === id)!;
      if (r.appendDimension) byId(r.appendDimension.sheetId).rowCount += r.appendDimension.length;
      if (r.deleteDimension) {
        const t = byId(r.deleteDimension.range.sheetId);
        t.rows.splice(r.deleteDimension.range.startIndex, r.deleteDimension.range.endIndex - r.deleteDimension.range.startIndex);
        t.rowCount--;
      }
      if (r.addProtectedRange) {
        const pr = r.addProtectedRange.protectedRange;
        byId(pr.range.sheetId).prot.push({ id: this.protId++, users: pr.editors.users, desc: pr.description });
      }
      if (r.deleteProtectedRange) for (const t of this.tabsData.values()) t.prot = t.prot.filter((p) => p.id !== r.deleteProtectedRange.protectedRangeId);
    }
  }
  data(kind: keyof typeof TABS) {
    return this.tabsData.get(TABS[kind])!.rows.slice(1).filter((r) => r.some(Boolean));
  }
}

const fake = new FakeSheets();
const mirror = new Mirror(fake, tbDb);
const admin = { id: null, role: "admin" as const, unitId: null };
const count = async (sql: string) => Number((await tbDb.query<mysql.RowDataPacket[]>(sql))[0][0].n);

before(async () => {
  for (const k of Object.values(TABS)) await redis.del(`tb:sheet:rows:${k}`);
  // ข้อมูลเก่าในระบบเดิมที่ไม่เกี่ยว ต้องไม่ถูกแตะ
  fake.tabsData.set("DB_Users", { sheetId: 1, rows: [["หน่วยบริการ", "PIN"]], rowCount: 1000, prot: [] });
});
after(async () => {
  await redis.quit();
  await closePools();
});

test("ensureTabs: สร้างแท็บ + หัวคอลัมน์เดิม, ล็อกเฉพาะเมื่อ SHEET_PROTECT และถอดล็อกได้", async () => {
  const sa = "sa@project.iam.gserviceaccount.com";
  await mirror.ensureTabs(sa, true);
  for (const [kind, tab] of Object.entries(TABS)) {
    assert.deepEqual(fake.tabsData.get(tab)!.rows[0], COLUMNS[kind as keyof typeof TABS].map(([h]) => h));
    assert.deepEqual(fake.tabsData.get(tab)!.prot.flatMap((p) => p.users), [sa]);
  }
  await mirror.ensureTabs(sa, true); // ซ้ำได้ ไม่ป้องกันซ้อน
  assert.equal(fake.tabsData.get("DB_Patients")!.prot.length, 1);
  // ล็อกที่คนอื่นใส่เองต้องไม่ถูกถอด
  fake.tabsData.get("DB_Patients")!.prot.push({ id: 999, users: ["owner@example.com"], desc: "ของเจ้าของไฟล์" });
  await mirror.ensureTabs(sa); // ค่าเริ่มต้น = ไม่ล็อก → ถอดเฉพาะที่ระบบใส่
  for (const tab of Object.values(TABS)) assert.ok(!fake.tabsData.get(tab)!.prot.some((p) => p.desc === PROTECT_DESC));
  assert.deepEqual(fake.tabsData.get("DB_Patients")!.prot.map((p) => p.id), [999]);
  assert.deepEqual(fake.tabsData.get("DB_Users")!.rows, [["หน่วยบริการ", "PIN"]]);
});

test("ตัวกัน: Sheet มีแถวที่ยังไม่อยู่ใน MySQL → ไม่ rebuild ไม่ส่งคิว และแถวเดิมอยู่ครบ", async () => {
  await redis.del("tb:sheet:safe");
  const tab = fake.tabsData.get("DB_Patients")!;
  const real = ["Pdeadbeef01", "2569", "1", "ผู้ป่วยจริงที่ยังไม่ได้ import"];
  tab.rows.push(real, ["", "", "", "พิมพ์เพิ่มเองไม่มี id"]);
  await assert.rejects(mirror.rebuild(), (e) => e instanceof MirrorBlocked && e.foreign.DB_Patients === 2);
  const input = patientInput.parse({ name: "คิวรอ import", hn: "G1", start_date: "2026-11-02" });
  await createPatient(tbDb, input, admin);
  const r = await mirror.processOutbox();
  assert.ok(r.blocked && r.sent === 0);
  assert.ok(await count("SELECT COUNT(*) n FROM tb_sheet_outbox WHERE sent_at IS NULL") > 0, "คิวต้องยังอยู่");
  assert.ok(tab.rows.some((x) => x[0] === real[0]), "แถวจริงต้องไม่หาย");
  tab.rows = tab.rows.filter((x) => x !== real && x[3] !== "พิมพ์เพิ่มเองไม่มี id");
});

test("rebuild: ทุกแท็บตรงกับ MySQL และปิดคิวที่ค้าง", async () => {
  const counts = await mirror.rebuild();
  assert.equal(counts.DB_Patients, await count("SELECT COUNT(*) n FROM tb_patients WHERE deleted_at IS NULL"));
  assert.equal(fake.data("patient").length, counts.DB_Patients);
  assert.equal(fake.data("contact").length, await count("SELECT COUNT(*) n FROM tb_contacts WHERE deleted_at IS NULL"));
  assert.equal(fake.data("followup").length, await count("SELECT COUNT(*) n FROM tb_treatment_followups f JOIN tb_patients p ON p.id=f.patient_id WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL"));
  assert.equal(await count("SELECT COUNT(*) n FROM tb_sheet_outbox WHERE sent_at IS NULL"), 0);
});

test("outbox: เพิ่ม → ต่อท้าย, แก้ → ทับแถวเดิม, ลบ → ลบแถว", async () => {
  const input = patientInput.parse({
    name: "Mirror ทดสอบ", hn: "M1", start_date: "2026-11-01", patient_type: "NEW",
    followups: [{ slot: 2, month_no: 2, test: "AFB", result: "NEG" }, { slot: 7, month_no: 8, test: "culture", result: "neg" }],
  });
  const { id } = await createPatient(tbDb, input, admin);
  const before = fake.data("patient").length;
  let r = await mirror.processOutbox();
  assert.ok(r.sent >= 2);
  assert.equal(fake.data("patient").length, before + 1);
  const row = () => fake.data("patient").find((x) => x[0] === id)!;
  const col = (h: string) => COLUMNS.patient.findIndex(([x]) => x === h);
  assert.equal(row()[col("ชื่อ-สกุล")], "Mirror ทดสอบ");
  assert.equal(row()[col("เดือน2 AFB")], "NEG");
  assert.deepEqual(fake.data("followup").filter((x) => x[0] === id).map((x) => x[1]), ["2", "7"]);

  // แก้ไข + ลบช่องติดตาม 7 → แถวเดิมถูกทับ, แถว followup 7 หายไป
  const rowIndex = fake.tabsData.get("DB_Patients")!.rows.findIndex((x) => x[0] === id);
  const v = await updatePatient(tbDb, id, undefined, { ...input, regimen: "2IRZE + 4IR", followups: [input.followups![0]] }, admin);
  r = await mirror.processOutbox();
  assert.equal(r.failed, 0);
  assert.equal(fake.tabsData.get("DB_Patients")!.rows.findIndex((x) => x[0] === id), rowIndex);
  assert.equal(row()[col("สูตรยา")], "2IRZE + 4IR");
  assert.deepEqual(fake.data("followup").filter((x) => x[0] === id).map((x) => x[1]), ["2"]);

  // ลบผู้ป่วย → แถวหายจาก DB_Patients และ DB_Followups, แถวอื่นยังอยู่ครบ
  const others = fake.data("patient").filter((x) => x[0] !== id).map((x) => x[0]);
  await deletePatient(tbDb, id, v.version, admin);
  await tbDb.query("INSERT INTO tb_sheet_outbox (entity, entity_id) VALUES ('followup', ?)", [id]);
  await mirror.processOutbox();
  assert.ok(!fake.data("patient").some((x) => x[0] === id));
  assert.ok(!fake.data("followup").some((x) => x[0] === id));
  assert.deepEqual(fake.data("patient").map((x) => x[0]), others);
});

test("Google ล่ม: คิวไม่หาย, attempts++ และเลื่อน next_try_at, กลับมาแล้วส่งได้", async () => {
  const { id } = await createPatient(tbDb, patientInput.parse({ name: "Mirror ล่ม", start_date: "2026-11-02" }), admin);
  fake.fail = true;
  const r = await mirror.processOutbox();
  assert.ok(r.failed >= 1);
  const [[q]] = await tbDb.query<mysql.RowDataPacket[]>(
    "SELECT attempts, last_error, next_try_at > NOW() AS later FROM tb_sheet_outbox WHERE entity_id = ? AND sent_at IS NULL", [id]);
  assert.equal(q.attempts, 1);
  assert.match(q.last_error, /503/);
  assert.equal(q.later, 1);
  fake.fail = false;
  await tbDb.query("UPDATE tb_sheet_outbox SET next_try_at = NOW() WHERE entity_id = ?", [id]); // จำลองเวลาผ่านไป
  assert.equal((await mirror.processOutbox()).failed, 0);
  assert.ok(fake.data("patient").some((x) => x[0] === id));
});

test("rebuild หลังจากมีการลบ: เลขแถวใน Redis ถูกสร้างใหม่ตรงกับ Sheet", async () => {
  await mirror.rebuild();
  const map = await mirror.rowMap("patient");
  for (const [id, n] of map) assert.equal(fake.tabsData.get("DB_Patients")!.rows[n - 1][0], id);
});
