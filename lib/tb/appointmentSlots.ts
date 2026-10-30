export const APPT_PERIODS = ["เช้า", "บ่าย", "เย็น"] as const;
export type ApptPeriod = typeof APPT_PERIODS[number];
const clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function appointmentSlots(period: ApptPeriod) {
  const [start, end] = period === "เช้า" ? [480, 720] : period === "บ่าย" ? [720, 960] : [960, 1200];
  return Array.from({ length: (end - start) / 30 }, (_, i) => {
    const n = start + i * 30;
    return { start: clock(n), end: clock(n + 29), label: `${clock(n)} – ${clock(n + 29)} น.` };
  });
}
export function inAppointmentSlot(time: string | null | undefined, start: string, end: string) {
  const t = time?.slice(0, 5);
  return !!t && t >= start && t <= end;
}
export const APPT_INSTRUCTIONS = ["งดน้ำและอาหารก่อนตรวจ", "เก็บเสมหะตอนเช้า 2 ตลับ", "นำยาที่ใช้ประจำมาด้วย", "นำบัตรประชาชนมาด้วย"];
