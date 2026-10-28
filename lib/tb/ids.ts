// lib/tb/ids.ts
// รหัสระบบ = ตัวอักษรนำ + 10 hex — คงรูปแบบเดิมของ Apps Script ("P" + 10 hex) เพื่อ import ตรง

import { randomBytes } from "node:crypto";

export type EntityPrefix = "P" | "C" | "V" | "A";

const ID_RE = /^[PCVA][0-9a-f]{10}$/;

export function newEntityId(prefix: EntityPrefix): string {
  return prefix + randomBytes(5).toString("hex");
}

export function isEntityId(v: unknown, prefix?: EntityPrefix): v is string {
  return typeof v === "string" && ID_RE.test(v) && (!prefix || v[0] === prefix);
}

/** เลขบัตรประชาชน 13 หลัก + check digit (mod 11) */
export function isValidCid(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{13}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(v[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(v[12]);
}
