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

## ติดตั้งบน server (192.168.200.58)

### Port ที่ใช้ (ไม่ชนกับ ppc-hos — เปลี่ยนได้ในไฟล์ `.env`)

| บริการ | Port บนเครื่อง | เปิดให้ใคร | ตั้งใน `.env` |
|---|---|---|---|
| เว็บแอป | **3010** | ทั้ง LAN | `TB_APP_PORT=3010` |
| MySQL | **3313** | เฉพาะในเครื่อง server (127.0.0.1) — ต่อจากเครื่องอื่นผ่าน SSH tunnel หรือ phpMyAdmin | `TB_MYSQL_PORT=3313` |
| phpMyAdmin | **9010** | ทั้ง LAN — **เปิดเฉพาะตอนใช้** | `PMA_PORT=9010` |
| Redis | – | ไม่เปิด (ใช้ภายใน docker) | |

ชื่อ container ขึ้นต้นด้วย `tb-ppc-` และ network `tb-ppc-net` จึงไม่ชนกับ stack ของ ppc-hos

### ขั้นตอน (Linux)

```bash
# 0) มี Docker แล้วหรือยัง — ต้องเห็นเลขเวอร์ชันทั้งสองบรรทัด
docker --version && docker compose version
#    ยังไม่มี: curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER  (แล้ว logout/login ใหม่)

# 1) เอาโค้ดลงเครื่อง (repo เป็น private — ใช้ GitHub token เป็นรหัสผ่าน)
cd /opt && sudo git clone -b claude/nifty-euler-jwytsx https://github.com/Jacob-SSR/tb-ppc-10909.git tb-ppc
sudo chown -R $USER: /opt/tb-ppc && cd /opt/tb-ppc

# 2) รหัสผ่าน (สุ่มใหม่ทั้งหมด — ไม่ใช่รหัส HOSxP) สร้างรหัสด้วย: openssl rand -hex 24
cp .env.mysql.example .env.mysql          # MYSQL_ROOT_PASSWORD, TB_APP_PASSWORD, TB_MIGRATE_PASSWORD
cp .env.example .env.production           # TB_DB_PASSWORD (= TB_APP_PASSWORD), SESSION_SECRET, HOSXP_*, GOOGLE_*, TB_SPREADSHEET_ID, LINE, SMTP
nano .env.mysql && nano .env.production
chmod 600 .env.mysql .env.production

# 3) port + ที่เก็บ backup (NAS ที่ mount ไว้ — ไม่ตั้ง = ./backups)
cat > .env <<'ENV'
TB_APP_PORT=3010
TB_MYSQL_PORT=3313
PMA_PORT=9010
BACKUP_DIR=/mnt/nas/tb-ppc-backup
ENV

# 4) ขึ้นระบบ
docker compose up -d mysql redis                                          # รอ ~30 วินาทีให้ mysql พร้อม
docker compose logs mysql | grep "\[init\]"                               # ต้องเห็นบรรทัดสร้างบัญชี tb_app / tb_migrate
docker compose run --rm migrate                                           # สร้างตาราง
docker compose run --rm cli node scripts/create-admin.ts admin "ผู้ดูแลระบบ" # admin คนแรก (ได้รหัสชั่วคราว)
docker compose up -d --build                                              # app + backup
curl http://127.0.0.1:3010/api/health                                     # ต้องได้ {"ok":true,"db":true,"redis":true}
```

เปิด `http://192.168.200.58:3010` → login → เปลี่ยนรหัส → ย้ายข้อมูลเดิมที่แท็บ "นำเข้า / ส่งออก" → สร้างผู้ใช้คนอื่นที่แท็บ "ผู้ใช้"

ถ้าเครื่อง server เปิด firewall (ufw) อยู่: `sudo ufw allow 3010/tcp` (และ `9010/tcp` ถ้าใช้ phpMyAdmin)

### phpMyAdmin (port 9010)

```bash
docker compose --profile pma up -d phpmyadmin     # เปิด → http://192.168.200.58:9010
docker compose stop phpmyadmin                    # ปิดเมื่อใช้เสร็จ
```

- Login ด้วย `tb_app` + `TB_APP_PASSWORD` สำหรับดู/แก้ข้อมูล (ลบแถวและแก้โครงสร้างตารางไม่ได้ — กันพลาด) · ใช้ `root` เฉพาะงานดูแลระบบ
- **อย่าแก้ข้อมูลผ่าน phpMyAdmin เป็นประจำ** — ไม่มีประวัติการแก้ไข (audit log) และไม่ส่งต่อไป Google Sheet; ถ้าแก้ไปแล้ว กด "เขียน Sheet ใหม่ทั้งหมดตอนนี้" ที่แท็บ "ตั้งเป้าหมาย"
- เปิดทิ้งไว้ = ใครใน LAN ก็เห็นหน้า login ของฐานข้อมูลผู้ป่วย จึงตั้งให้เปิดเฉพาะตอนใช้

### หมายเหตุ

- ข้อมูลอยู่ใน volume `tb_mysql` — **ห้าม `docker compose down -v`** หลังมีข้อมูลจริง
- รหัสใน `.env.mysql` มีผลตอนสร้าง volume ครั้งแรกเท่านั้น จะเปลี่ยนภายหลังต้อง `ALTER USER` ใน MySQL ด้วย
- อัปเดตโค้ด: `git pull && docker compose up -d --build && docker compose run --rm migrate`

### Google Sheet (สำเนาให้คนดู + ppc-hos tb-dashboard/tb-map)

1. สร้าง service account ใน Google Cloud (เปิด Google Sheets API) → ได้อีเมล + private key
2. แชร์ไฟล์ "Tuberculosis" ให้อีเมล service account เป็น **ผู้แก้ไข**
3. ใส่ `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (ใส่ `\n` แทนขึ้นบรรทัด), `TB_SPREADSHEET_ID` ใน `.env.production` แล้ว `docker compose up -d`

ระบบเขียนแท็บ `DB_Patients` / `DB_Contacts` / `DB_Visits` (หัวคอลัมน์เดิม) + `DB_Followups` ทุก 1 นาที, เขียนใหม่ทั้งหมดทุกคืน 02:00
· ดูสถานะ/สั่งเขียนใหม่ได้ที่แท็บ "ตั้งเป้าหมาย" · ไม่ล็อกแท็บ (ถ้าต้องการล็อกให้แก้ได้เฉพาะ service account ใส่ `SHEET_PROTECT=1`)

ล็อกค้างจากเวอร์ชันก่อน แล้วคนในทีมถอดเองไม่ได้ (ไม่ใช่เจ้าของไฟล์): `docker compose build cli && docker compose run --rm cli node scripts/sheet-unlock.ts`

**ตัวกันข้อมูลหาย**: ถ้าใน Sheet มีแถวที่ยังไม่อยู่ใน MySQL (ยังไม่ได้ import หรือมีคนพิมพ์เพิ่มใน Sheet) ระบบจะ**หยุดเขียน Sheet ทั้งหมด**
และแสดงเหตุผลที่แท็บ "ตั้งเป้าหมาย" (+ LINE) จนกว่าจะ import ข้อมูลนั้นเข้าระบบ หรือลบแถวนั้นออก — คิวที่ค้างจะส่งต่อเองหลังจากนั้น

### ย้ายข้อมูลจริงจาก Google Sheet เข้าระบบ (ครั้งแรก — รันซ้ำได้)

Sheet → ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx) → วางไว้ในโฟลเดอร์โปรเจกต์ชื่อ `Tuberculosis.xlsx` (`*.xlsx` อยู่ใน .gitignore ไม่หลุดขึ้น git)

```bash
docker compose build cli
# Git Bash บน Windows ต้องมี MSYS_NO_PATHCONV=1 และใช้ $(pwd -W) — บน Linux ใช้ $PWD
MSYS_NO_PATHCONV=1 docker compose run --rm -v "$(pwd -W)/Tuberculosis.xlsx:/import/tb.xlsx:ro" cli \
  node scripts/import-from-sheet.ts --xlsx /import/tb.xlsx --as admin --dry   # ดูรายงานก่อน (ไม่บันทึก)
# รายงานถูกต้อง → รันคำสั่งเดิมอีกครั้งโดยตัด --dry ออก แล้วลบไฟล์ .xlsx ทิ้ง
```

หรืออ่านจาก Sheet ตรงด้วย service account (ตั้ง `GOOGLE_*` + `TB_SPREADSHEET_ID` แล้ว): `docker compose run --rm cli node scripts/import-from-sheet.ts --as admin --dry`

### แจ้งเตือนนัดทุกเช้า 07:00

- LINE: `LINE_CHANNEL_ACCESS_TOKEN` ของ LINE Official Account (Messaging API) — broadcast ถึงทุกคนที่เพิ่ม OA เป็นเพื่อน
- อีเมล: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — ผู้รับตั้งที่แท็บ "ตั้งเป้าหมาย"
- ทดสอบได้จากปุ่ม "ส่งข้อความทดสอบ" ในแท็บ "ตั้งเป้าหมาย"
- LINE ยังใช้เตือน: คิว Sheet ค้าง > 1 ชม., backup ล่าสุดเก่ากว่า 26 ชม. (ตรวจ 09:00)

### HOSxP (ดึงชื่อ/อายุ/สิทธิ์/ที่อยู่ตาม HN ตอนลงทะเบียน)

`HOSXP_DB_HOST/PORT/NAME/USER/PASSWORD` — **บัญชีที่มีแค่ SELECT** · pool 3 connection · cache 1 ชม. · ทีม รพ. เท่านั้น
HOSxP ปิดอยู่ก็ยังคีย์ทะเบียนได้ (กรอกเอง)

นัดหมาย: **นัดคลินิก household / close contact ใน HOSxP ระบบดึงเข้าเองทุกชั่วโมง** (จับคู่ผู้สัมผัสด้วย HN หรือเลขบัตร, ไม่พบ = ผู้ป่วยตาม HN; ชื่อคลินิกตั้งได้ที่ `HOSXP_APPT_CLINICS`) · นัดคลินิกอื่น: หน้าผู้ป่วย/ผู้สัมผัส → "ดึงนัดจาก HOSxP" อ่านตาราง `oapp` (+ clinic / doctor / kskdepartment) ของ HN นั้น แล้วเลือกนัดที่จะเก็บสำเนาในระบบ
(ไม่เขียนกลับ HOSxP) · ทุกเช้า 06:00 ระบบอัปเดตนัดที่ดึงมาแล้ว: มี `visit_vn` = มาตามนัด, สถานะไม่ใช่ NULL/1 (`HOSXP_ACTIVE_STATUS_IDS`) หรือถูกลบ = ยกเลิก, วันเลื่อน = เลื่อนตาม

### แผนที่ (แท็บ "แผนที่" — ทีม รพ.)

หมุดผู้ป่วยตามพิกัดในทะเบียน (Latitude/Longitude ในฟอร์มผู้ป่วย) — ไม่มีพิกัด → จับคู่จากชีตประชากรใหม่ด้วยเลขบัตรก่อน แล้วค่อยชื่อ
ตั้ง `PIKAD_SPREADSHEET_ID=1UGeIm1DIAUxpb6pd9DN9uAy79qwGrsAHJUWer3w8ihg` ใน `.env.production` (แทน ID พิกัดบ้านเดิม) แล้ว `docker compose up -d --build` — แชร์ชีตใหม่ให้ service account สิทธิ์อ่านก่อน
อ่านแท็บแรก A:R ตามหัวคอลัมน์ `pname/fname/lname`, `cid`, `latitude/longitude`, `birthdate`, `age_y`, `sex`, `citizenship`, `death`, `address`, `home_phone`
แปลงเพศจาก `sex.csv` และสัญชาติจาก `nationality.csv` ที่นำมารวมไว้ใน `lib/residentCodes.json` โดยเทียบ `citizenship` กับ `nationality` (ไม่ใช้ `nhso_code`)
แสดง `death=Y` ว่าเสียชีวิต, `N` ว่ามีชีวิต, ค่าอื่น/ว่างว่าไม่ระบุสถานะชีวิต; ไม่กรองผู้เสียชีวิตออกอัตโนมัติ
เลือกผู้ป่วย → วง 1 ร่วมบ้าน (≤ 10 ม.) · วง 2 (≤ 50 ม.) · วง 3 (≤ 200 ม.) · ติ้ก **"ใครใกล้คนนี้บ้าง"** → รายชื่อคนรอบบ้านจาก Sheet พิกัดบ้าน
คลิกชื่อผู้ป่วยหรือคนรอบบ้าน / "ดูบนแผนที่" → เลื่อนไปยังหมุดในแผนที่เดิม พร้อมไฮไลต์และชื่อคนนั้น (มือถือเลื่อนกลับขึ้นไปที่แผนที่ให้) · "กลับบ้านผู้ป่วย" กลับศูนย์กลางวงเดิม
ปุ่ม **"เส้นทางจาก รพ.พลับพลาชัย"** ของผู้ป่วย และ **"เส้นทาง"** ของคนรอบบ้าน เปิด Google Maps ในแท็บใหม่ โดยต้นทางเป็นโรงพยาบาลพลับพลาชัย บุรีรัมย์ ปลายทางเป็นพิกัดบ้าน และเลือกเส้นทางขับรถตามถนน
เรียงใกล้ → ไกล พร้อมวงที่แนะนำ เพศ สัญชาติ สถานะชีวิต, บอกว่าเป็นผู้สัมผัส/ผู้ป่วยในทะเบียนแล้วหรือยัง, ปุ่ม **"+ บันทึกเป็นผู้สัมผัส"** เปิดฟอร์มกรอก ชื่อ เลขบัตร อายุ เพศ ที่อยู่ เบอร์โทร วง ประเภทให้ (สัญชาติ/สถานะเสียชีวิตอยู่ในบันทึก)
(Sheet มีเลขบัตร → อ่านฝั่ง server, cache Redis 30 นาที, ปุ่ม "อ่านใหม่" อ่านทันที) — แชร์ไฟล์ให้ service account (ผู้มีสิทธิ์อ่าน) ก่อน

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

ใช้ mysql/redis ตัวเดียวกับ compose — mysql เปิด 127.0.0.1:3313 อยู่แล้ว, redis เปิด 6380 ด้วย `docker-compose.dev.yml` (กันชนกับ MySQL ที่ติดตั้งบนเครื่อง เช่น XAMPP ที่ใช้ 3306)

```bash
npm install
cp .env.mysql.example .env.mysql   # ใส่รหัส 3 ตัว (ก่อนเปิด mysql ครั้งแรก)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql redis
cp .env.example .env.local
#   TB_DB_HOST=127.0.0.1  TB_DB_PORT=3313  TB_DB_PASSWORD=(= TB_APP_PASSWORD)
#   TB_MIGRATE_PASSWORD=(= ใน .env.mysql)  REDIS_URL=redis://127.0.0.1:6380
#   SESSION_SECRET=(สุ่ม 32+ ตัว)  WORKER=0
npm run migrate
node --env-file=.env.local scripts/create-admin.ts admin "ผู้ดูแล"
npm run dev
```

ตอน start แอปพิมพ์ `[db] ต่อ MySQL tb_app@host:port/ppc_tb ได้/ไม่ได้` พร้อมสาเหตุ — ถ้า error เป็น `'tb_app'@'localhost'` แปลว่าไปต่อ MySQL ที่ติดตั้งบนเครื่อง ไม่ใช่ตัวใน Docker (Docker จะเห็นเป็น `@'172.x.x.x'`)

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
