# tb-ppc — ระบบทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย

Next.js (App Router) + MySQL 8.4 + Redis — แทน Apps Script + Google Sheets เดิม
รายละเอียดการออกแบบและการตัดสินใจทั้งหมดอยู่ใน [`CLAUDE.md`](CLAUDE.md)

> ⚠️ repo นี้ต้องเป็น **private** — ห้าม commit `.env*` (ยกเว้น `*.example`), ไฟล์ Excel/CSV หรือ backup

## โครงสร้าง

| path | หน้าที่ |
|---|---|
| `lib/tb/` | business logic ล้วน ไม่แตะ DB ย้ายจาก Code.gs/Index.html (ปีงบ/ไตรมาส, `toIso`, งานต้องติดตาม A–D, นัดหมาย, สรุปผู้สัมผัส, followup 12 ช่อง, เป้าหมาย, ตัวเลือกฟอร์ม, หัวคอลัมน์ Sheet เดิม) |
| `lib/db.ts` | `tbDb` (ppc_tb, utf8mb4, อ่าน/เขียน) และ `hosxpDb` (HOSxP, tis620, SELECT อย่างเดียว, pool 3) |
| `lib/redis.ts`, `lib/env.ts` | Redis client, ตรวจ env ตอน start (`instrumentation.ts`) |
| `docs/ppc_tb_schema.sql` | schema ฉบับเต็ม (ต้นฉบับของ `001_init.sql`) |
| `db/migrations/` | `001_init` (schema) + `002_app_grants` — `NNN_*.sql` เรียงเลข **ห้ามแก้ไฟล์ที่รันแล้ว** ให้เพิ่มไฟล์ใหม่ |
| `db/init/` | สร้างบัญชี `tb_app` / `tb_migrate` ตอน MySQL container เริ่มครั้งแรก |
| `scripts/migrate.ts` | migration runner (จำ checksum ใน `schema_migrations`) |
| `app/api/health` | healthcheck (MySQL + Redis) ไม่ต้อง login |
| `tests/tb/` | unit test ของ `lib/tb` · `tests/db/` integration test กับ MySQL จริง |

## บัญชี MySQL

| บัญชี | สิทธิ์ | ใช้ที่ |
|---|---|---|
| `root` | ทั้งหมด | ดูแลระบบเท่านั้น |
| `tb_migrate` | ALL บน `ppc_tb.*` + GRANT OPTION | `npm run migrate` / `docker compose run --rm migrate` |
| `tb_app` | SELECT, INSERT, UPDATE บน `ppc_tb.*` + DELETE บน `tb_settings` | แอป (ลบข้อมูล = soft delete `deleted_at`) |

## Deploy บน 192.168.200.58

```bash
cp .env.mysql.example .env.mysql        # ใส่รหัสผ่าน 3 ตัว (openssl rand -base64 24)
cp .env.example .env.production         # TB_DB_PASSWORD = TB_APP_PASSWORD, SESSION_SECRET, HOSXP_*
docker compose up -d --build            # app :3010, mysql/redis ไม่เปิด port ออก LAN
docker compose run --rm migrate         # สร้าง/อัปเดต schema
curl http://127.0.0.1:3010/api/health   # {"ok":true,"db":true,"redis":true}
```

- ข้อมูลอยู่ใน volume `tb_mysql` — **ห้าม `docker compose down -v`** บน production
- รหัสผ่านใน `.env.mysql` ใช้ตอนสร้าง volume ครั้งแรกเท่านั้น จะเปลี่ยนภายหลังต้อง `ALTER USER` ใน MySQL ด้วย
- `migrate` ขึ้น `Access denied for user 'tb_migrate'` = บัญชีไม่ถูกสร้าง: ดู `docker compose logs mysql | grep "\[init\]"` — บน Windows มักเกิดจาก `db/init/*.sh` เป็น CRLF (repo มี `.gitattributes` บังคับ LF แล้ว ถ้า clone ก่อนหน้านั้นให้ checkout ไฟล์ใหม่) จากนั้นตอนที่ยังไม่มีข้อมูลจริง `docker compose down -v` แล้วเริ่มใหม่
- Backup ทุกคืน + ขั้นตอน restore จะเพิ่มใน Phase 7

## พัฒนาบนเครื่อง

```bash
npm install
# MySQL ทดลอง (ข้อมูลทิ้งได้)
docker run -d --name tb-dev-mysql -p 127.0.0.1:3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root -e TB_APP_PASSWORD=app -e TB_MIGRATE_PASSWORD=mig \
  -v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" mysql:8.4 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
docker run -d --name tb-dev-redis -p 127.0.0.1:6379:6379 redis:7-alpine
cp .env.example .env.local   # TB_DB_PASSWORD=app, TB_MIGRATE_PASSWORD=mig, SESSION_SECRET=...
npm run migrate
npm run dev
```

## ทดสอบ

```bash
npm test            # unit test lib/tb (ไม่ต้องมี DB)
npm run test:db     # schema/สิทธิ์/constraint กับ MySQL ทดลอง (หลัง npm run migrate)
npm run typecheck
npm run lint
```
