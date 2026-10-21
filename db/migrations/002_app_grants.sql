-- 002_app_grants.sql — สิทธิ์ระดับตารางของ tb_app (ส่วนบัญชีท้าย docs/ppc_tb_schema.sql)
-- บัญชีสร้างใน db/init/01-create-users.sh (SELECT, INSERT, UPDATE บน ppc_tb.*)
-- สิทธิ์ระดับตารางต้องให้หลังตารางมีอยู่แล้ว จึงอยู่ใน migration (tb_migrate มี GRANT OPTION เฉพาะ ppc_tb.*)
-- host '%' เพราะแอปต่อจาก network ภายในของ compose (MySQL ไม่เปิด port ออก LAN)

GRANT DELETE ON ppc_tb.tb_settings TO 'tb_app'@'%';
