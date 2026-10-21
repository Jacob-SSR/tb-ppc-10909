// GET /api/health — healthcheck ของ docker compose (ไม่ต้อง login)
import { connection } from "next/server";
import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection(); // ต้องเช็คตอน request จริง ห้าม prerender
  const health = await checkHealth();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
