-- 003_auth_followups.sql
-- ช่องที่ต้องใช้เพิ่มจาก schema เดิม (ไม่แก้ 001 ที่รันไปแล้ว)

-- ผู้ใช้: บังคับเปลี่ยนรหัสผ่านครั้งแรก/หลัง reset, session_version ไว้ตัด session เดิมทั้งหมด
-- (reset รหัส / ปิดบัญชี / เปลี่ยนรหัส → +1 แล้ว cookie เก่าใช้ไม่ได้ทันที)
ALTER TABLE tb_users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 1 AFTER password_hash,
  ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER must_change_password,
  ADD COLUMN password_changed_at DATETIME NULL AFTER last_login_at,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ติดตามระหว่างรักษา: ลบช่องที่กด "+ เพิ่มเติม" ได้แบบ soft delete
-- (tb_app ไม่มีสิทธิ์ DELETE; เพิ่ม slot เดิมกลับ = INSERT … ON DUPLICATE KEY UPDATE deleted_at = NULL)
ALTER TABLE tb_treatment_followups
  ADD COLUMN deleted_at DATETIME NULL;

-- เป้าหมาย: ตั้งแล้วลบออกได้ (กลับเป็น "ยังไม่ตั้งเป้า") — ตารางค่าตั้งแบบเดียวกับ tb_settings
GRANT DELETE ON ppc_tb.tb_targets TO 'tb_app'@'%';
