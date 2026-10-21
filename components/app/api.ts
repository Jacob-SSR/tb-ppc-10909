// เรียก API ฝั่ง client — 401 กลับหน้า login, ต้องเปลี่ยนรหัส → หน้าเปลี่ยนรหัส
export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/** เน็ตหลุด/เซิร์ฟเวอร์ไม่ตอบ (ต่างจาก server ตอบ error) — ใช้ตัดสินว่าจะเก็บร่างไว้ในเครื่องไหม */
export class NetworkError extends Error {}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new NetworkError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสัญญาณอินเทอร์เน็ต");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // ใช้ full navigation (ไม่ใช่ router) เพื่อล้างข้อมูลที่โหลดไว้ทั้งหมด
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    throw new ApiError(401, "หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่");
  }
  if (res.status === 403 && data.mustChangePassword) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/change-password");
  }
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `เกิดข้อผิดพลาด (${res.status})`), data);
  return data as T;
}
