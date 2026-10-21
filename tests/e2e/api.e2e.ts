// ทดสอบผ่าน HTTP กับแอปจริง (next start) + MySQL/Redis ทดลอง — ข้อมูลสังเคราะห์ทั้งหมด
//   BASE_URL=http://127.0.0.1:3100 ADMIN_USER=... ADMIN_TEMP_PASSWORD=... npm run test:e2e
// ต้องสร้าง admin ด้วย scripts/create-admin.ts ก่อน (รหัสชั่วคราว) — test จะเปลี่ยนรหัสให้เอง
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const ADMIN_TEMP = process.env.ADMIN_TEMP_PASSWORD ?? "";
const ADMIN_PW = "Tb-Plabpla-2569"; // ห้ามมีชื่อผู้ใช้อยู่ในรหัส

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown, redirect: RequestRedirect = "manual") {
    const res = await fetch(BASE + path, {
      method,
      redirect,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const v = /tb_session=([^;]*)/.exec(set)?.[1] ?? "";
      this.cookie = v ? `tb_session=${v}` : "";
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, location: res.headers.get("location") };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string) => this.req("DELETE", p);
  async login(username: string, password: string) {
    return this.post("/api/auth/login", { username, password });
  }
}

const admin = new Client();
const unit = new Client();
const other = new Client();
const tag = Date.now().toString(36);
let unitId = 0;
let otherUnitId = 0;
let patientId = "";
let patientVersion = 0;
let contactId = "";

before(async () => {
  const r = await admin.login(ADMIN_USER, ADMIN_TEMP);
  if (r.status !== 200) {
    // รันซ้ำ: เปลี่ยนรหัสไปแล้วในรอบก่อน
    const r2 = await admin.login(ADMIN_USER, ADMIN_PW);
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
  } else {
    assert.equal(r.json.mustChangePassword, true);
    const ch = await admin.post("/api/auth/password", { current: ADMIN_TEMP, next: ADMIN_PW });
    assert.equal(ch.status, 200, JSON.stringify(ch.json));
  }
});

test("proxy: deny-by-default", async () => {
  const anon = new Client();
  assert.equal((await anon.get("/api/data")).status, 401);
  assert.equal((await anon.get("/api/users")).status, 401);
  const page = await anon.get("/");
  assert.equal(page.status, 307);
  assert.match(page.location ?? "", /\/login$/);
  assert.equal((await anon.get("/api/health")).status, 200);
  assert.equal((await anon.get("/login")).status, 200);
  // cookie ปลอม
  anon.cookie = "tb_session=eyJ1aWQiOjEsInN2IjoxLCJtY3AiOmZhbHNlLCJleHAiOjk5OTk5OTk5OTl9.fake";
  assert.equal((await anon.get("/api/data")).status, 401);
});

test("admin สร้างผู้ใช้ unit; ต้องเปลี่ยนรหัสก่อนใช้งาน", async () => {
  const d = await admin.get("/api/data");
  assert.equal(d.status, 200);
  const units = d.json.units as { id: number; role: string }[];
  unitId = units.find((u) => u.role === "unit")!.id;
  otherUnitId = units.filter((u) => u.role === "unit")[1].id;

  const c = await admin.post("/api/users", { username: `pcu-${tag}`, displayName: "เจ้าหน้าที่ รพ.สต.", unitId });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const c2 = await admin.post("/api/users", { username: `pcu2-${tag}`, displayName: "หน่วยอื่น", unitId: otherUnitId });
  assert.equal((await admin.post("/api/users", { username: `pcu-${tag}`, displayName: "ซ้ำ", unitId })).status, 400);

  const l = await unit.login(`pcu-${tag}`, c.json.tempPassword as string);
  assert.equal(l.status, 200);
  assert.equal(l.json.mustChangePassword, true);
  // ยังไม่เปลี่ยนรหัส → ใช้ API ไม่ได้, หน้าเว็บพาไปเปลี่ยนรหัส
  assert.equal((await unit.get("/api/data")).status, 403);
  assert.match((await unit.get("/")).location ?? "", /\/change-password$/);
  assert.equal((await unit.post("/api/auth/password", { current: c.json.tempPassword, next: "12345678" })).status, 400); // ตัวเลขล้วน
  assert.equal((await unit.post("/api/auth/password", { current: c.json.tempPassword, next: "Unit-pass-2569" })).status, 200);
  assert.equal((await unit.get("/api/data")).status, 200);

  await other.login(`pcu2-${tag}`, c2.json.tempPassword as string);
  await other.post("/api/auth/password", { current: c2.json.tempPassword, next: "Other-pass-2569" });
});

test("ล็อกบัญชีเมื่อใส่รหัสผิด 5 ครั้ง แล้ว admin ปลดล็อกได้", async () => {
  const c = await admin.post("/api/users", { username: `lock-${tag}`, displayName: "ทดสอบล็อก", unitId });
  const x = new Client();
  for (let i = 0; i < 4; i++) assert.equal((await x.login(`lock-${tag}`, "wrong-pass")).status, 401);
  const fifth = await x.login(`lock-${tag}`, "wrong-pass");
  assert.match(String(fifth.json.error), /ล็อก/);
  // รหัสถูกก็เข้าไม่ได้ระหว่างล็อก
  assert.equal((await x.login(`lock-${tag}`, c.json.tempPassword as string)).status, 423);
  assert.equal((await admin.patch(`/api/users/${c.json.id}`, { unlock: true })).status, 200);
  assert.equal((await x.login(`lock-${tag}`, c.json.tempPassword as string)).status, 200);
  // ไม่บอกว่า username มีจริงไหม
  assert.equal((await x.login(`nobody-${tag}`, "wrong-pass")).json.error, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
});

test("ผู้ป่วย: admin เท่านั้น, ปีงบคำนวณเอง, followup, optimistic lock", async () => {
  const data = {
    name: `ผู้ป่วยทดสอบ ${tag}`, hn: tag.slice(-8), sex: "ชาย", age: "54", start_date: "2026-10-05", patient_type: "NEW",
    unit_id: unitId, outcome: "",
    followups: [
      { slot: 1, month_no: 2, test: "CXR", test_date: null, result: null, note: null }, // ช่องเริ่มต้นว่าง → ไม่สร้าง
      { slot: 2, month_no: 2, test: "AFB", test_date: "2026-12-05", result: "NEG", note: null },
      { slot: 6, month_no: 8, test: "culture", test_date: null, result: null, note: null }, // ช่องที่เพิ่มเอง
    ],
  };
  assert.equal((await unit.post("/api/patients", { data })).status, 403);
  assert.equal((await admin.post("/api/patients", { data: { ...data, start_date: null } })).status, 400);
  const c = await admin.post("/api/patients", { data });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  patientId = c.json.id as string;
  assert.match(patientId, /^P[0-9a-f]{10}$/);

  const d = await admin.get("/api/data");
  const p = (d.json.patients as Record<string, unknown>[]).find((x) => x.id === patientId)!;
  assert.equal(p.fy, 2570);
  assert.equal(p.outcome, "กำลังรักษา");
  assert.equal(p.age, 54);
  const fu = (d.json.followups as Record<string, unknown>[]).filter((f) => f.patient_id === patientId);
  assert.deepEqual(fu.map((f) => f.slot), [2, 6]);
  patientVersion = p.version as number;

  // แก้ไข: ลบช่อง 6, ใส่ผล AFB เดือน 5
  const upd = { ...data, followups: [data.followups[1], { slot: 3, month_no: 5, test: "AFB", test_date: "2027-03-05", result: "NEG", note: null }] };
  const u1 = await admin.put(`/api/patients/${patientId}`, { data: upd, version: patientVersion });
  assert.equal(u1.status, 200, JSON.stringify(u1.json));
  // ใช้ version เก่าซ้ำ → 409
  assert.equal((await admin.put(`/api/patients/${patientId}`, { data: upd, version: patientVersion })).status, 409);
  patientVersion = u1.json.version as number;
  const fu2 = ((await admin.get("/api/data")).json.followups as Record<string, unknown>[]).filter((f) => f.patient_id === patientId);
  assert.deepEqual(fu2.map((f) => f.slot), [2, 3]);
});

test("ผู้สัมผัส: unit เพิ่มได้เฉพาะหน่วยตัวเอง, หน่วยอื่นมองไม่เห็น (§3)", async () => {
  const base = { patient_id: patientId, name: `ผู้สัมผัส ${tag}`, contact_type: "household", phone: "0812345678", address: "1 หมู่ 2" };
  assert.equal((await unit.post("/api/contacts", { data: { ...base, unit_id: otherUnitId } })).status, 403);
  const c = await unit.post("/api/contacts", { data: base }); // ไม่ระบุหน่วย = หน่วยตัวเอง
  assert.equal(c.status, 201, JSON.stringify(c.json));
  contactId = c.json.id as string;

  const mine = await unit.get("/api/data");
  const contacts = mine.json.contacts as Record<string, unknown>[];
  assert.ok(contacts.every((x) => x.unit_id === unitId));
  assert.ok(contacts.some((x) => x.id === contactId));
  // ผู้ป่วย index เห็นเฉพาะช่องที่จำเป็น ไม่มี CID/ที่อยู่/LFT
  const p = (mine.json.patients as Record<string, unknown>[]).find((x) => x.id === patientId)!;
  assert.ok(p && !("cid" in p) && !("address" in p) && !("lft" in p));
  assert.deepEqual(mine.json.followups, []);
  assert.deepEqual(mine.json.settings, {});

  const theirs = await other.get("/api/data");
  assert.ok(!(theirs.json.contacts as Record<string, unknown>[]).some((x) => x.id === contactId));
  assert.ok(!(theirs.json.patients as Record<string, unknown>[]).some((x) => x.id === patientId));
  // หน่วยอื่นแก้/ดูประวัติไม่ได้
  assert.equal((await other.put(`/api/contacts/${contactId}`, { data: base })).status, 403);
  assert.equal((await other.get(`/api/history/${contactId}`)).status, 403);
  // unit ลบไม่ได้, ดูประวัติผู้ป่วยไม่ได้
  assert.equal((await unit.del(`/api/contacts/${contactId}`)).status, 403);
  assert.equal((await unit.get(`/api/history/${patientId}`)).status, 403);

  // §6.3 สรุปผู้สัมผัส
  const s = ((await admin.get("/api/data")).json.contactSummary as Record<string, { total: number; household: { total: number } }>)[patientId];
  assert.equal(s.total, 1);
  assert.equal(s.household.total, 1);
});

test("visit: unit บันทึกได้เฉพาะผู้สัมผัสในเขต, client_uuid กันซ้ำ, นัดต้องหลังวันที่", async () => {
  const uuid = randomUUID();
  const v = { contact_id: contactId, visit_date: "2026-10-21", visit_type: "เยี่ยมบ้าน/DOT", detail: "ซักอาการ ไม่ไอ", next_appt: "2026-11-21", client_uuid: uuid, lat: 14.6, lng: 103.1 };
  assert.equal((await unit.post("/api/visits", { ...v, next_appt: "2026-10-20" })).status, 400);
  const a = await unit.post("/api/visits", v);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const again = await unit.post("/api/visits", v); // เน็ตหลุดแล้วส่งซ้ำ
  assert.equal(again.status, 200);
  assert.equal(again.json.id, a.json.id);
  assert.equal(again.json.duplicate, true);
  assert.equal((await unit.post("/api/visits", { ...v, client_uuid: randomUUID(), contact_id: undefined, patient_id: patientId })).status, 403);
  assert.equal((await other.post("/api/visits", { ...v, client_uuid: randomUUID() })).status, 403);
  // หน่วยอื่นแก้ไม่ได้, admin แก้ได้
  assert.equal((await other.put(`/api/visits/${a.json.id}`, v)).status, 403);
  assert.equal((await admin.put(`/api/visits/${a.json.id}`, { ...v, detail: "แก้โดย admin" })).status, 200);
  const visits = (await unit.get("/api/data")).json.visits as Record<string, unknown>[];
  assert.equal(visits.filter((x) => x.contact_id === contactId).length, 1);
});

test("แปลงผู้สัมผัสป่วยเป็นผู้ป่วยใหม่ (admin, ครั้งเดียว)", async () => {
  assert.equal((await unit.post(`/api/contacts/${contactId}/convert`, { startDate: "2026-10-25" })).status, 403);
  const r = await admin.post(`/api/contacts/${contactId}/convert`, { startDate: "2026-10-25" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await admin.post(`/api/contacts/${contactId}/convert`, { startDate: "2026-10-25" })).status, 400);
  const d = await admin.get("/api/data");
  const c = (d.json.contacts as Record<string, unknown>[]).find((x) => x.id === contactId)!;
  assert.equal(c.new_patient_id, r.json.patientId);
  assert.equal(c.screen_result, "ป่วยเป็นวัณโรค");
  const np = (d.json.patients as Record<string, unknown>[]).find((x) => x.id === r.json.patientId)!;
  assert.equal(np.reg_place, "รพ.พลับพลาชัย");
  assert.equal(((d.json.contactSummary as Record<string, { tb: number }>)[patientId]).tb, 1);
  // ลบผู้ป่วย index ไม่ได้เพราะยังมีผู้สัมผัส
  assert.equal((await admin.del(`/api/patients/${patientId}`)).status, 400);
});

test("ประวัติการแก้ไข + เป้าหมาย", async () => {
  const h = await admin.get(`/api/history/${patientId}`);
  const actions = (h.json.rows as { action: string }[]).map((r) => r.action);
  assert.ok(actions.includes("add") && actions.includes("save"), actions.join(","));
  const hc = await unit.get(`/api/history/${contactId}`);
  assert.equal(hc.status, 200);
  assert.ok((hc.json.rows as unknown[]).length >= 2);

  assert.equal((await unit.put("/api/settings", { targets: [] })).status, 403);
  const count = async () => ((await admin.get("/api/data")).json.targets as { fy: number; quarter: number; indicator: string }[])
    .filter((x) => x.fy === 2599 && x.indicator === "case_finding").length;
  const t = [{ fy: 2599, quarter: 1, indicator: "case_finding", target: 15 }, { fy: 2599, quarter: 2, indicator: "case_finding", target: 20 }];
  assert.equal((await admin.put("/api/settings", { targets: t, reminder_emails: "a@x.com, a@x.com b@y.com" })).status, 200);
  assert.equal(await count(), 2);
  const d = await admin.get("/api/data");
  assert.equal((d.json.settings as Record<string, string>).reminder_emails, "a@x.com, b@y.com");
  // เว้นว่าง = ลบเป้า (กลับเป็น "ยังไม่ตั้งเป้า")
  assert.equal((await admin.put("/api/settings", { targets: t.map((x) => ({ ...x, target: null })) })).status, 200);
  assert.equal(await count(), 0);
  assert.equal((await admin.put("/api/settings", { reminder_emails: "not-an-email" })).status, 400);
});

test("ปิดบัญชี / reset รหัส → session เดิมใช้ไม่ได้ทันที", async () => {
  const users = (await admin.get("/api/users")).json.users as { id: number; username: string }[];
  const o = users.find((u) => u.username === `pcu2-${tag}`)!;
  assert.equal((await other.get("/api/data")).status, 200);
  assert.equal((await admin.patch(`/api/users/${o.id}`, { active: false })).status, 200);
  assert.equal((await other.get("/api/data")).status, 401);
  assert.equal((await other.login(`pcu2-${tag}`, "Other-pass-2569")).status, 403);
  // admin ปิดบัญชีตัวเองไม่ได้
  const me = (await admin.get("/api/auth/me")).json.id as number;
  assert.equal((await admin.patch(`/api/users/${me}`, { active: false })).status, 400);
});

test("logout", async () => {
  const x = new Client();
  await x.login(`pcu-${tag}`, "Unit-pass-2569");
  assert.equal((await x.get("/api/data")).status, 200);
  await x.post("/api/auth/logout");
  assert.equal((await x.get("/api/data")).status, 401);
});

test("Excel: ส่งออก + นำเข้า (dry run ไม่บันทึก, ช่องว่างไม่ลบค่าเดิม, แถวผิดถูกข้าม)", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { PATIENT_SHEET_COLUMNS } = await import("../../lib/tb/sheetColumns.ts");

  const ex = await fetch(`${BASE}/api/export?fy=2570`, { headers: { Cookie: admin.cookie } });
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get("content-type") ?? "", /spreadsheetml/);
  const wbOut = new ExcelJS.Workbook();
  await wbOut.xlsx.load(await ex.arrayBuffer());
  assert.deepEqual(wbOut.worksheets.map((w) => w.name), ["ผู้ป่วย", "ผู้สัมผัส", "ติดตามระหว่างรักษา"]);
  assert.equal(wbOut.worksheets[0].getRow(1).getCell(1).value, "รหัสระบบ");

  // unit ส่งออกได้แค่ผู้สัมผัส, นำเข้าไม่ได้
  const exUnit = await fetch(`${BASE}/api/export?fy=all`, { headers: { Cookie: unit.cookie } });
  const wbUnit = new ExcelJS.Workbook();
  await wbUnit.xlsx.load(await exUnit.arrayBuffer());
  assert.deepEqual(wbUnit.worksheets.map((w) => w.name), ["ผู้สัมผัส"]);

  const headers = PATIENT_SHEET_COLUMNS.map(([h]) => h);
  const row = (o: Record<string, string>) => headers.map((h) => o[h] ?? "");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ผู้ป่วย");
  ws.addRow(headers);
  ws.addRow(row({ "ชื่อ-สกุล": `นำเข้าใหม่ ${tag}`, "HN": `x${tag}`.slice(0, 12), "วันเริ่มยา": "15/11/2569", "ประเภทผู้ป่วย": "NEW", "เดือน2 AFB": "NEG", "รพ.สต.รับผิดชอบ": "รพ.สต.ตาพระ" }));
  ws.addRow(row({ "รหัสระบบ": patientId, "ชื่อ-สกุล": `ผู้ป่วยทดสอบ ${tag}`, "สูตรยา": "2IRZE + 4IR" })); // อัปเดตเฉพาะสูตรยา
  ws.addRow(row({ "ชื่อ-สกุล": "วันที่ผิด", "วันเริ่มยา": "31/02/2569" }));
  ws.addRow(row({ "ชื่อ-สกุล": "หน่วยผิด", "วันเริ่มยา": "01/12/2569", "รพ.สต.รับผิดชอบ": "รพ.สต.ไม่มีจริง" }));
  const file = new Blob([await wb.xlsx.writeBuffer()]);

  const send = async (c: Client, dry: boolean) => {
    const fd = new FormData();
    fd.set("file", file, "test.xlsx");
    fd.set("kind", "patient");
    fd.set("dry", dry ? "1" : "0");
    const r = await fetch(`${BASE}/api/import`, { method: "POST", body: fd, headers: { Cookie: c.cookie } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal((await send(unit, true)).status, 403);

  const before = ((await admin.get("/api/data")).json.patients as unknown[]).length;
  const dry = await send(admin, true);
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.added, 1);
  assert.equal(dry.json.updated, 1);
  assert.equal((dry.json.skipped as unknown[]).length, 2);
  assert.equal(((await admin.get("/api/data")).json.patients as unknown[]).length, before); // dry ไม่บันทึก

  const real = await send(admin, false);
  assert.equal(real.json.added, 1);
  const d = await admin.get("/api/data");
  const ps = d.json.patients as Record<string, unknown>[];
  assert.equal(ps.length, before + 1);
  const updated = ps.find((p) => p.id === patientId)!;
  assert.equal(updated.regimen, "2IRZE + 4IR");
  assert.equal(updated.sex, "ชาย"); // ช่องว่างในไฟล์ไม่ลบค่าเดิม
  assert.equal(updated.start_date, "2026-10-05");
  const fresh = ps.find((p) => p.name === `นำเข้าใหม่ ${tag}`)!;
  assert.equal(fresh.start_date, "2026-11-15");
  assert.equal(fresh.fy, 2570);
  const fu = (d.json.followups as Record<string, unknown>[]).filter((f) => f.patient_id === fresh.id);
  assert.deepEqual(fu.map((f) => [f.slot, f.result]), [[2, "NEG"]]);
  // แถวเดิมของผู้ป่วยที่อัปเดต: ช่องติดตามเดิมยังอยู่
  assert.equal((d.json.followups as Record<string, unknown>[]).filter((f) => f.patient_id === patientId).length, 2);
});
