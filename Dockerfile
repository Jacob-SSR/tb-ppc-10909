# stage: deps → builder → runner (แอป) / tools (migrate, สร้าง admin, import)

FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- deps ----------
FROM base AS deps
# bcrypt มี prebuilt linux-x64 (glibc) มาในแพ็กเกจ ไม่ต้องลง python/g++ คอมไพล์เอง
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# ไม่ต้องมี .env ตอน build — env ทั้งหมดอ่านตอน runtime จาก env_file ของ compose
# ฟอนต์มาจาก npm (@fontsource) — ขั้น build ไม่ต้องต่อ Google Fonts
# ข้ามขั้นตรวจ TypeScript (ใช้ RAM มาก ค้างบนเครื่อง RAM น้อย) — ตรวจด้วย npm run typecheck ก่อน push แล้ว
ENV SKIP_TYPECHECK=1
RUN npm run build

# ---------- tools: migrate / create-admin / import (docker compose run --rm migrate | cli) ----------
FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY db ./db
COPY lib ./lib
COPY scripts ./scripts
USER node
CMD ["node", "scripts/migrate.ts"]

# ---------- runner (production) ----------
FROM base AS runner
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
