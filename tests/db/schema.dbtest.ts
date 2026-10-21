// ทดสอบ schema กับ MySQL จริง — ใช้กับ DB ทดลองเท่านั้น (tb_app ลบแถวไม่ได้ ข้อมูลทดสอบจะค้างอยู่)
//   npm run test:db   (ต้องรัน `npm run migrate` ก่อน, ต้องตั้ง TB_DB_PASSWORD และ TB_MIGRATE_PASSWORD)
// ข้อมูลทดสอบสังเคราะห์ทั้งหมด

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { isTB, isTBSql, summarizeContacts, type ContactCountRow } from "../../lib/tb/contacts.ts";
import { TB_RESULT } from "../../lib/tb/constants.ts";
import { newEntityId } from "../../lib/tb/ids.ts";
import { contact } from "../tb/fixtures.ts";

const common = {
  host: process.env.TB_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TB_DB_PORT ?? 3306),
  database: process.env.TB_DB_NAME ?? "ppc_tb",
  charset: "utf8mb4_unicode_ci",
  dateStrings: true,
  decimalNumbers: true,
};

let app: mysql.Connection;
let mig: mysql.Connection;
let userId: number;
let unitId: number;

before(async () => {
  app = await mysql.createConnection({ ...common, user: "tb_app", password: process.env.TB_DB_PASSWORD });
  mig = await mysql.createConnection({ ...common, user: "tb_migrate", password: process.env.TB_MIGRATE_PASSWORD });
  const [[u]] = await app.query<mysql.RowDataPacket[]>("SELECT id FROM tb_units WHERE role = 'unit' ORDER BY id LIMIT 1");
  unitId = u.id;
  const [r] = await app.query<mysql.ResultSetHeader>("INSERT INTO tb_users SET ?", [{
    unit_id: unitId, username: `test_${Date.now()}`, display_name: "ผู้ทดสอบ", password_hash: "$2b$10$x",
  }]);
  userId = r.insertId;
});

after(async () => {
  await app?.end();
  await mig?.end();
});

async function rejectsCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: { code?: string }) => {
    assert.equal(err.code, code);
    return true;
  });
}

async function insertPatient(over: Record<string, unknown> = {}) {
  const row = { id: newEntityId("P"), fy: 2570, name: "ผู้ป่วย ทดสอบ", start_date: "2026-10-01", ...over };
  await app.query("INSERT INTO tb_patients SET ?", [row]);
  return row.id as string;
}

async function insertContact(patientId: string, over: Record<string, unknown> = {}) {
  const row = { id: newEntityId("C"), patient_id: patientId, name: "ผู้สัมผัส", contact_type: "household", unit_id: unitId, ...over };
  await app.query("INSERT INTO tb_contacts SET ?", [row]);
  return row.id as string;
}

test("migration ครบ + หน่วยบริการ 7 แห่ง", async () => {
  const [m] = await mig.query<mysql.RowDataPacket[]>("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(m.map((r) => r.version), ["001_init.sql", "002_app_grants.sql"]);
  const [u] = await app.query<mysql.RowDataPacket[]>("SELECT name, role FROM tb_units ORDER BY id");
  assert.equal(u.length, 7);
  assert.deepEqual(u[0], { name: "รพ.พลับพลาชัย", role: "admin" });
  assert.ok(u.slice(1).every((r) => r.role === "unit"));
});

test("ตารางเป็น utf8mb4 ทั้งหมด", async () => {
  const [rows] = await mig.query<mysql.RowDataPacket[]>(
    "SELECT table_name AS t, table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  for (const r of rows) assert.match(r.c, /^utf8mb4/, r.t);
});

test("สิทธิ์ tb_app: SELECT/INSERT/UPDATE ได้, DELETE เฉพาะ tb_settings, DDL ไม่ได้", async () => {
  const id = await insertPatient();
  const [upd] = await app.query<mysql.ResultSetHeader>("UPDATE tb_patients SET notes = 'x' WHERE id = ?", [id]);
  assert.equal(upd.affectedRows, 1);
  await rejectsCode(app.query("DELETE FROM tb_patients WHERE id = ?", [id]), "ER_TABLEACCESS_DENIED_ERROR");
  await rejectsCode(app.query("CREATE TABLE tb_x (id INT)"), "ER_TABLEACCESS_DENIED_ERROR");
  await rejectsCode(app.query("DROP TABLE tb_audit_log"), "ER_TABLEACCESS_DENIED_ERROR");
  await app.query("INSERT INTO tb_settings (k, v) VALUES ('test.key', 'ค่า') ON DUPLICATE KEY UPDATE v = VALUES(v)");
  const [del] = await app.query<mysql.ResultSetHeader>("DELETE FROM tb_settings WHERE k = 'test.key'");
  assert.equal(del.affectedRows, 1);
});

test("multipleStatements ปิด: ยิงหลายคำสั่งไม่ได้", async () => {
  await rejectsCode(app.query("SELECT 1; SELECT 2"), "ER_PARSE_ERROR");
});

test("ภาษาไทย utf8mb4 + DATE เป็นสตริง + outcome ตั้งต้น + optimistic lock", async () => {
  const id = await insertPatient({ name: "นางสาวทดสอบ ภาษาไทย 😀", diag_date: "2026-02-28" });
  const [[r]] = await app.query<mysql.RowDataPacket[]>("SELECT name, diag_date, outcome, version FROM tb_patients WHERE id = ?", [id]);
  assert.equal(r.name, "นางสาวทดสอบ ภาษาไทย 😀");
  assert.equal(r.diag_date, "2026-02-28");
  assert.equal(r.outcome, "กำลังรักษา");
  const q = "UPDATE tb_patients SET notes = ?, version = version + 1 WHERE id = ? AND version = ?";
  const [ok] = await app.query<mysql.ResultSetHeader>(q, ["a", id, 1]);
  const [stale] = await app.query<mysql.ResultSetHeader>(q, ["b", id, 1]);
  assert.equal(ok.affectedRows, 1);
  assert.equal(stale.affectedRows, 0); // มีคนแก้ไปก่อน → แอปต้องแจ้งให้โหลดใหม่
});

test("CHECK / ENUM / UNIQUE: CID, slot 1–12, ชนิดตรวจ, ประเภทผู้สัมผัส, visit ผูกได้อย่างเดียว, client_uuid", async () => {
  await rejectsCode(insertPatient({ cid: "12345" }), "ER_CHECK_CONSTRAINT_VIOLATED");
  await rejectsCode(insertPatient({ sex: "ไม่ระบุ" }), "WARN_DATA_TRUNCATED");

  const pid = await insertPatient();
  const fu = { patient_id: pid, month_no: 8, test: "AFB" };
  await app.query("INSERT INTO tb_treatment_followups SET ?", [{ ...fu, slot: 12 }]);
  await rejectsCode(app.query("INSERT INTO tb_treatment_followups SET ?", [{ ...fu, slot: 13 }]), "ER_CHECK_CONSTRAINT_VIOLATED");
  await rejectsCode(app.query("INSERT INTO tb_treatment_followups SET ?", [{ ...fu, slot: 12 }]), "ER_DUP_ENTRY");
  await rejectsCode(app.query("INSERT INTO tb_treatment_followups SET ?", [{ ...fu, slot: 6, test: "Sputum" }]), "WARN_DATA_TRUNCATED");

  const cid = await insertContact(pid, { contact_type: "close" });
  await rejectsCode(insertContact(pid, { contact_type: "ring1" }), "WARN_DATA_TRUNCATED");

  const v = { visit_date: "2026-10-21", visit_type: "เยี่ยมบ้าน/DOT", created_by: userId };
  await rejectsCode(app.query("INSERT INTO tb_visits SET ?", [{ ...v, id: newEntityId("V") }]), "ER_CHECK_CONSTRAINT_VIOLATED");
  await rejectsCode(
    app.query("INSERT INTO tb_visits SET ?", [{ ...v, id: newEntityId("V"), patient_id: pid, contact_id: cid }]),
    "ER_CHECK_CONSTRAINT_VIOLATED",
  );
  const uuid = crypto.randomUUID();
  await app.query("INSERT INTO tb_visits SET ?", [{ ...v, id: newEntityId("V"), contact_id: cid, client_uuid: uuid, lat: 14.123456, lng: 103.123456 }]);
  // ส่งซ้ำจากเครื่องที่เน็ตหลุด (client_uuid เดิม) → ไม่ได้แถวที่สอง
  await rejectsCode(app.query("INSERT INTO tb_visits SET ?", [{ ...v, id: newEntityId("V"), contact_id: cid, client_uuid: uuid }]), "ER_DUP_ENTRY");

  const t = { fy: 2570, indicator: "coverage", target: 88, unit: "percent" };
  await rejectsCode(app.query("INSERT INTO tb_targets SET ?", [{ ...t, quarter: 5 }]), "ER_CHECK_CONSTRAINT_VIOLATED");
  await app.query("INSERT INTO tb_targets SET ? ON DUPLICATE KEY UPDATE target = VALUES(target)", [{ ...t, quarter: 1 }]);
});

test("สรุปผู้สัมผัสด้วย GROUP BY + isTBSql ตรงกับ isTB() (§6.3)", async () => {
  const pid = await insertPatient();
  const newPid = await insertPatient({ name: "ผู้ป่วยใหม่จากผู้สัมผัส" });
  const cases = [
    contact({ contact_type: "household" }),
    contact({ contact_type: "household", screen_result: TB_RESULT }),
    contact({ contact_type: "household", new_patient_id: newPid }),
    contact({ contact_type: "household", fu18_result: ` ${TB_RESULT}` }),
    contact({ contact_type: "close", screen_result: "ไม่ป่วย" }),
    contact({ contact_type: "close", fu24_result: TB_RESULT }),
    contact({ contact_type: "close" }),
  ];
  for (const c of cases) {
    await insertContact(pid, {
      contact_type: c.contact_type, screen_result: c.screen_result, new_patient_id: c.new_patient_id,
      fu18_result: c.fu18_result, fu24_result: c.fu24_result,
    });
  }
  // แถวที่ลบแล้วต้องไม่ถูกนับ
  await insertContact(pid, { contact_type: "close", screen_result: TB_RESULT, deleted_at: "2026-10-21 10:00:00" });

  const [rows] = await app.query<mysql.RowDataPacket[]>(
    `SELECT c.patient_id, c.contact_type, COUNT(*) AS total, SUM(${isTBSql("c")}) AS tb
       FROM tb_contacts c
      WHERE c.deleted_at IS NULL AND c.patient_id = ?
      GROUP BY c.patient_id, c.contact_type`,
    [pid],
  );
  const s = summarizeContacts(rows as ContactCountRow[]).get(pid)!;
  const expectTb = (t: string) => cases.filter((c) => c.contact_type === t && isTB(c)).length;
  assert.deepEqual(s.household, { total: 4, tb: expectTb("household") });
  assert.deepEqual(s.close, { total: 3, tb: expectTb("close") });
  assert.equal(s.tb, 4);
});
