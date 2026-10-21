export async function register() {
  // รันเฉพาะฝั่ง server (ไม่ใช่ edge/browser)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    const { checkTbDb } = await import("@/lib/db");
    void checkTbDb();
    // งานเบื้องหลัง: sync Google Sheet, rebuild 02:00, แจ้งนัด 07:00 (ตัวเดียวด้วย leader election ผ่าน Redis)
    const { startWorker } = await import("@/lib/worker");
    startWorker();
  }
}
