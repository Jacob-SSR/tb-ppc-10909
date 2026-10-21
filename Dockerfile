# syntax=docker/dockerfile:1
# stage: deps → builder → runner (แอป) / migrate (เครื่องมือรัน migration)

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
# เครื่องที่ build ต้องต่อเน็ตได้ (next/font/google โหลดฟอนต์ตอน build)
RUN npm run build

# ---------- migrate (docker compose run --rm migrate) ----------
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY db ./db
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
