// GET /api/auth/me — ผู้ใช้ปัจจุบัน
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const u = await requireUser({ allowMustChange: true });
  return Response.json({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    unitId: u.unitId,
    unitName: u.unitName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  });
});
