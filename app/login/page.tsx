import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "เข้าสู่ระบบ · ทะเบียนวัณโรค รพ.พลับพลาชัย" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-[10vh]">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-brand">ทะเบียนวัณโรคและผู้สัมผัส</h1>
        <p className="mb-5 mt-1 text-sm text-muted">โรงพยาบาลพลับพลาชัย และ รพ.สต. ในเครือข่าย</p>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-5 text-xs text-muted">ลืมรหัสผ่าน หรือยังไม่มีบัญชี ติดต่อทีม TB รพ.พลับพลาชัย</p>
      </div>
    </main>
  );
}
