"use client";
// กราฟ Chart.js (ชุดเดียวกับแดชบอร์ดระบบเดิม) — ห่อเป็น component ที่วาดใหม่เมื่อ config เปลี่ยน
import { Chart as ChartJS, registerables, type ChartConfiguration, type ChartType } from "chart.js";
import { useEffect, useRef } from "react";

ChartJS.register(...registerables);

/** สีชุดเดิมจาก Index.html */
export const COL = {
  teal: "#14b8a6", green: "#1d4d40", mint: "#5eead4", orange: "#f59e0b", burnt: "#c2571c", red: "#ef4444",
  purple: "#8b5cf6", pink: "#ec4899", blue: "#3b82f6", gray: "#94a3b8", cyan: "#06b6d4", lime: "#84cc16",
} as const;
export const PALETTE = [COL.teal, COL.orange, COL.purple, COL.blue, COL.pink, COL.lime, COL.cyan, COL.burnt, COL.red, COL.gray];
export const OUTCOME_COL: Record<string, string> = {
  หาย: COL.teal, รักษาครบ: COL.mint, กำลังรักษา: COL.orange, เสียชีวิต: COL.red,
  ล้มเหลว: COL.pink, ขาดยา: COL.purple, โอนออก: COL.blue, ประเมินไม่ได้: COL.gray,
};

export function ChartCanvas<T extends ChartType>({ config, height = 240 }: { config: ChartConfiguration<T>; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(config);

  useEffect(() => {
    if (!ref.current) return;
    const d = ChartJS.defaults;
    d.font.family = getComputedStyle(document.body).fontFamily;
    d.color = "#5d6b67";
    d.maintainAspectRatio = false; // สูงตาม container
    d.plugins.legend.display = false; // กราฟที่ต้องการ legend เปิดเองใน options
    d.plugins.tooltip.padding = 10;
    d.plugins.tooltip.cornerRadius = 8;
    const cfg = JSON.parse(key) as ChartConfiguration<T>;
    const chart = new ChartJS(ref.current, cfg);
    return () => chart.destroy();
  }, [key]);

  return (
    <div className="relative" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}
