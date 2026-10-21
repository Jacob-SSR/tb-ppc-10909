-- db/grants.sql — สิทธิ์ระดับตารางของ tb_app (รันซ้ำได้ — npm run migrate / docker compose run --rm migrate ใช้ทุกครั้ง)
-- อยู่นอก migration เพราะสิทธิ์ไม่ติดไปกับไฟล์ backup (mysqldump เฉพาะ ppc_tb)
-- → หลัง restore ลง MySQL ใหม่ แค่รัน migrate อีกครั้ง สิทธิ์จะกลับมาครบ
-- บัญชี tb_app สร้างใน db/init/01-create-users.sh (SELECT, INSERT, UPDATE บน ppc_tb.*)

-- ลบได้เฉพาะตารางค่าตั้ง — ข้อมูลทะเบียนใช้ soft delete (deleted_at) เท่านั้น
GRANT DELETE ON ppc_tb.tb_settings TO 'tb_app'@'%';
GRANT DELETE ON ppc_tb.tb_targets TO 'tb_app'@'%';
