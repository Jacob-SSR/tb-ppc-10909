# ระบบนัดหมายแบบเลือกช่วงเวลา

เพิ่มฟอร์มเลือกเวลาเช้า 08:00–11:59 บ่าย 12:00–15:59 เย็น 16:00–19:59 ช่วงละ 30 นาที หรือกรอกเวลาเอง พร้อมห้องตรวจ จุดติดต่อ คำแนะนำหลายรายการ Telemed แม่แบบหมายเหตุ และพิมพ์ใบนัดสองรูปแบบ

## ติดตั้ง

1. ตั้งค่า `.env.local` ตาม `.env.example` รวมบัญชี MySQL ของแอปและบัญชี migration
2. รัน `npm ci` และ `npm run migrate` (รวม migration ใหม่ `007_appointment_details.sql` ในฐาน `ppc_tb`)
3. รัน `npm run typecheck`, `npm run lint`, `npm test` แล้ว `npm run build`
4. เริ่มแอปด้วย `npm start` หรือ build/restart ผ่าน Docker ตาม README เดิม

ต้องรัน migration ก่อนเปิดแอปเวอร์ชันนี้ เพราะ API อ่านคอลัมน์ใหม่ด้วย ไม่ต้องแก้ตารางในฐาน HOSxP

## SQL และ HOSxP

ใช้การเชื่อมต่อ `HOSXP_DB_*` เดิม (tis620, อ่านอย่างเดียว) ไม่มีคำสั่ง INSERT/UPDATE ไปยัง HOSxP

`GET /api/hosxp/appointment-options` ใช้สิทธิ์ admin และ rate limit เหมือนการอ่าน HOSxP เดิม:

```sql
SHOW COLUMNS FROM oapp;
SELECT name FROM clinic WHERE name IS NOT NULL ORDER BY name;
SELECT department AS name FROM kskdepartment
WHERE department IS NOT NULL ORDER BY department;
SELECT name FROM doctor WHERE name IS NOT NULL ORDER BY name;
-- รันเฉพาะคอลัมน์ที่พบจาก SHOW COLUMNS
SELECT DISTINCT app_cause AS name FROM oapp
WHERE nextdate >= CURDATE() - INTERVAL 1 YEAR AND app_cause IS NOT NULL
ORDER BY name LIMIT 200;
SELECT DISTINCT contact_point AS name FROM oapp
WHERE nextdate >= CURDATE() - INTERVAL 1 YEAR AND contact_point IS NOT NULL
ORDER BY name LIMIT 200;
```

ข้อมูลนัดอ่านจาก `oapp` เชื่อม `clinic.clinic`, `doctor.code`, `kskdepartment.depcode` ตาม SQL เดิมใน `lib/hosxp.ts` และเพิ่มการอ่าน `nexttime_end` ถ้ามี ห้องตรวจมาจาก `kskdepartment.department` จุดติดต่อมาจาก `oapp.contact_point` เก็บสำเนาใน `tb_appointments` ของแอป การสร้างนัดในแอปจึงไม่สร้างนัดในหน้าจอ HOSxP

หากไม่ได้ตั้ง HOSxP หรืออ่านรายการไม่ได้ ยังพิมพ์ข้อมูลเองได้ ผู้ใช้หน่วยบริการใช้รายการพื้นฐานและสิทธิ์เดิมในการนัดผู้สัมผัสในเขตรับผิดชอบ

## พฤติกรรม

- จำนวนในแต่ละช่วงเป็นนัด scheduled ที่ผู้ใช้มีสิทธิ์ดูในระบบ TB ตามวันที่และชื่อคลินิกที่เลือก ไม่ใช่จำนวนคิวทั้งหมดหรือโควตาของ HOSxP และไม่ได้ล็อกจำนวนคนต่อช่วง
- เวลาเดิมที่ไม่มีช่วงสิ้นสุดยังเปิดแก้ได้ นัดเก่าที่ไม่มีเวลายังบันทึกสถานะได้ นัดใหม่จากฟอร์มต้องเลือกเวลา
- แม่แบบหมายเหตุเก็บใน localStorage แยกตาม user id ในเบราว์เซอร์ ไม่ sync ข้ามเครื่อง และควรเก็บเฉพาะข้อความทั่วไป
- ใบนัดเป็นรูปแบบของแอป (พร้อมคำแนะนำ / แบบย่อ) เปิดหน้าต่างพิมพ์หลังบันทึกสำเร็จ ต้องอนุญาต popup ไม่ใช้ฟอร์มรายงานเฉพาะของ HOSxP
- หมายเหตุและคำแนะนำยาวได้ 2,000 ตัวอักษรตาม API เดิม เพื่อรองรับข้อมูลนัดเดิม
- การอัปเดตผ่าน client เดิมที่ไม่ส่งช่องใหม่ จะเก็บรายละเอียดใหม่ไว้ รวมถึงการนำเข้านัดเดิมซ้ำ

## ตรวจสอบก่อนใช้กับโรงพยาบาล

ยังต้องทดสอบ migration กับ MySQL ทดลอง และทดสอบ dropdown/นำเข้านัดกับฐาน HOSxP ของโรงพยาบาลจริง เนื่องจาก schema และข้อมูลอาจต่างกันตามเวอร์ชัน ทดสอบสร้างนัด เปิดแก้ใหม่ เปลี่ยนสถานะ และพิมพ์ใบนัดทั้งสองรูปแบบก่อนใช้งานจริง
