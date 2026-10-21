"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) return setError("รหัสผ่านใหม่สองช่องไม่ตรงกัน");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return router.replace("/login");
      if (!res.ok) return setError(data.error ?? "เปลี่ยนรหัสผ่านไม่สำเร็จ");
      router.replace("/");
      router.refresh();
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return (
    <main className="flex flex-1 items-start justify-center px-4 py-[10vh]">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-brand">ตั้งรหัสผ่านใหม่</h1>
        <p className="mb-5 mt-1 text-sm text-muted">อย่างน้อย 8 ตัวอักษร ไม่ใช่ตัวเลขล้วน และไม่ใช้ร่วมกับคนอื่น</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="รหัสผ่านปัจจุบัน (หรือรหัสชั่วคราวจากผู้ดูแล)">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </Field>
          <Field label="รหัสผ่านใหม่">
            <Input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่">
            <Input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 w-full">{busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}</Button>
          <Button variant="plain" onClick={logout}>ออกจากระบบ</Button>
        </form>
      </div>
    </main>
  );
}
