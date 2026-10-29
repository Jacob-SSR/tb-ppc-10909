import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // image เล็ก: Dockerfile copy เฉพาะ .next/standalone
  output: "standalone",
  // bcrypt เป็น native module ห้าม bundle
  serverExternalPackages: ["bcrypt"],
  // docker build ข้ามขั้น "Running TypeScript" (SKIP_TYPECHECK=1 ใน Dockerfile) — ใช้ RAM มาก
  // เครื่อง server RAM น้อยค้างเป็นชั่วโมง; ตรวจชนิดด้วย `npm run typecheck` ก่อน push แทน
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
