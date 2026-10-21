"use client";
// ประวัติการแก้ไข (tb_audit_log) — "ช่อง: เดิม → ใหม่"
import { useEffect, useState } from "react";
import { Button, Empty, Modal, Spinner } from "@/components/ui";
import { COLUMNS } from "@/lib/tb/sheetRows";
import { api } from "./api";
import { useApp, type ModalState } from "./store";

interface Row {
  id: number;
  at: string;
  action: string;
  entity: string;
  changes: Record<string, [unknown, unknown]> | null;
  by_name: string | null;
  by_unit_name: string | null;
}

const LABELS = new Map<string, string>(
  [...COLUMNS.patient, ...COLUMNS.contact, ...COLUMNS.visit].map(([h, src]) => [src, h] as [string, string]),
);
LABELS.set("unit_id", "รพ.สต.รับผิดชอบ");
LABELS.set("fy", "ปีงบ");
LABELS.set("ref", "ผูกกับ");

const ACTION: Record<string, string> = {
  add: "เพิ่ม", save: "แก้ไข", delete: "ลบ", convert: "ลงทะเบียนเป็นผู้ป่วย", migrate: "ย้ายจากระบบเดิม",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(ว่าง)" : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));

export function History({ id, title, back }: { id: string; title: string; back?: ModalState }) {
  const { open, unitName } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ rows: Row[] }>("GET", `/api/history/${id}`).then((r) => setRows(r.rows)).catch((e) => setError(e.message));
  }, [id]);
  const done = () => open(back ?? null);

  return (
    <Modal open onClose={done} title="ประวัติการแก้ไข" subtitle={title} footer={<Button variant="ghost" onClick={done}>กลับ</Button>}>
      {error && <p className="text-bad">{error}</p>}
      {!rows && !error && <Spinner />}
      {rows && !rows.length && <Empty>ยังไม่มีประวัติ</Empty>}
      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
              <span>{r.at.slice(0, 16)} · {r.by_name ?? "ระบบ"}{r.by_unit_name ? ` (${r.by_unit_name})` : ""}</span>
              <span>{r.entity === "visit" ? "บันทึกรายครั้ง · " : ""}{ACTION[r.action] ?? r.action}</span>
            </div>
            <ul className="mt-1 space-y-0.5">
              {Object.entries(r.changes ?? {}).map(([k, [a, b]]) => {
                const label = LABELS.get(k) ?? k;
                const fmt = (v: unknown) => (k === "unit_id" && v ? unitName(Number(v)) : show(v));
                return <li key={k}><span className="text-muted">{label}:</span> {fmt(a)} → {fmt(b)}</li>;
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
