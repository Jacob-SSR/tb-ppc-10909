-- 006: นัดหมาย (เพิ่ม/แก้/เลื่อน/มาตามนัด/ยกเลิก/ลบ) เป็นตารางของระบบเอง
--   เดิม "นัด" = next_appt ของบันทึกรายครั้งล่าสุดเท่านั้น — ตอนนี้ next_appt ยังใช้ได้ (สร้างนัดในตารางนี้ให้เอง, source='visit')
--   นัดจาก HOSxP (oapp) ดึงมาเก็บสำเนาได้ (source='hosxp', hosxp_oapp_id ไม่ซ้ำ) — อ่านอย่างเดียว ไม่เขียนกลับ HOSxP
--   แบบตาราง/SQL อ้างอิงจาก plubplachai-alert (appointments snapshot ของ oapp)
CREATE TABLE tb_appointments (
  id             VARCHAR(16) PRIMARY KEY,                       -- 'A' + 10 hex
  patient_id     VARCHAR(16) NULL,
  contact_id     VARCHAR(16) NULL,
  appt_date      DATE NOT NULL,
  appt_time      TIME NULL,
  purpose        VARCHAR(100) NOT NULL,                         -- รับยา / ตรวจเสมหะ / CXR / เยี่ยมบ้าน / ...
  place          VARCHAR(150) NULL,                             -- คลินิก / จุดนัด / รพ.สต.
  doctor_name    VARCHAR(150) NULL,
  note           TEXT NULL,
  status         ENUM('scheduled','done','missed','cancelled') NOT NULL DEFAULT 'scheduled',
  source         ENUM('manual','visit','hosxp') NOT NULL DEFAULT 'manual',
  visit_id       VARCHAR(16) NULL,                              -- นัดที่สร้างจาก next_appt ของบันทึกรายครั้ง
  hosxp_oapp_id  VARCHAR(20) NULL,                              -- oapp.oapp_id
  hosxp_status   VARCHAR(20) NULL,                              -- oapp.oapp_status_id ล่าสุดที่อ่านได้
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version        INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at     DATETIME NULL,
  CONSTRAINT fk_app_patient FOREIGN KEY (patient_id) REFERENCES tb_patients(id),
  CONSTRAINT fk_app_contact FOREIGN KEY (contact_id) REFERENCES tb_contacts(id),
  CONSTRAINT fk_app_visit   FOREIGN KEY (visit_id)   REFERENCES tb_visits(id),
  CONSTRAINT fk_app_created FOREIGN KEY (created_by) REFERENCES tb_users(id),
  CONSTRAINT fk_app_updated FOREIGN KEY (updated_by) REFERENCES tb_users(id),
  CONSTRAINT chk_app_ref CHECK ((patient_id IS NULL) <> (contact_id IS NULL)),
  UNIQUE KEY uq_app_visit (visit_id),
  UNIQUE KEY uq_app_oapp (hosxp_oapp_id),
  KEY idx_app_status_date (status, appt_date),                  -- หน้า "นัดหมาย" + แจ้งเตือน 07:00
  KEY idx_app_patient (patient_id, appt_date),
  KEY idx_app_contact (contact_id, appt_date)
) ENGINE=InnoDB;

-- ย้ายนัดค้างเดิม: next_appt ของบันทึกล่าสุดของแต่ละราย (กติกาเดิม) → นัด 1 รายการต่อราย
INSERT INTO tb_appointments (id, patient_id, contact_id, appt_date, purpose, status, source, visit_id, created_by, updated_by, created_at)
SELECT CONCAT('A', SUBSTRING(MD5(x.id), 1, 10)), x.patient_id, x.contact_id, x.next_appt, x.visit_type, 'scheduled', 'visit',
       x.id, x.created_by, x.created_by, x.created_at
  FROM (SELECT v.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(v.patient_id, v.contact_id) ORDER BY v.visit_date DESC, v.updated_at DESC) AS rn
          FROM tb_visits v WHERE v.deleted_at IS NULL) x
 WHERE x.rn = 1 AND x.next_appt IS NOT NULL;

-- ประวัติการแก้ไขของนัด
ALTER TABLE tb_audit_log
  MODIFY entity ENUM('patient','contact','visit','settings','user','system','appointment') NOT NULL;
