# tb-ppc — ระบบทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย

Next.js (App Router) + MySQL 8.4 + Redis บน Docker Compose — แทน Apps Script + Google Sheets เดิม
รายละเอียดการออกแบบและการตัดสินใจทั้งหมดอยู่ใน [`CLAUDE.md`](CLAUDE.md) · ขั้นตอนเปลี่ยนระบบอยู่ใน [`docs/CUTOVER.md`](docs/CUTOVER.md)

> ⚠️ repo นี้ต้องเป็น **private** — ห้าม commit `.env*` (ยกเว้น `*.example`), ไฟล์ Excel/CSV หรือ backup

## ใช้งาน

| ผู้ใช้ | เห็น/ทำอะไรได้ |
|---|---|
| ทีม TB รพ.พลับพลาชัย (หน่วย admin) | ทุกอย่าง: แดชบอร์ด, ผู้ป่วย, ผู้สัมผัส, นัดหมาย, ต้องติดตาม, นำเข้า/ส่งออก Excel, ตั้งเป้าหมาย, ผู้ใช้ |
| รพ.สต. (หน่วย unit) | เฉพาะผู้สัมผัสในเขตตัวเอง: คีย์/แก้ผู้สัมผัส, บันทึกเยี่ยมบ้าน (แนบ GPS, เน็ตหลุดเก็บในเครื่องแล้วส่งเอง), นัดหมาย, ต้องติดตาม, ส่งออก |

บัญชีรายคน — admin สร้างที่แท็บ "ผู้ใช้" (ได้รหัสชั่วคราว ผู้ใช้ต้องเปลี่ยนตอนเข้าครั้งแรก) · ใส่รหัสผิด 5 ครั้งล็อก 15 นาที

## โครงสร้าง

| path | หน้าที่ |
|---|---|
| `app/` | หน้า (`/`, `/login`, `/change-password`) และ API (`app/api/*`) |
| `components/app/` | หน้าจอทะเบียน (client) — โหลดข้อมูลจาก `/api/data` ที่กรองสิทธิ์ที่ server แล้ว |
| `lib/tb/` | business logic ล้วน ย้ายจาก Code.gs/Index.html (ปีงบ/ไตรมาส, งานต้องติดตาม A–D, นัดหมาย, ตัวชี้วัด, หัวคอลัมน์ Sheet เดิม) — มี unit test |
| `lib/repo/` | อ่าน/เขียน MySQL: สิทธิ์ §3/§5.1, audit log, outbox, optimistic lock, นำเข้า |
| `lib/auth/`, `proxy.ts` | login, session, deny-by-default |
| `lib/worker/` | งานเบื้องหลัง: sync Google Sheet, rebuild 02:00, แจ้งนัด 07:00, เตือนคิวค้าง/backup ขาด |
| `docs/ppc_tb_schema.sql` | schema ฉบับเต็ม (ต้นฉบับของ `db/migrations/001_init.sql`) |
| `db/migrations/` | `NNN_*.sql` เรียงเลข **ห้ามแก้ไฟล์ที่รันแล้ว** ให้เพิ่มไฟล์ใหม่ |
| `db/grants.sql` | สิทธิ์ระดับตารางของ `tb_app` (migrate ใส่ซ้ำทุกครั้ง — กลับมาครบหลัง restore) |
| `db/init/` | สร้างบัญชี `tb_app` / `tb_migrate` ตอน MySQL เริ่มครั้งแรก |
| `db/backup/backup.sh` | backup ทุกคืน (service `backup`) |
| `scripts/` | `migrate.ts`, `create-admin.ts`, `import-from-sheet.ts` |
| `tests/` | `tb/` unit · `db/` กับ MySQL จริง · `e2e/` ผ่าน HTTP |

## บัญชี MySQL

| บัญชี | สิทธิ์ | ใช้ที่ |
|---|---|---|
| `root` | ทั้งหมด | ดูแลระบบ, backup/restore |
| `tb_migrate` | ALL บน `ppc_tb.*` + GRANT OPTION | `docker compose run --rm migrate` |
| `tb_app` | SELECT, INSERT, UPDATE บน `ppc_tb.*` + DELETE เฉพาะ `tb_settings`, `tb_targets` | แอป (ข้อมูลทะเบียนลบแบบ soft delete เท่านั้น) |

## ติดตั้งบน 192.168.200.58

ต้องมี Docker + Docker Compose และเครื่องที่ build ต้องต่อเน็ตได้ (npm, ฟอนต์ Google)

```bash
cd /opt && git clone https://github.com/Jacob-SSR/tb-ppc-10909.git tb-ppc && cd tb-ppc

# 1) รหัสผ่าน (สุ่มใหม่ทั้งหมด — ไม่ใช่รหัส HOSxP)
cp .env.mysql.example .env.mysql          # MYSQL_ROOT_PASSWORD, TB_APP_PASSWORD, TB_MIGRATE_PASSWORD
cp .env.example .env.production           # TB_DB_PASSWORD = TB_APP_PASSWORD, SESSION_SECRET, HOSXP_*, Google, LINE, SMTP
openssl rand -hex 24                       # ใช้สร้างรหัสแต่ละตัว (hex ไม่มีอักขระพิเศษ)
chmod 600 .env.mysql .env.production

# 2) ที่เก็บ backup นอกเครื่อง (เช่น NAS ที่ mount ไว้) — ไม่ตั้ง = ./backups
echo "BACKUP_DIR=/mnt/nas/tb-ppc-backup" > .env

# 3) ขึ้นระบบ
docker compose up -d mysql redis
docker compose run --rm migrate                                          # สร้างตาราง
docker compose run --rm cli node scripts/create-admin.ts jed "ชื่อ-สกุล"   # admin คนแรก (ได้รหัสชั่วคราว)
docker compose up -d --build                                             # app (:3010) + backup
curl http://127.0.0.1:3010/api/health                                    # {"ok":true,"db":true,"redis":true}
```

เปิด `http://192.168.200.58:3010` → login → เปลี่ยนรหัส → สร้างผู้ใช้คนอื่นที่แท็บ "ผู้ใช้"

- ข้อมูลอยู่ใน volume `tb_mysql` — **ห้าม `docker compose down -v`** หลังมีข้อมูลจริง
- รหัสใน `.env.mysql` มีผลตอนสร้าง volume ครั้งแรกเท่านั้น จะเปลี่ยนภายหลังต้อง `ALTER USER` ใน MySQL ด้วย
- อัปเดตโค้ด: `git pull && docker compose up -d --build && docker compose run --rm migrate`

### Google Sheet (สำเนาให้คนดู + ppc-hos tb-dashboard/tb-map)

1. สร้าง service account ใน Google Cloud (เปิด Google Sheets API) → ได้อีเมล + private key
2. แชร์ไฟล์ "Tuberculosis" ให้อีเมล service account เป็น **ผู้แก้ไข**
3. ใส่ `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (ใส่ `\n` แทนขึ้นบรรทัด), `TB_SPREADSHEET_ID` ใน `.env.production` แล้ว `docker compose up -d`

ระบบเขียนแท็บ `DB_Patients` / `DB_Contacts` / `DB_Visits` (หัวคอลัมน์เดิม) + `DB_Followups` ทุก 1 นาที, เขียนใหม่ทั้งหมดทุกคืน 02:00
และล็อกแท็บเหล่านี้ให้แก้ได้เฉพาะ service account (แก้ข้อมูลที่เว็บเท่านั้น) · ดูสถานะ/สั่งเขียนใหม่ได้ที่แท็บ "ตั้งเป้าหมาย"

### แจ้งเตือนนัดทุกเช้า 07:00

- LINE: `LINE_CHANNEL_ACCESS_TOKEN` ของ LINE Official Account (Messaging API) — broadcast ถึงทุกคนที่เพิ่ม OA เป็นเพื่อน
- อีเมล: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — ผู้รับตั้งที่แท็บ "ตั้งเป้าหมาย"
- ทดสอบได้จากปุ่ม "ส่งข้อความทดสอบ" ในแท็บ "ตั้งเป้าหมาย"
- LINE ยังใช้เตือน: คิว Sheet ค้าง > 1 ชม., backup ล่าสุดเก่ากว่า 26 ชม. (ตรวจ 09:00)

### HOSxP (ดึงชื่อ/อายุ/สิทธิ์/ที่อยู่ตาม HN ตอนลงทะเบียน)

`HOSXP_DB_HOST/PORT/NAME/USER/PASSWORD` — **บัญชีที่มีแค่ SELECT** · pool 3 connection · cache 1 ชม. · ทีม รพ. เท่านั้น
HOSxP ปิดอยู่ก็ยังคีย์ทะเบียนได้ (กรอกเอง)

## Backup และ restore (ทดสอบแล้ว)

service `backup` รัน `mysqldump --single-transaction` ทุกคืน 01:00 → `ppc_tb-YYYYMMDD-HHMM.sql.gz` + `.sha256` ใน `BACKUP_DIR` เก็บ 30 วัน
ตรวจไฟล์ทุกครั้ง (gzip -t + ต้องมีบรรทัด "Dump completed") · backup ทันที: `docker compose run --rm backup now`

**restore** (เช่น เครื่องเสีย / ย้ายเครื่อง):

```bash
docker compose stop app backup
docker compose down -v                    # ⚠️ ลบข้อมูลปัจจุบัน — ทำเฉพาะตอนจะ restore จริง
docker compose up -d mysql redis          # สร้าง MySQL ใหม่ + บัญชี (db/init)
until [ "$(docker inspect -f '{{.State.Health.Status}}' tb-ppc-mysql)" = healthy ]; do sleep 3; done
F=/mnt/nas/tb-ppc-backup/ppc_tb-YYYYMMDD-HHMM.sql.gz
(cd "$(dirname $F)" && sha256sum -c "$(basename $F).sha256")
gunzip -c $F | docker exec -i tb-ppc-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
docker compose run --rm migrate          # ใส่สิทธิ์ tb_app คืน + migration ที่ใหม่กว่า backup
docker compose up -d                     # แล้วกด "เขียน Sheet ใหม่ทั้งหมด" ในแท็บ ตั้งเป้าหมาย
```

ขั้นตอนนี้ทดสอบแล้วกับข้อมูลจริง 103 ราย: restore ลง MySQL ใหม่ → ทุกคอลัมน์ตรงต้นฉบับทุกแถว, สิทธิ์ `tb_app` กลับครบ

## เปิดใช้นอก รพ. (Cloudflare Tunnel — ทีหลัง)

1. Cloudflare Zero Trust → Networks → Tunnels → สร้าง tunnel แบบ Docker → คัดลอก token ลง `.env.tunnel` (`cp .env.tunnel.example .env.tunnel`)
2. Public hostname เช่น `tb.example.go.th` → Service `http://app:3000`
3. Access → Application → policy อนุญาตเฉพาะอีเมลทีม (≤ 50 คนใช้ฟรี) — ชั้นป้องกันก่อนถึงหน้า login
4. `.env.production` เพิ่ม `COOKIE_SECURE=1` และ `TRUST_CLOUDFLARE=1` แล้ว `docker compose --profile tunnel up -d`

## พัฒนาบนเครื่อง

```bash
npm install
docker run -d --name tb-dev-mysql -p 127.0.0.1:3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root -e TB_APP_PASSWORD=app -e TB_MIGRATE_PASSWORD=mig \
  -v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" mysql:8.4 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
docker run -d --name tb-dev-redis -p 127.0.0.1:6379:6379 redis:7-alpine
cp .env.example .env.local   # TB_DB_PASSWORD=app, TB_MIGRATE_PASSWORD=mig, SESSION_SECRET=(สุ่ม 32+ ตัว), WORKER=0
npm run migrate
node --env-file=.env.local scripts/create-admin.ts admin "ผู้ดูแล"
npm run dev
```

## ทดสอบ

```bash
npm test            # unit test lib/tb (ไม่ต้องมี DB)
npm run test:db     # schema/สิทธิ์/constraint/Sheet mirror กับ MySQL + Redis ทดลอง (หลัง npm run migrate)
npm run test:e2e    # ผ่าน HTTP กับแอปที่รันอยู่: BASE_URL=... ADMIN_USER=... ADMIN_TEMP_PASSWORD=...
npm run typecheck && npm run lint
```

## แก้ปัญหา

- **`migrate` ขึ้น Access denied for user 'tb_migrate'** — บัญชีไม่ถูกสร้าง: `docker compose logs mysql | grep "\[init\]"` ไม่เจอ = `db/init/*.sh` เป็น CRLF (checkout บน Windows ก่อนมี `.gitattributes`) หรือ volume ถูกสร้างก่อนใส่รหัสใน `.env.mysql` → ตอนที่ยังไม่มีข้อมูลจริง `docker compose down -v` แล้วเริ่มใหม่
- **ข้อมูลไม่ขึ้น Google Sheet** — แท็บ "ตั้งเป้าหมาย" → สถานะ Google Sheet (ข้อผิดพลาดล่าสุด) · ตรวจว่าแชร์ไฟล์ให้ service account แล้ว
- **ลืมรหัส admin คนเดียว** — `docker compose run --rm cli node scripts/create-admin.ts admin2 "ชื่อ"` แล้วใช้ admin2 reset ให้
- **IP ใน audit log**: เข้าตรงใน LAN ใช้ `x-forwarded-for` ซึ่ง client ปลอมได้ (การกันเดารหัสไม่อิง IP จึงไม่กระทบ) — ผ่าน Cloudflare (`TRUST_CLOUDFLARE=1`) เชื่อถือได้
