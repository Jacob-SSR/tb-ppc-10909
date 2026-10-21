// lib/errors.ts — error ที่ตอบกลับผู้ใช้ได้ (ไม่พึ่ง Next — ใช้ได้ทั้ง route handler และสคริปต์ CLI)
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const forbidden = (msg = "ไม่มีสิทธิ์ทำรายการนี้") => new HttpError(403, msg);
export const notFound = (msg = "ไม่พบข้อมูล") => new HttpError(404, msg);
/** optimistic lock: มีคนแก้ไปก่อนแล้ว */
export const conflict = (msg = "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ใหม่") => new HttpError(409, msg);
