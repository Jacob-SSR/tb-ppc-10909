import type { Metadata } from "next";
// ฟอนต์เดียวกับ ppc-hos: Prompt สำหรับหัวข้อ, Sarabun สำหรับเนื้อความ/ตาราง
// ใช้ไฟล์ฟอนต์จาก npm (@fontsource) แทน next/font/google — build ไม่ต้องต่อ Google Fonts
// (เครือข่าย รพ. บล็อก/ช้า ทำให้ docker build ล้ม) และ browser ไม่ต้องออกเน็ตไปโหลดฟอนต์
import "@fontsource/prompt/400.css";
import "@fontsource/prompt/500.css";
import "@fontsource/prompt/600.css";
import "@fontsource/prompt/700.css";
import "@fontsource/sarabun/400.css";
import "@fontsource/sarabun/500.css";
import "@fontsource/sarabun/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ทะเบียนวัณโรค รพ.พลับพลาชัย",
  description: "ระบบทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
