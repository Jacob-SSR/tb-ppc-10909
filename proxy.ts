// proxy.ts — DENY BY DEFAULT (CLAUDE.md §3 ข้อ 4)
// ทุกหน้า/ทุก API ต้อง login ยกเว้นรายการ PUBLIC เท่านั้น → route ใหม่ถูกล็อกอัตโนมัติ
// ที่นี่ตรวจแค่ลายเซ็น + วันหมดอายุของ cookie (ไม่แตะ DB)
// route handler ตรวจกับ DB อีกชั้น (บัญชีถูกปิด / session ถูกตัด) ผ่าน requireUser()
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, verifyToken } from "@/lib/auth/token";

const PUBLIC = ["/login", "/api/auth/login", "/api/health"];
// ยังต้องเปลี่ยนรหัสผ่าน → เข้าได้แค่หน้าเปลี่ยนรหัส + API ที่จำเป็น
const MUST_CHANGE_ALLOWED = ["/change-password", "/api/auth/password", "/api/auth/logout", "/api/auth/me"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

function deny(req: NextRequest, clearCookie: boolean): NextResponse {
  const { pathname, search } = req.nextUrl;
  let res: NextResponse;
  if (pathname.startsWith("/api/")) {
    res = NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  } else {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    res = NextResponse.redirect(url);
  }
  if (clearCookie) res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const token = verifyToken(raw);

  if (matches(pathname, PUBLIC)) {
    // login อยู่แล้วเปิดหน้า login → ไปหน้าหลัก
    if (pathname === "/login" && token) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (!token) return deny(req, !!raw);

  if (token.mcp && !matches(pathname, MUST_CHANGE_ALLOWED)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน", mustChangePassword: true }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/change-password", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // ทุก path ยกเว้นไฟล์ static ของ Next และไฟล์ใน public/
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest|txt)$).*)"],
};
