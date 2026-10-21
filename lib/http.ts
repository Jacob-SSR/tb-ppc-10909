// lib/http.ts — ตัวช่วยของ route handler: error เป็น JSON ภาษาไทย, อ่าน IP, parse body ด้วย zod
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";

export { badRequest, conflict, forbidden, HttpError, notFound } from "./errors.ts";
import { HttpError, badRequest } from "./errors.ts";

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** ห่อ handler: แปลง HttpError/ZodError เป็น JSON, error อื่นตอบ 500 แบบไม่หลุดรายละเอียด */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      // error ภายในของ Next (เช่น สัญญาณว่า route ต้อง render ตอน request เพราะเรียก cookies()) ต้องโยนต่อ
      unstable_rethrow(err);
      if (err instanceof HttpError) {
        return Response.json({ error: err.message, ...err.extra }, { status: err.status });
      }
      const mysqlMsg = mysqlErrorMessage(err);
      if (mysqlMsg) return Response.json({ error: mysqlMsg }, { status: 400 });
      if (err instanceof z.ZodError) {
        const first = err.issues[0];
        const field = first?.path.join(".");
        return Response.json(
          { error: `ข้อมูลไม่ถูกต้อง${field ? ` (${field})` : ""}: ${first?.message ?? ""}`, issues: err.issues },
          { status: 400 },
        );
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      if (DB_DOWN.has((err as { code?: string })?.code ?? "")) {
        return Response.json({ error: "เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาแจ้งผู้ดูแลระบบ" }, { status: 503 });
      }
      return Response.json({ error: "ระบบขัดข้อง กรุณาลองใหม่" }, { status: 500 });
    }
  };
}

/** ต่อฐานข้อมูลไม่ได้ (ตั้งค่าผิด / DB ล่ม) — ไม่ใช่ความผิดของผู้ใช้ */
const DB_DOWN = new Set(["ER_ACCESS_DENIED_ERROR", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST"]);

/** error ของ MySQL ที่เกิดจากข้อมูลผู้ใช้ (ไม่ใช่ระบบพัง) → ข้อความภาษาไทย */
function mysqlErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "ER_NO_REFERENCED_ROW_2": return "ข้อมูลอ้างอิงไม่ถูกต้อง (เช่น หน่วยบริการหรือผู้ป่วยไม่มีอยู่)";
    case "ER_DUP_ENTRY": return "ข้อมูลซ้ำกับที่มีอยู่แล้ว";
    case "ER_CHECK_CONSTRAINT_VIOLATED": return "ข้อมูลไม่ผ่านเงื่อนไขของระบบ";
    case "WARN_DATA_TRUNCATED":
    case "ER_TRUNCATED_WRONG_VALUE":
    case "ER_DATA_TOO_LONG": return "รูปแบบหรือความยาวข้อมูลไม่ถูกต้อง";
    default: return null;
  }
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  }
  return schema.parse(body);
}

/**
 * IP ผู้ใช้ (บันทึกใน audit + rate limit ราย IP)
 * - ผ่าน Cloudflare Tunnel (ตั้ง TRUST_CLOUDFLARE=1): cf-connecting-ip — Cloudflare เขียนทับเอง ปลอมไม่ได้
 * - เข้าตรงใน LAN: x-forwarded-for — Next ใส่ IP จริงให้เฉพาะเมื่อ client ไม่ได้ส่งมาเอง จึงปลอมได้
 *   (ไม่กระทบการกันเดารหัส: ล็อกราย username + จำกัดรวมทั้งระบบ ไม่อิง IP)
 */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const cf = process.env.TRUST_CLOUDFLARE === "1" ? h.get("cf-connecting-ip") : null;
  return cf ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
