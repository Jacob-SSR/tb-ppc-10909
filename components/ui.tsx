"use client";
// ชุด UI พื้นฐาน — mobile-first ปุ่ม/ช่องกรอกใหญ่พอกดบนมือถือ (§6.6)
import { formatThaiDate } from "@/lib/tb/dates";
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "contact" | "plain";
const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90",
  ghost: "bg-white text-brand border border-brand hover:bg-mint",
  danger: "bg-white text-bad border border-bad hover:bg-bad-bg",
  contact: "bg-contact text-white hover:bg-contact/90",
  plain: "bg-transparent text-brand hover:bg-mint",
};

export function Button({
  variant = "primary", size = "md", className, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4",
        VARIANT[variant],
        className,
      )}
    />
  );
}

const fieldBase = "rounded-xl border border-line bg-white px-3 py-2.5 text-foreground outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 disabled:bg-background";
/** กำหนดความกว้างเองได้ผ่าน className (w-auto, w-20) ไม่งั้นเต็มช่อง */
const widthOf = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? "" : "w-full");

export function Field({ label, hint, wide, children }: { label: ReactNode; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm text-muted", wide && "sm:col-span-2 lg:col-span-3")}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs text-contact">{hint}</span>}
    </label>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  if (p.type === "date") return <DateInput {...p} />;
  return <input {...p} className={cx(fieldBase, widthOf(p.className), "read-only:bg-background", p.className)} />;
}

/** ช่องวันที่ของเบราว์เซอร์ + แสดงวันที่ พ.ศ. กำกับ (เก็บเป็น ค.ศ.) */
function DateInput(p: InputHTMLAttributes<HTMLInputElement>) {
  const v = typeof p.value === "string" ? p.value : "";
  return (
    <span className="flex flex-col gap-0.5">
      <input {...p} className={cx(fieldBase, widthOf(p.className), p.className)} />
      {v && <span className="text-xs text-brand-2">{formatThaiDate(v, "long")}</span>}
    </span>
  );
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={cx(fieldBase, "w-full resize-y", p.className)} />;
}

export function Select({ options, placeholder = "", ...p }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly (string | { value: string | number; label: string })[];
  placeholder?: string | false;
}) {
  const value = p.value === null || p.value === undefined ? "" : String(p.value);
  const known = options.some((o) => String(typeof o === "string" ? o : o.value) === value);
  return (
    <select {...p} value={value} className={cx(fieldBase, widthOf(p.className), p.className)}>
      {placeholder !== false && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === "string" ? o : String(o.value);
        return <option key={v} value={v}>{typeof o === "string" ? o : o.label}</option>;
      })}
      {/* ค่าเดิมจากระบบเก่าที่ไม่อยู่ในรายการ — แสดงไว้ไม่ให้หาย */}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  );
}

/** ช่องกรอกที่เลือกจากรายการหรือพิมพ์เองได้ (datalist แบบระบบเดิม) */
export function ComboInput({ options, listId, ...p }: InputHTMLAttributes<HTMLInputElement> & { options: readonly string[]; listId: string }) {
  return (
    <>
      <input {...p} list={listId} className={cx(fieldBase, widthOf(p.className), p.className)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}

type Tone = "ok" | "bad" | "warn" | "brand" | "contact" | "muted";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  bad: "bg-bad-bg text-bad",
  warn: "bg-warn-bg text-warn",
  brand: "bg-mint text-brand",
  contact: "bg-contact-bg text-contact",
  muted: "bg-[#eef0ef] text-muted",
};
export function Badge({ tone = "brand", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{children}</span>;
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx("rounded-2xl border border-line bg-card p-4", onClick && "cursor-pointer transition hover:border-brand-2", className)}
    >
      {children}
    </div>
  );
}

export function Section({ title, tone = "brand", children, className }: { title: ReactNode; tone?: "brand" | "contact"; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cx("mb-3 rounded-2xl border border-line p-3 sm:p-4", className)}>
      <legend className={cx("px-1.5 text-sm font-semibold", tone === "contact" ? "text-contact" : "text-brand")}>{title}</legend>
      {children}
    </fieldset>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide, scrollable }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; scrollable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cx("flex max-h-[95dvh] w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl", scrollable ? "sm:max-h-[calc(100dvh-3rem)]" : "sm:max-h-none", wide ? "sm:max-w-4xl" : "sm:max-w-2xl")}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="-mr-1 rounded-lg px-2 py-1 text-2xl leading-none text-muted hover:bg-background">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-muted">{children}</div>;
}

// ── toast ────────────────────────────────────────────────────────────────────
type ToastFn = (msg: string, tone?: "ok" | "bad") => void;
let pushToast: ToastFn = () => {};
export const toast: ToastFn = (m, t) => pushToast(m, t);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; tone: "ok" | "bad" }[]>([]);
  useEffect(() => {
    pushToast = (msg, tone = "ok") => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "bad" ? 5000 : 2800);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((i) => (
        <div key={i.id} className={cx("rounded-xl px-4 py-2.5 text-sm text-white shadow-lg", i.tone === "bad" ? "bg-bad" : "bg-foreground")}>{i.msg}</div>
      ))}
    </div>
  );
}

export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return <div className="py-10 text-center text-muted">{label}</div>;
}
