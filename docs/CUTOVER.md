# เปลี่ยนจาก Apps Script + Google Sheet → ระบบใหม่ (cutover)

ตาม CLAUDE.md §8 — ทำในวันที่ทีมว่าง ใช้เวลาประมาณ 1 ชม. · ระหว่างขั้น 3–7 ห้ามคีย์ข้อมูลที่ไหนเลย

## ก่อนวันจริง (ทำได้ล่วงหน้า หลายรอบก็ได้)

- [ ] ติดตั้งบน .58 ตาม README (mysql, migrate, admin คนแรก, app, backup) และ backup ไปที่ NAS ได้จริง
- [ ] ตั้ง Google Sheet (service account เป็นผู้แก้ไขไฟล์ "Tuberculosis") — **ยังไม่ใส่ `TB_SPREADSHEET_ID`** จนถึงขั้น 8
- [ ] ซ้อมย้ายข้อมูลแบบไม่บันทึก:
      `docker compose run --rm cli node scripts/import-from-sheet.ts --dry` (ต้องใส่ `GOOGLE_*` + `TB_SPREADSHEET_ID` ชั่วคราวใน `.env.production` ของ cli หรือดาวน์โหลดไฟล์ .xlsx แล้วใช้ `--xlsx`)
      → ดูรายงาน "ปฏิเสธ" ต้องเป็น 0 หรือรู้เหตุผลทุกแถว
- [ ] สร้างบัญชีผู้ใช้ทุกคน (ทีม TB + รพ.สต. 6 แห่ง) แจกรหัสชั่วคราวแบบตัวต่อตัว
- [ ] ตั้งเป้าหมายปีงบปัจจุบัน (แท็บ "ตั้งเป้าหมาย") + อีเมลรับแจ้งเตือน + LINE token
- [ ] **แก้ ppc-hos ก่อนหรือพร้อม cutover** (repo ppc-hos):
  - `app/api/tb-dashboard/route.ts`, `app/api/tb-map/route.ts` อ่านแค่ `A:Z` แต่ DB_Patients มี 38 คอลัมน์ (ผลการรักษาอยู่ AH) → อ่าน `A:AL` หรือทั้งแท็บ
  - `normOutcome` จับเฉพาะคำอังกฤษ (cured/completed/died) แต่ค่าจริงใน Sheet เป็นไทย (หาย/รักษาครบ/เสียชีวิต/ขาดยา/โอนออก/กำลังรักษา) → Success/Death Rate ผิดแม้แก้ช่วงแล้ว

## วันจริง

1. [ ] แจ้งทุกหน่วยหยุดคีย์ในระบบเดิม (เวลา __:__)
2. [ ] backup ระบบใหม่ไว้ก่อน: `docker compose run --rm backup now`
3. [ ] **ปิดการเขียนในระบบเดิม**: Apps Script → Deploy → Manage deployments → Archive web app (หรือแก้ `savePatient`/`saveContact`/`saveVisit` ให้ throw)
       และ File → Make a copy ของ Sheet เก็บไว้เป็นสำเนาก่อนเปลี่ยน
4. [ ] ย้ายข้อมูลรอบสุดท้าย (รันซ้ำทับรอบซ้อมได้เลย — upsert ตาม id):
       `docker compose run --rm cli node scripts/import-from-sheet.ts --dry` → ตรวจรายงาน → รันอีกครั้งโดยไม่มี `--dry`
5. [ ] เทียบจำนวน: รายงานต้องได้ "ใน MySQL: ผู้ป่วย = เทียบ Sheet: ผู้ป่วย" (103 = 103 ณ 21 ต.ค. 2569) และผู้สัมผัส/บันทึกรายครั้งเท่ากัน
6. [ ] สุ่มตรวจ 5–10 ราย ในเว็บใหม่เทียบกับ Sheet: ชื่อ, HN, วันเริ่มยา, สูตรยา, ผล AFB เดือน 2/5/6, ผลการรักษา, ปีงบ
7. [ ] เปิดระบบใหม่ให้ทุกหน่วยใช้ (แจ้ง URL `http://192.168.200.58:3010`)
8. [ ] เปิด Sheet mirror: ใส่ `TB_SPREADSHEET_ID` + `GOOGLE_*` ใน `.env.production` → `docker compose up -d app`
       → แท็บ "ตั้งเป้าหมาย" กด "เขียน Sheet ใหม่ทั้งหมดตอนนี้" → DB_Patients ใน Sheet ต้องเหมือนเดิม (ถ้า Sheet ยังมีแถวที่ไม่อยู่ใน MySQL ระบบจะไม่เขียนและแจ้งเหตุผล — ข้อมูลเดิมไม่หาย)
9. [ ] เปิด tb-dashboard / tb-map ใน ppc-hos ตรวจว่าตัวเลขขึ้นตามปกติ
10. [ ] พรุ่งนี้เช้า: ได้ LINE/อีเมลแจ้งนัด 07:00 และมีไฟล์ backup ของคืนนี้ใน NAS

## ถ้าต้องถอยกลับ

ระบบเดิมยังอยู่ครบ (แค่ archive deployment ไว้) — เปิด deployment กลับ, ใช้สำเนา Sheet จากขั้น 3 ถ้า mirror เขียนทับไปแล้ว
ข้อมูลที่คีย์ในระบบใหม่ระหว่างนั้นส่งออกเป็น Excel ได้จากแท็บ "นำเข้า / ส่งออก"
