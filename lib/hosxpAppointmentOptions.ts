import type mysql from "mysql2/promise";
import { hosxpDb } from "./db.ts";

// Use the same clinic/department/doctor keys as the existing oapp reader.
// Optional oapp columns are checked first because HOSxP versions differ.
export async function readAppointmentOptions(db = hosxpDb) {
  const [columns] = await db.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM oapp");
  const available = new Set(columns.map((r) => String(r.Field)));
  const names = async (sql: string) => {
    const [rows] = await db.query<mysql.RowDataPacket[]>(sql);
    return [...new Set(rows.map((r) => String(r.name ?? "").trim()).filter(Boolean))];
  };
  const recent = (column: "app_cause" | "contact_point") => available.has(column)
    ? names(`SELECT DISTINCT ${column} AS name FROM oapp WHERE nextdate >= CURDATE() - INTERVAL 1 YEAR AND ${column} IS NOT NULL ORDER BY name LIMIT 200`)
    : Promise.resolve([] as string[]);
  const [clinics, departments, doctors, purposes, contactPoints] = await Promise.all([
    names("SELECT name FROM clinic WHERE name IS NOT NULL ORDER BY name"),
    names("SELECT department AS name FROM kskdepartment WHERE department IS NOT NULL ORDER BY department"),
    names("SELECT name FROM doctor WHERE name IS NOT NULL ORDER BY name"),
    recent("app_cause"), recent("contact_point"),
  ]);
  return { clinics, departments, doctors, purposes, contactPoints };
}
