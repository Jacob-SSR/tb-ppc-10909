import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // image เล็ก: Dockerfile copy เฉพาะ .next/standalone
  output: "standalone",
  // bcrypt เป็น native module ห้าม bundle
  serverExternalPackages: ["bcrypt"],
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
