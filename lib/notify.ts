// lib/notify.ts — LINE Official Account (broadcast) + อีเมล (SMTP)
// token/รหัสอยู่ใน env เท่านั้น (LINE_CHANNEL_ACCESS_TOKEN, SMTP_*) — ห้ามเก็บใน DB
import nodemailer, { type Transporter } from "nodemailer";

export const lineConfigured = () => !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
export const emailConfigured = () => !!process.env.SMTP_HOST;

/** ส่งถึงทุกคนที่เพิ่ม OA เป็นเพื่อน (ทีม TB + รพ.สต.) — LINE Notify ปิดบริการแล้ว */
export async function sendLine(text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN");
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LINE ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let transport: Transporter | null = null;

export async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  if (!emailConfigured()) throw new Error("ยังไม่ได้ตั้ง SMTP_HOST");
  if (!to.length) throw new Error("ไม่มีอีเมลผู้รับ");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, to: to.join(", "), subject, html });
}
