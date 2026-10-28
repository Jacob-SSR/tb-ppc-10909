@AGENTS.md

# tb-ppc-10909 — ระบบทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย

> **โปรเจกต์ใหม่** แยกจาก ppc-hos ทั้งหมด (repo, deploy, DB ของตัวเอง)
> ไฟล์คู่กัน: `docs/ppc_tb_schema.sql` (schema MySQL ฉบับเต็ม = `db/migrations/001_init.sql`)
> สถานะ: **Phase 1–7 เสร็จในโค้ดและทดสอบแล้ว** — เหลือติดตั้งจริงบน .58 + cutover ตาม `docs/CUTOVER.md` · สิ่งที่ตัดสินใจระหว่างทางอยู่ใน §12 · ถามก่อนถ้าเจอข้อที่อยู่ใน §11 "ยังต้องยืนยัน"

## 0. แหล่งอ้างอิง (อ่านอย่างเดียว ห้ามแก้)

| แหล่ง | ใช้ทำอะไร |
|---|---|
| `ppc-hos-10667` | ดู SQL ที่ query **ตาราง HOSxP จริง** (ชื่อตาราง/คอลัมน์, join, charset `tis620`), pattern การต่อ DB, Redis cache, leader election (`lib/cacheWarmer.ts`), Google Sheets client (`lib/sheets/client.ts`) |
| `rca` | ดู SQL ตาราง HOSxP จริงเพิ่มเติม |
| Apps Script เดิม `Code.gs` + `Index.html` | business logic, รายการตัวเลือก (`L`), ฟอร์ม (`P_FORM`/`C_FORM`), ฟิลด์ (`P_FIELDS`/`C_FIELDS`/`V_FIELDS`) — ย้ายมาแล้ว: logic → `lib/tb/*`, `L` → `lib/tb/options.ts`, ฟิลด์/หัวคอลัมน์ → `lib/tb/sheetColumns.ts`, กติกาสิทธิ์ → §5.1 (ไม่เก็บซอร์สเดิมใน repo เพราะมี PIN ใน `DEFAULT_UNITS`) |

ห้าม copy ข้อมูลผู้ป่วย, ไฟล์ Excel, `.env` หรือ PIN จากแหล่งเหล่านี้เข้า repo ใหม่

## 1. เป้าหมาย

แทนที่ Apps Script + Google Sheets ด้วยเว็บแอปที่:
- ทีม TB ของ รพ. และ รพ.สต. 6 แห่งคีย์ข้อมูลได้ รวมถึง **คีย์จากนอกพื้นที่ผ่านมือถือ** (ลงเยี่ยมบ้าน)
- เก็บข้อมูลหลักใน **MySQL** (เร็ว มี transaction มี validation)
- **ยังเขียนลง Google Sheet ด้วย** เพื่อให้คนที่ดู Sheet และ `tb-dashboard` / `tb-map` ใน ppc-hos ใช้ต่อได้

## 2. การตัดสินใจที่ตกลงแล้ว (ห้ามเปลี่ยนโดยไม่ถาม)

| เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|
| Stack | Next.js + TypeScript (App Router), `mysql2`, `ioredis`, `googleapis`, `zod`, `bcrypt` | ทีมใช้อยู่แล้วใน ppc-hos |
| Deploy | Docker Compose บน **192.168.200.58** เป็น stack แยกจาก ppc-hos (port / container name / network ไม่ชนกัน) | เครื่องที่ดูแลเองได้ |
| DB ระบบ TB | **MySQL 8 container ใหม่ใน compose ของโปรเจกต์นี้**, schema `ppc_tb`, `utf8mb4`, named volume + `mysqldump` ทุกคืนไปเก็บนอกเครื่อง .58 | แยกขาดจาก HOSxP ทั้งโหลด backup และรอบอัปเดต; ไม่ขึ้น cloud จนกว่าได้อนุมัติเรื่องข้อมูลผู้ป่วย |
| HOSxP | **อ่านอย่างเดียว** ด้วยบัญชี MySQL ที่มีแค่ SELECT, pool แยก `charset: "tis620"`, ห้ามสร้าง/เขียนตารางใน HOSxP | |
| การรวมข้อมูล HOSxP | join ในแอป (ดึงตาม HN/CID + cache Redis) แล้ว**เก็บสำเนา**ชื่อ/อายุ/สิทธิ์ไว้ใน `ppc_tb` ตอนบันทึก | SQL join ข้ามเครื่องไม่ได้; ทะเบียนต้องเปิดได้แม้ HOSxP ปิดปรับปรุง |
| Google Sheet | **MySQL → Sheet ทางเดียว** ผ่าน outbox, **ช้าได้แต่ต้องชัวร์** | ไม่ทำ two-way sync (ชนกัน / ลบแถวตรวจไม่ได้) |
| Login | บัญชีรายคน + bcrypt + ล็อกเมื่อผิดหลายครั้ง (แทน PIN รวมของหน่วย) | PIN 4 หลักเดาได้ และ log ไม่รู้ว่าใครแก้ |
| เปิดนอก รพ. | ทีหลัง ผ่าน Cloudflare Tunnel ชี้แอปบน .58 (ไม่ย้ายไป Vercel) | |

## 3. ความปลอดภัย (ปัญหาของระบบเดิมที่ต้องไม่เกิดซ้ำ)

1. PIN เก็บเป็นข้อความใน `DB_Users` และใน `DEFAULT_UNITS` ของโค้ด → เก็บ hash เท่านั้น
2. ไม่จำกัดการลอง login → `failed_logins` / `locked_until` + rate limit ที่ route login (Redis)
3. `getData` เดิมส่ง**ผู้ป่วยทุกราย**และ visit ของผู้ป่วยทุกรายให้ user ระดับ รพ.สต. → user `unit` เห็นเฉพาะ:
   - ผู้สัมผัสที่ `unit_id` = หน่วยตัวเอง
   - ผู้ป่วย index ของผู้สัมผัสเหล่านั้น เฉพาะช่องที่จำเป็น (ชื่อ, HN, วันเริ่มยา, ผลการรักษา)
   - กรองที่ SQL ฝั่ง server เสมอ ห้ามส่งทั้งหมดแล้วไปกรองที่ client
4. Middleware deny-by-default: ทุก route ต้อง login ยกเว้น `/login` และ health check
5. Repo ใหม่ควรเป็น **private**; `.gitignore` ต้องมี `.env*`, `*.xlsx`, `*.csv`, `backups/`
6. ทุกการเพิ่ม/แก้/ลบ เขียน `tb_audit_log` (ใคร เมื่อไร IP อะไร เปลี่ยนจากอะไรเป็นอะไร)

## 4. Data model (สรุป — ฉบับเต็มใน schema)

- `tb_units` หน่วยบริการ 7 แห่ง (`admin` = รพ.พลับพลาชัย, `unit` = รพ.สต.)
- `tb_users` ผู้ใช้รายคน ผูกหน่วย
- `tb_patients` ผู้ป่วย index — **คง id เดิมรูปแบบ `P` + 10 hex** เพื่อ import ตรง · มี `current_address` (migration 004) และ `amphoe`/`province`/`postcode` (migration 005) — ต่อท้าย DB_Patients ใน Sheet
- `tb_treatment_followups` ติดตามระหว่างรักษา หมวด 4 สูงสุด 12 ช่องต่อราย (§6.4)
- `tb_contacts` ผู้สัมผัส — `contact_type` = `household` | `close`, มี `current_address`, `tb_treat_place`
- `tb_visits` บันทึกรายครั้ง (FK ไป patient **หรือ** contact อย่างใดอย่างหนึ่ง), มี GPS + `client_uuid` กันส่งซ้ำ
- `tb_appointments` นัดหมาย (migration 006) — `status` scheduled/done/missed/cancelled, `source` manual/visit/hosxp, `visit_id` (นัดจาก next_appt), `hosxp_oapp_id` (สำเนานัดจาก HOSxP oapp ไม่ซ้ำ)
- `tb_targets` เป้าหมาย แยก `fy` + `quarter` (0 = ทั้งปี, 1–4) + `indicator`
- `tb_audit_log`, `tb_settings`, `tb_sheet_outbox`
- ตารางหลักมี `version` (optimistic lock: UPDATE … WHERE id=? AND version=?) และ `deleted_at` (soft delete)

DB pools ใน `lib/db.ts`:
- `tbDb` → MySQL ของโปรเจกต์ (`TB_DB_*`, `utf8mb4`, อ่าน/เขียน)
- `hosxpDb` → HOSxP (`HOSXP_DB_*`, `tis620`, บัญชี SELECT อย่างเดียว, `connectionLimit` ต่ำ เช่น 3)
- ทั้งคู่ `multipleStatements: false`, ใช้ parameterized query เท่านั้น

### 4.1 MySQL ใน Docker (เครื่อง .58 ยังไม่มี MySQL ต้องสร้างใหม่)

- service `mysql` ใน `docker-compose.yml` ของโปรเจกต์นี้: `image: mysql:8.4`, `TZ=Asia/Bangkok`, `--character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci`
- ข้อมูลอยู่ใน named volume `tb_mysql` — **ห้าม** `docker compose down -v` บน production
- **ไม่เปิด `ports:`** ออก LAN; แอปต่อผ่านชื่อ service `mysql:3306` ใน network ของ compose — เปิดเฉพาะ `127.0.0.1:3313` บนเครื่อง (`TB_MYSQL_PORT`) ให้ต่อจากเครื่อง server/SSH tunnel; phpMyAdmin port 9010 อยู่ใน profile `pma` เปิดเฉพาะตอนใช้ (Jed ขอ 26 ต.ค. 2569)
- จำกัดหน่วยความจำ (`--innodb-buffer-pool-size=256M` + `mem_limit`) เพื่อไม่แย่ง RAM กับ ppc-hos บนเครื่องเดียวกัน
- `docker-entrypoint-initdb.d/` ใช้**เฉพาะสร้างบัญชี** `tb_app` (สคริปต์ `.sh` อ่านรหัสจาก env) สิทธิ์ `SELECT, INSERT, UPDATE` บน `ppc_tb.*` + `DELETE` บน `tb_settings` — ห้ามใช้ `MYSQL_USER`/`MYSQL_PASSWORD` (ได้สิทธิ์ ALL)
- Schema สร้างด้วย **migration** ตั้งแต่วันแรก: `db/migrations/001_init.sql` (= `ppc_tb_schema.sql` ตัดส่วน CREATE USER ท้ายไฟล์ออก; GRANT DELETE ของ `tb_app` อยู่ใน `002_app_grants.sql`), ไฟล์ถัดไปเรียงเลข, ตาราง `schema_migrations` จำว่ารันอะไรแล้ว, รันด้วย `npm run migrate` ด้วยบัญชี migrate แยก (มีสิทธิ์ DDL) — ไม่แก้ไฟล์ migration ที่รันไปแล้ว
- Backup: service/cron รัน `mysqldump --single-transaction` ทุกคืน → บีบอัด → ส่งออกนอกเครื่อง .58, เก็บย้อนหลัง ≥ 30 วัน, มีขั้นตอน restore ที่ทดสอบแล้วใน README

## 5. Business logic ที่ต้องคงไว้จากระบบเดิม

ย้ายจาก `Index.html` / `Code.gs` มาเป็น TypeScript ใน `lib/tb/` เป็นฟังก์ชันล้วน (ไม่แตะ DB) พร้อม unit test:
- `fyOf(date)` ปีงบ พ.ศ. — ต.ค. ขึ้นปีงบใหม่: `year + 543 + (month >= 10 ? 1 : 0)`
- `quarterOf(date)` Q1 = ต.ค.–ธ.ค., Q2 = ม.ค.–มี.ค., Q3 = เม.ย.–มิ.ย., Q4 = ก.ค.–ก.ย.
- `contactTasks(contact)` ขั้น A สอบสวนภายใน 7 วันหลังผู้ป่วยเริ่มยา → B คัดกรองภายใน 14 วัน → C TPT (นัดรายเดือนตามสูตร) → D ติดตามครบ 2 ปี (ร่วมบ้าน 6/12/18/24 ด., ใกล้ชิด 12/24 ด.)
- `patientTasks(patient)` ยังไม่มีผู้สัมผัส, AFB เดือน 2/5/6 (อ่านจาก `tb_treatment_followups`), สรุปผล
- `isTB(contact)` มี `new_patient_id` หรือผลคัดกรอง/ติดตามใดๆ = "ป่วยเป็นวัณโรค"
- `convertContactToPatient` ผู้สัมผัสป่วย → สร้างผู้ป่วยใหม่ แล้วผูก `new_patient_id` (transaction เดียว)
- `toIso()` รับ dd/mm/yyyy ทั้ง พ.ศ./ค.ศ., Excel serial, ISO
- แจ้งเตือนนัดทุกเช้า 07:00 (อีเมล + LINE OA broadcast) — LINE token อยู่ใน env ไม่ใช่ DB
- นำเข้า/ส่งออก Excel (admin เท่านั้น) ผ่าน validation และ audit log เหมือนการคีย์ปกติ
- แสดงวันที่เป็น พ.ศ., เก็บเป็น ค.ศ. (`DATE`)

### 5.1 กติกาจาก Code.gs ที่ API (Phase 3) ต้องคงไว้

- **admin เท่านั้น**: เพิ่ม/แก้/ลบผู้ป่วย, แปลงผู้สัมผัสเป็นผู้ป่วย, ลบผู้สัมผัส/บันทึก visit, นำเข้า Excel, ตั้งเป้าหมาย/ค่าตั้ง
- **user `unit`**: เพิ่ม/แก้ผู้สัมผัสได้เฉพาะ `unit_id` ของหน่วยตัวเอง (ไม่ระบุ = หน่วยตัวเอง, ระบุเป็นหน่วยอื่นไม่ได้); บันทึก visit ได้เฉพาะผู้สัมผัสในเขต (ของผู้ป่วยไม่ได้); แก้ visit ได้เฉพาะที่หน่วยตัวเองบันทึก
- ลบผู้ป่วยไม่ได้ถ้ายังมีผู้สัมผัส ("กรุณาลบผู้สัมผัสก่อน"); แปลงผู้สัมผัสซ้ำไม่ได้ ("ลงทะเบียนเป็นผู้ป่วยแล้ว")
- บันทึกผู้ป่วย: `fy` คำนวณจากวันเริ่มยา (ไม่มีใช้วันวินิจฉัย); ต้องมีชื่อ และวันเริ่มยาหรือวันวินิจฉัย
- visit: ต้องมีวันที่ + รายละเอียด, วันนัดต้องหลังวันที่บันทึก; นัดค้าง = `tb_appointments.status = scheduled` (next_appt ของบันทึก → สร้างนัดให้, บันทึกใหม่ → นัดที่ถึงวันแล้ว = มาตามนัด — `lib/repo/appointments.ts`), ไม่แสดงนัดของผู้ป่วยที่สรุปผลแล้ว
- ประวัติการแก้ไข: user `unit` เห็นประวัติของผู้สัมผัสเฉพาะรายการที่หน่วยตัวเองทำ (+ `migrate`), เก็บรายการช่องที่เปลี่ยน "เดิม → ใหม่"
- นำเข้า Excel: แม็ปตามหัวคอลัมน์ไทย; จับคู่ผู้ป่วยด้วย id หรือ (ปีงบ + HN), ผู้สัมผัสด้วย id หรือ (ผู้ป่วย index + ชื่อ) โดยหาผู้ป่วย index จาก id หรือ (HN index + ปีงบ); **ช่องว่างในไฟล์ไม่ลบค่าเดิม**; รายงาน เพิ่ม/อัปเดต/ข้าม + เหตุผลรายแถว
- แจ้งเตือน 07:00: กลุ่ม ขาดนัด / วันนี้ / พรุ่งนี้; LINE broadcast แสดงไม่เกิน 15 รายต่อกลุ่ม ข้อความ ≤ 4,900 ตัวอักษร; อีเมลถึง `reminder_emails` ใน `tb_settings`; ไม่มีนัดเลย = ไม่ส่ง
- ตัวชี้วัดเดิมบน dashboard (`lib/tb/targets.ts`): Treatment Coverage = (NEW + Relapse) ÷ เป้าจำนวนผู้ป่วยของจังหวัด (`target_cases_<ปีงบ>`), Success Rate = (หาย + รักษาครบ) ÷ ผู้ที่สรุปผลแล้ว (ทั้งปีงบ ไม่ใช่ cohort), เป้า default 88%

## 6. ความต้องการใหม่จากเจ้าของงาน

### 6.1 เป้าหมายตั้งเองได้ + แยกไตรมาส
- หน้า "ตั้งเป้าหมาย" (admin): ตั้งเป้าแต่ละตัวชี้วัด **ทั้งปีงบ และ Q1/Q2/Q3/Q4**
- Dashboard มีตัวเลือกช่วงเวลา `ทั้งปีงบ | Q1 | Q2 | Q3 | Q4`
- การ์ดตัวชี้วัดแสดง **A/B** = ผลงาน / เป้าหมาย + % + แถบ progress พร้อมเส้นเป้า
- ไตรมาสที่ยังไม่ตั้งเป้า → แสดง "ยังไม่ตั้งเป้า" ห้ามแสดง 0%

### 6.2 ตัดส่วน "เส้นทางผู้สัมผัส" ออกจาก Dashboard
ไม่ต้องมีการ์ดชุดนี้ในหน้า dashboard (ข้อมูลยังเก็บและใช้ในแท็บผู้สัมผัส / ต้องติดตาม):
ผู้สัมผัสที่ระบุได้ (ร่วมบ้าน · ใกล้ชิด), ผู้ป่วยยังไม่มีผู้สัมผัส, A สอบสวนภายใน 7 วัน, B คัดกรองแล้ว (+CXR), พบป่วยวัณโรค (yield), C เริ่ม TPT / เข้าเกณฑ์ (+กินครบ), D ติดตามครบ 2 ปี, เกินกำหนด

### 6.3 สรุปผู้สัมผัสในหน้าผู้ป่วย
ในรายการผู้ป่วยและหน้ารายละเอียดผู้ป่วย แสดง:
- จำนวนผู้สัมผัส แยก **ร่วมบ้าน (household)** / **ใกล้ชิด (close)**
- จำนวนที่ **ป่วยเป็น TB** แยกตามกลุ่มเดียวกัน
- รายชื่อผู้สัมผัสที่ป่วย TB พร้อม **สถานที่รักษา**
  - ลงทะเบียนในระบบเรา (`new_patient_id`) → `reg_place` ของผู้ป่วยรายนั้น + ลิงก์ไปหน้าผู้ป่วย
  - รักษาที่อื่น → `tb_contacts.tb_treat_place` (ฟอร์มแสดงช่องนี้เมื่อผลเป็น "ป่วยเป็นวัณโรค")

ตัวอย่าง: `ผู้สัมผัส 5 · ร่วมบ้าน 3 (TB 1) · ใกล้ชิด 2 (TB 0)`
ใช้ query รวมครั้งเดียว (`GROUP BY patient_id, contact_type`) ห้าม N+1

### 6.4 ติดตามระหว่างรักษา (หมวด 4) ขยายได้ถึง 12 ช่อง
- ค่าเริ่มต้น 5 ช่อง: เดือน 2 CXR, เดือน 2 AFB, เดือน 5 AFB, เดือน 6 CXR, เดือน 6 AFB
- ปุ่ม **"+ เพิ่มเติม"** เพิ่มแถว (เดือนที่, ชนิดตรวจ, วันที่, ผล) รวมสูงสุด **12 ช่อง** ครบแล้วซ่อนปุ่ม
- เก็บใน `tb_treatment_followups` (`slot` 1–12)

### 6.5 ผู้สัมผัส: เบอร์โทร + ที่อยู่ปัจจุบัน
- แสดง **เบอร์โทร** ในฟอร์ม การ์ด และรายการ (กดโทรได้บนมือถือ `tel:`)
- เพิ่ม **ที่อยู่ปัจจุบัน** แยกจากที่อยู่ตามทะเบียน + ปุ่ม "เหมือนที่อยู่ตามทะเบียน"
- คลินิกติดตามเฉพาะ **household** และ **close contact** → dropdown มีแค่ 2 ค่า

### 6.6 ใช้งานนอกพื้นที่ (มือถือ)
- mobile-first ปุ่มใหญ่ ฟอร์มสั้น user `unit` เลือกผู้สัมผัสจากรายชื่อในเขตตัวเอง ไม่ต้องพิมพ์ HN
- เก็บร่างในเครื่อง (IndexedDB) ถ้าเน็ตหลุดตอนกดบันทึก แล้วส่งใหม่อัตโนมัติ — ใช้ `client_uuid` กันบันทึกซ้ำ
- เก็บพิกัด GPS ตอนบันทึก visit (ขออนุญาตก่อน ไม่บังคับ)

## 7. Sync ไป Google Sheet (MySQL → Sheet, ช้าได้แต่ชัวร์)

```
บันทึก → transaction: เขียนตารางหลัก + INSERT tb_sheet_outbox(entity, entity_id) → ตอบผู้ใช้ทันที
worker ทุก 1–5 นาที → อ่าน outbox: sent_at IS NULL AND next_try_at <= NOW()
                    → ดึงแถว "ล่าสุด" จาก MySQL (ไม่ใช่ payload ตอน enqueue)
                    → upsert ลง Sheet ตาม id (มี = ทับแถว, ไม่มี = append) ด้วย values.batchUpdate
                    → สำเร็จ (HTTP 200) เท่านั้นจึง set sent_at; ล้มเหลว → attempts++, next_try_at แบบ backoff
ทุกคืน 02:00      → rebuild ทุกแท็บจาก MySQL ทั้งหมด (ตาข่ายกันหลุด)
แจ้งเตือน          → มีงานค้าง > 1 ชม. → LINE OA
```

- worker รันตัวเดียวด้วย leader election ผ่าน Redis (ดู pattern ใน ppc-hos `lib/cacheWarmer.ts`) เริ่มจาก `instrumentation.ts`
- map `id → เลขแถว` cache ใน Redis; ไม่เจอให้อ่านคอลัมน์ A ใหม่
- เขียนแท็บ **ชื่อและหัวคอลัมน์เดิม** `DB_Patients`, `DB_Contacts`, `DB_Visits` + แท็บใหม่ `DB_Followups` — `tb-dashboard` / `tb-map` ใน ppc-hos อ่านแท็บที่ชื่อมี "patient" จึงใช้ต่อได้โดยไม่ต้องแก้
- `DB_Patients` คอลัมน์ `เดือน2 CXR … เดือน6 AFB` ยังเขียนต่อ (เอาจาก followup slot 1–5) เพื่อความเข้ากันได้
- ~~Sheet read-only สำหรับคน~~ → Jed สั่งไม่ล็อก (26 ต.ค. 2569); เปิดล็อกได้ด้วย `SHEET_PROTECT=1`
- ตัวกัน: Sheet มีแถวที่ไม่อยู่ใน MySQL → หยุดเขียนทั้งหมด (rebuild ล้างแท็บ จะทำข้อมูลที่ยังไม่ import หาย)

## 8. Import ข้อมูลเดิม (Sheet → MySQL ครั้งแรก)

สถานะข้อมูล ณ 21 ต.ค. 2569: `DB_Patients` 103 ราย (วันที่ ISO แล้ว), `DB_Contacts` ว่าง, `DB_Visits` ว่าง, CID และ รพ.สต.รับผิดชอบ ว่างทุกแถว

- สคริปต์ `scripts/import-from-sheet.ts` อ่าน `DB_Patients` / `DB_Contacts` / `DB_Visits` / `DB_Log`
- แม็ปคอลัมน์**ตามชื่อหัวภาษาไทย** ไม่ใช่ตำแหน่ง
- `''` → `NULL`, วันที่ → `DATE`, lat/lng → ตัวเลข, ชื่อหน่วย → `unit_id`, CID ต้อง 13 หลัก
- `เดือน2 CXR … เดือน6 AFB` → `tb_treatment_followups` slot 1–5
- upsert ตาม id เดิม → **รันซ้ำได้**
- ผู้บันทึกเดิม → `created_by = NULL` + audit `migrate` เก็บข้อความ "แก้ไขโดย/เมื่อ" เดิม
- **ไม่ import `DB_Users`** (PIN) — สร้างบัญชีใหม่
- แท็บ `ปีงบ 2568/2569/2570` ไม่ต้อง import (archive)
- จบแล้วพิมพ์รายงาน: อ่าน / เข้า / ปฏิเสธ + เหตุผลรายแถว

Cutover: ปิดการเขียนใน Apps Script → import รอบสุดท้าย → เทียบจำนวน (103 = 103) + สุ่มตรวจ 5–10 ราย → เปิดระบบใหม่ → outbox เริ่มเขียน Sheet

## 9. หมายเหตุสำหรับ ppc-hos (ไม่ใช่งานของโปรเจกต์นี้)

`app/api/tb-dashboard/route.ts` และ `app/api/tb-map/route.ts` อ่านช่วง `A:Z` (26 คอลัมน์) แต่ `DB_Patients` มี 38 คอลัมน์ → "ผลการรักษา" (AH) และ "วันสรุปผล" หลุด Success/Death Rate อาจผิด ต้องแก้ใน repo ppc-hos แยกต่างหาก ก่อนหรือพร้อม cutover

เพิ่มเติม: `normOutcome` ใน `tb-dashboard` จับเฉพาะคำอังกฤษ (cured/completed/died/lost/transfer) แต่ "ผลการรักษา" ใน `DB_Patients` เป็นภาษาไทย (หาย/รักษาครบ/เสียชีวิต/ขาดยา/โอนออก/กำลังรักษา) → ต้องแม็ปคำไทยด้วย ไม่งั้น Success/Death Rate ผิดแม้แก้ช่วงคอลัมน์แล้ว

## 10. ลำดับงาน

1. **Phase 1** — scaffold โปรเจกต์ + `docker-compose.yml` (app + mysql + redis) + schema + `lib/db.ts` (`tbDb`, `hosxpDb`) + `lib/tb/*` (logic ล้วน + test)
2. **Phase 2** — auth (login, session, ล็อกบัญชี, middleware deny-by-default) + จัดการผู้ใช้ (admin)
3. **Phase 3** — API: ผู้ป่วย / ผู้สัมผัส / followup / visit / เป้าหมาย / ประวัติ + สิทธิ์ §3 + audit log + ค้นหาจาก HOSxP ตาม HN
4. **Phase 4** — UI: ผู้ป่วย (§6.3, §6.4), ผู้สัมผัส (§6.5, §6.6), นัดหมาย, ต้องติดตาม, ตั้งเป้าหมาย + dashboard (§6.1, §6.2), นำเข้า/ส่งออก Excel
5. **Phase 5** — สคริปต์ import (§8) ทดสอบกับข้อมูลจริงแบบรันซ้ำ
6. **Phase 6** — outbox worker + nightly rebuild + แจ้งเตือนค้าง + แจ้งนัด 07:00 (§7)
7. **Phase 7** — backup ทุกคืน + ทดสอบ restore → cutover → เปิดนอกผ่าน Cloudflare Tunnel ทีหลัง

แต่ละ Phase จบที่ทดสอบผ่าน แล้วเสนอ commit message ภาษาไทยแบบ conventional commit (Jed commit/push เอง)
— Phase 1–7 commit แล้วบน branch `claude/nifty-euler-jwytsx` (commit ละ Phase)

UI: ธีมเขียว/มิ้นต์, ฟอนต์ Prompt/Sarabun (สอดคล้องกับ ppc-hos)

## 11. ยังต้องยืนยันกับเจ้าของงาน (ถามก่อนทำส่วนนั้น)

1. **"ตั้งเป้าหมาย A/B"** — หมายถึงแสดง ผลงาน(A)/เป้า(B) และตั้ง B ได้เอง ใช่ไหม
2. **ไตรมาส** — ตัวเลขรายไตรมาสเป็น *เฉพาะ 3 เดือนนั้น* หรือ *สะสมตั้งแต่ต้นปีงบ* (หรือทั้งสองแบบ)
3. Success Rate นับแบบ cohort (ขึ้นทะเบียนในไตรมาสนั้น ประเมินเมื่อครบ) แบบเดียวกับ `tb-dashboard` ปัจจุบันไหม
4. รายชื่อตัวชี้วัดที่ต้องตั้งเป้าได้ครบชุด
5. ยังใช้ "วง 1/2/3" ไหม เมื่อจับแค่ household / close contact
6. ตัด CID / พิกัด ออกจาก Sheet mirror ได้ไหม
7. ผู้ใช้นอก รพ. กี่คน (≤ 50 ใช้ Cloudflare Access ฟรีได้)

## 12. ตัดสินใจระหว่างพัฒนา (เลือกค่าที่ปลอดภัยไว้ก่อน — เปลี่ยนได้)

1. **migration 003**: `tb_users` + `must_change_password`, `session_version` (ตัด session เมื่อ reset/ปิดบัญชี/เปลี่ยนรหัส), `password_changed_at`, `updated_at`; `tb_treatment_followups` + `deleted_at` (ลบช่องที่เพิ่มเองได้โดย tb_app ไม่ต้องมี DELETE); `tb_app` ได้ DELETE บน `tb_targets` (ล้างเป้า = "ยังไม่ตั้งเป้า") — สิทธิ์ระดับตารางรวมอยู่ที่ `db/grants.sql` ใส่ซ้ำทุกครั้งที่ migrate
2. **ตัวชี้วัดตั้งต้น 4 ตัว** (`lib/indicators.ts`): ผู้ป่วยใหม่+กลับเป็นซ้ำ (ราย), Treatment Coverage, Success Rate, อัตราเสียชีวิต — ครบชุดยังรอ §11 ข้อ 4
3. **ไตรมาส** (§11 ข้อ 2): ค่าเริ่มต้น "เฉพาะ 3 เดือน" มีปุ่มสลับ "สะสม" ในแดชบอร์ด
4. **Success/Death Rate** (§11 ข้อ 3): นับผู้ป่วยที่เริ่มยาในช่วงนั้นและสรุปผลแล้ว (แบบระบบเดิม) ยังไม่ใช่ cohort
5. **Sheet mirror** (§11 ข้อ 6): ยังเขียน CID/พิกัดตามคอลัมน์เดิม; คอลัมน์ใหม่ของผู้สัมผัสต่อท้าย; แท็บ DB_* ถูกล็อกให้แก้ได้เฉพาะ service account
6. **วง 1/2/3** (§11 ข้อ 5): ยังเก็บและแสดงในฟอร์มผู้สัมผัส
7. **รพ.สต. เพิ่มผู้สัมผัส**: ค้นผู้ป่วย index ด้วย HN/ชื่อผ่าน `/api/patients/search` (ได้เฉพาะชื่อ/HN/วันเริ่มยา/ผล — ตาม §3) เพราะไม่เห็นรายชื่อผู้ป่วยทั้งหมด
8. **ค้น HOSxP** ให้เฉพาะทีม รพ. (HOSxP มีข้อมูลผู้ป่วยทั้งโรงพยาบาล)
9. **ย้ายข้อมูล** คงปีงบและลำดับตามแท็บเดิม (1 รายในข้อมูลจริงลงทะเบียนปีงบ 2568 แต่วันเริ่มยาคำนวณได้ 2567)
10. **IP**: เชื่อ `cf-connecting-ip` เฉพาะเมื่อ `TRUST_CLOUDFLARE=1`; การกันเดารหัสใช้ ล็อกราย username + จำกัดรหัสผิดรวมทั้งระบบ (ไม่อิง IP ที่ปลอมได้)
11. **ส่งออก Word** ทำแล้ว 4 แบบตามระบบเดิม (ประวัติผู้ป่วย, รายการติดตามลงพื้นที่, รายการนัด, สรุปแดชบอร์ด) สร้างฝั่ง browser ด้วย `docx` ฟอนต์ TH SarabunPSK — รายงานสรุปยังมีหัวข้อผู้สัมผัสแบบเดิม (§6.2 ตัดเฉพาะการ์ดบนแดชบอร์ด)
12. **หน้าแดชบอร์ด** ทำตามหน้าตาระบบเดิม (Index.html, กราฟ Chart.js สีชุดเดิม) เฉพาะส่วนผู้ป่วย: hero · การ์ดเป้า A/B · "เส้นทางผู้ป่วยวัณโรค" 6 การ์ด · กราฟผลการรักษา/ประเภท/ตำบล/อายุ/แนวโน้มรายเดือน — ส่วนผู้สัมผัสยังตัดออกตาม §6.2 (ยืนยันกับ Jed 26 ต.ค. 2569); มีปุ่ม "ส่งออก Word" (ข้อ 11)
13. **mysql CLI ใน container** ใช้ utf8mb4 (`db/conf/client-utf8mb4.cnf`) — ค่าเริ่มต้นของ image เป็น latin1 ทำให้ภาษาไทยที่พิมพ์ผ่าน `docker compose exec mysql mysql` เพี้ยน
14. **HOSxP เติมอัตโนมัติ** (ฟอร์มผู้ป่วย + ผู้สัมผัส, เฉพาะทีม รพ.): กรอก HN แล้วออกจากช่อง หรือเลขบัตรครบ 13 หลัก → เติมเฉพาะช่องที่ว่าง (ชื่อ เลขบัตร เพศ อายุ สิทธิ์ เบอร์ ที่อยู่ ต./อ./จ.), ปุ่ม "ดึงจาก HOSxP" = ทับทุกช่อง, เตือนถ้า HOSxP ระบุว่าเสียชีวิต · query ใช้ `p.*` + เลือกคอลัมน์ที่มี (ต่างกันตามเวอร์ชัน HOSxP) และ LPAD รหัส ต./อ./จ. แบบ ppc-hos
15. **ย้ายข้อมูลจากเว็บ**: แท็บ นำเข้า/ส่งออก → "ย้ายข้อมูลจากระบบเดิม" (อ่าน Sheet ตรง หรือ .xlsx) ทำเหมือน `scripts/import-from-sheet.ts` (ใช้ `lib/migrateSheet.ts` ร่วมกัน)
16. **นัดหมาย CRUD** (ขอ 28 ต.ค. 2569): ตาราง `tb_appointments` · เพิ่ม/แก้/เลื่อน/มาตามนัด/ขาดนัด/ยกเลิก — unit ทำได้เฉพาะผู้สัมผัสในเขต, ลบ = admin · ดึงนัดจาก HOSxP `oapp` (SQL ตาม plubplachai-alert + `app_cause`/`note` จาก debug trace หน้าจอนัด HOSxP) **อ่านอย่างเดียว ไม่เขียนกลับ HOSxP** (§2) · **คลินิกนัด = household / close contact** (Jed 28 ต.ค. 2569): ดึงนัดคลินิกเหล่านี้จาก HOSxP เข้าเองทุกชั่วโมง จับคู่ผู้สัมผัสด้วย HN → เลขบัตร → ผู้ป่วยตาม HN (`HOSXP_APPT_CLINICS`), ฟอร์มนัดผู้สัมผัสตั้งคลินิกตามประเภทการสัมผัส · อัปเดตนัดที่ดึงมาทุก 06:00 (visit_vn = มาตามนัด, สถานะไม่ใช่ NULL/1 หรือถูกลบ = ยกเลิก, `HOSXP_ACTIVE_STATUS_IDS`) · ยังไม่ mirror นัดไป Google Sheet
