import type { Metadata } from "next";
import { Prompt, Sarabun } from "next/font/google";
import "./globals.css";

// ฟอนต์เดียวกับ ppc-hos: Prompt สำหรับหัวข้อ, Sarabun สำหรับเนื้อความ/ตาราง
const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ทะเบียนวัณโรค รพ.พลับพลาชัย",
  description: "ระบบทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${prompt.variable} ${sarabun.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
