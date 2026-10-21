export async function register() {
  // รันเฉพาะฝั่ง server (ไม่ใช่ edge/browser)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    // Phase 6: เริ่ม outbox worker (leader election ผ่าน Redis) ที่นี่
  }
}
