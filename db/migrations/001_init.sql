-- 001_init.sql — schema เริ่มต้นของ ppc_tb (MySQL 8.4, utf8mb4)
-- รันด้วย `npm run migrate` (บัญชี tb_migrate) — ห้ามแก้ไฟล์นี้หลังรันบน production แล้ว
-- แก้ schema ให้เพิ่มไฟล์ 00N_*.sql ใหม่ (runner ตรวจ checksum ถ้าไฟล์เก่าถูกแก้จะไม่ยอมรัน)
--
-- หลักร่วม:
--   * ตารางหลักมี version (optimistic lock: UPDATE … WHERE id=? AND version=?) และ deleted_at (soft delete)
--   * วันที่เก็บเป็น DATE ค.ศ. แสดง พ.ศ. ที่ UI
--   * created_by/updated_by = tb_users.id (NULL = ข้อมูลที่ import จากระบบเดิม)
--   * บัญชีแอป tb_app ไม่มีสิทธิ์ DELETE (ยกเว้น tb_settings) → ลบ = SET deleted_at

SET NAMES utf8mb4;

-- ── หน่วยบริการ ────────────────────────────────────────────────────────────────
CREATE TABLE tb_units (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  role        ENUM('admin','unit') NOT NULL COMMENT 'admin = รพ.พลับพลาชัย, unit = รพ.สต.',
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ผู้ใช้รายคน ────────────────────────────────────────────────────────────────
CREATE TABLE tb_users (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username             VARCHAR(50) NOT NULL,
  display_name         VARCHAR(150) NOT NULL,
  password_hash        VARCHAR(100) NOT NULL COMMENT 'bcrypt เท่านั้น',
  unit_id              SMALLINT UNSIGNED NOT NULL COMMENT 'สิทธิ์ admin/unit มาจาก tb_units.role',
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  failed_logins        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until         DATETIME NULL,
  last_login_at        DATETIME NULL,
  password_changed_at  DATETIME NULL,
  created_by           INT UNSIGNED NULL,
  updated_by           INT UNSIGNED NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version              INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_unit (unit_id),
  CONSTRAINT fk_users_unit FOREIGN KEY (unit_id) REFERENCES tb_units (id),
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ผู้ป่วย index (DB_Patients) ───────────────────────────────────────────────
-- ชื่อ/อายุ/สิทธิ์ เป็น "สำเนา" จาก HOSxP ตอนบันทึก (hosxp_synced_at) — ทะเบียนเปิดได้แม้ HOSxP ปิด
CREATE TABLE tb_patients (
  id              CHAR(11) NOT NULL COMMENT 'P + 10 hex (คงรหัสเดิมจาก Sheet)',
  fy              SMALLINT UNSIGNED NULL COMMENT 'ปีงบ พ.ศ.',
  seq             INT UNSIGNED NULL COMMENT 'ลำดับในปีงบ',
  full_name       VARCHAR(150) NOT NULL,
  hn              VARCHAR(20) NULL,
  tb_number       VARCHAR(30) NULL,
  cid             CHAR(13) NULL,
  pttype          VARCHAR(100) NULL COMMENT 'สิทธิการรักษา',
  sex             VARCHAR(10) NULL,
  age             TINYINT UNSIGNED NULL,
  birthday        DATE NULL,
  address         VARCHAR(255) NULL COMMENT 'บ้านเลขที่/หมู่',
  tambon          VARCHAR(100) NULL COMMENT 'ตำบล/พื้นที่',
  unit_id         SMALLINT UNSIGNED NULL COMMENT 'รพ.สต.รับผิดชอบ',
  phone           VARCHAR(50) NULL,
  lat             DECIMAL(9,6) NULL,
  lng             DECIMAL(9,6) NULL,
  comorbidity     VARCHAR(500) NULL COMMENT 'โรคร่วม (U/D)',
  hiv_result      VARCHAR(50) NULL,
  patient_type    VARCHAR(50) NULL COMMENT 'ประเภทผู้ป่วย NEW/Relapse/…',
  reg_place       VARCHAR(150) NULL COMMENT 'สถานที่ลงทะเบียน',
  diag_method     VARCHAR(255) NULL,
  rif_resistance  VARCHAR(50) NULL,
  diag_date       DATE NULL,
  start_date      DATE NULL COMMENT 'วันเริ่มยา',
  regimen         VARCHAR(150) NULL,
  admit_date      DATE NULL,
  discharge_date  DATE NULL,
  lft             VARCHAR(500) NULL,
  outcome         VARCHAR(50) NULL COMMENT 'ผลการรักษา',
  outcome_date    DATE NULL COMMENT 'วันสรุปผล',
  note            TEXT NULL,
  hosxp_synced_at DATETIME NULL COMMENT 'เวลาที่ดึงสำเนาจาก HOSxP ล่าสุด',
  created_by      INT UNSIGNED NULL,
  updated_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version         INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_patients_hn (hn),
  KEY ix_patients_cid (cid),
  KEY ix_patients_fy (fy, start_date),
  KEY ix_patients_start (start_date),
  KEY ix_patients_unit (unit_id),
  CONSTRAINT ck_patients_id CHECK (REGEXP_LIKE(id, '^P[0-9a-f]{10}$', 'c')),
  CONSTRAINT ck_patients_cid CHECK (cid IS NULL OR REGEXP_LIKE(cid, '^[0-9]{13}$')),
  CONSTRAINT fk_patients_unit FOREIGN KEY (unit_id) REFERENCES tb_units (id),
  CONSTRAINT fk_patients_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_patients_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ติดตามระหว่างรักษา หมวด 4 (slot 1–12) ──────────────────────────────────────
-- slot 1–5 = เดือน2 CXR, เดือน2 AFB, เดือน5 AFB, เดือน6 CXR, เดือน6 AFB (คอลัมน์เดิมใน Sheet)
-- ลบช่อง = SET deleted_at; เพิ่มช่องเดิมกลับ = INSERT … ON DUPLICATE KEY UPDATE deleted_at = NULL
CREATE TABLE tb_treatment_followups (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id  CHAR(11) NOT NULL,
  slot        TINYINT UNSIGNED NOT NULL,
  month_no    TINYINT UNSIGNED NULL COMMENT 'เดือนที่ของการรักษา',
  test_type   VARCHAR(30) NULL COMMENT 'CXR / AFB / Culture / …',
  test_date   DATE NULL,
  result      VARCHAR(100) NULL,
  created_by  INT UNSIGNED NULL,
  updated_by  INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version     INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_followups_slot (patient_id, slot),
  CONSTRAINT ck_followups_slot CHECK (slot BETWEEN 1 AND 12),
  CONSTRAINT fk_followups_patient FOREIGN KEY (patient_id) REFERENCES tb_patients (id),
  CONSTRAINT fk_followups_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_followups_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ผู้สัมผัส (DB_Contacts) ───────────────────────────────────────────────────
CREATE TABLE tb_contacts (
  id               CHAR(11) NOT NULL COMMENT 'C + 10 hex',
  patient_id       CHAR(11) NOT NULL COMMENT 'ผู้ป่วย index',
  fy               SMALLINT UNSIGNED NULL,
  full_name        VARCHAR(150) NOT NULL,
  cid              CHAR(13) NULL,
  hn               VARCHAR(20) NULL,
  sex              VARCHAR(10) NULL,
  age              TINYINT UNSIGNED NULL,
  relation         VARCHAR(100) NULL COMMENT 'ความสัมพันธ์',
  contact_type     ENUM('household','close') NOT NULL COMMENT 'ร่วมบ้าน / ใกล้ชิด',
  ring             TINYINT UNSIGNED NULL COMMENT 'วง 1/2/3 — รอยืนยันว่ายังใช้ไหม',
  unit_id          SMALLINT UNSIGNED NULL COMMENT 'รพ.สต.รับผิดชอบ — ใช้กรองสิทธิ์ user unit',
  address          VARCHAR(255) NULL COMMENT 'ที่อยู่ตามทะเบียน',
  current_address  VARCHAR(255) NULL COMMENT 'ที่อยู่ปัจจุบัน',
  phone            VARCHAR(50) NULL,
  risk_group       VARCHAR(255) NULL COMMENT 'กลุ่มเสี่ยง',
  investigate_date DATE NULL COMMENT 'ขั้น A วันสอบสวน',
  screen_date      DATE NULL COMMENT 'ขั้น B วันคัดกรอง',
  symptoms         VARCHAR(255) NULL COMMENT 'ซักอาการ',
  cxr_date         DATE NULL,
  cxr_result       VARCHAR(100) NULL,
  screen_result    VARCHAR(100) NULL COMMENT '"ป่วยเป็นวัณโรค" = isTB',
  new_patient_id   CHAR(11) NULL COMMENT 'ผู้ป่วยใหม่ที่แปลงจากผู้สัมผัสรายนี้',
  tb_treat_place   VARCHAR(150) NULL COMMENT 'สถานที่รักษา กรณีไม่ได้ลงทะเบียนในระบบนี้',
  tpt_eligible     TINYINT(1) NULL COMMENT 'ขั้น C 1 = เข้าเกณฑ์ TPT',
  tpt_regimen      VARCHAR(50) NULL,
  tpt_start_date   DATE NULL,
  tpt_end_date     DATE NULL,
  tpt_status       VARCHAR(50) NULL,
  fu6_date         DATE NULL COMMENT 'ขั้น D',
  fu6_result       VARCHAR(100) NULL,
  fu12_date        DATE NULL,
  fu12_result      VARCHAR(100) NULL,
  fu18_date        DATE NULL,
  fu18_result      VARCHAR(100) NULL,
  fu24_date        DATE NULL,
  fu24_result      VARCHAR(100) NULL,
  note             TEXT NULL,
  created_by       INT UNSIGNED NULL,
  updated_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at       DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_contacts_patient (patient_id, contact_type),
  KEY ix_contacts_unit (unit_id),
  KEY ix_contacts_new_patient (new_patient_id),
  KEY ix_contacts_cid (cid),
  KEY ix_contacts_hn (hn),
  CONSTRAINT ck_contacts_id CHECK (REGEXP_LIKE(id, '^C[0-9a-f]{10}$', 'c')),
  CONSTRAINT ck_contacts_cid CHECK (cid IS NULL OR REGEXP_LIKE(cid, '^[0-9]{13}$')),
  CONSTRAINT fk_contacts_patient FOREIGN KEY (patient_id) REFERENCES tb_patients (id),
  CONSTRAINT fk_contacts_new_patient FOREIGN KEY (new_patient_id) REFERENCES tb_patients (id),
  CONSTRAINT fk_contacts_unit FOREIGN KEY (unit_id) REFERENCES tb_units (id),
  CONSTRAINT fk_contacts_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── บันทึกรายครั้ง (DB_Visits) ────────────────────────────────────────────────
-- ผูกผู้ป่วย "หรือ" ผู้สัมผัส อย่างใดอย่างหนึ่ง; client_uuid กันส่งซ้ำตอนเน็ตหลุดแล้วส่งใหม่
CREATE TABLE tb_visits (
  id              CHAR(11) NOT NULL COMMENT 'V + 10 hex',
  patient_id      CHAR(11) NULL,
  contact_id      CHAR(11) NULL,
  visit_date      DATE NOT NULL,
  visit_type      VARCHAR(50) NOT NULL COMMENT 'ประเภท เช่น เยี่ยมบ้าน / TPT / DOT',
  detail          TEXT NULL,
  next_appt_date  DATE NULL COMMENT 'วันนัดครั้งถัดไป',
  lat             DECIMAL(9,6) NULL,
  lng             DECIMAL(9,6) NULL,
  gps_accuracy_m  DECIMAL(8,1) NULL,
  client_uuid     CHAR(36) NULL,
  created_by      INT UNSIGNED NULL,
  updated_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version         INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_visits_client_uuid (client_uuid),
  KEY ix_visits_patient (patient_id, visit_date),
  KEY ix_visits_contact (contact_id, visit_date),
  KEY ix_visits_next_appt (next_appt_date),
  CONSTRAINT ck_visits_id CHECK (REGEXP_LIKE(id, '^V[0-9a-f]{10}$', 'c')),
  CONSTRAINT ck_visits_owner CHECK ((patient_id IS NULL) <> (contact_id IS NULL)),
  CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES tb_patients (id),
  CONSTRAINT fk_visits_contact FOREIGN KEY (contact_id) REFERENCES tb_contacts (id),
  CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_visits_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── เป้าหมายตัวชี้วัด ──────────────────────────────────────────────────────────
CREATE TABLE tb_targets (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fy            SMALLINT UNSIGNED NOT NULL COMMENT 'ปีงบ พ.ศ.',
  quarter       TINYINT UNSIGNED NOT NULL COMMENT '0 = ทั้งปีงบ, 1–4 = Q1–Q4',
  indicator     VARCHAR(50) NOT NULL,
  target_value  DECIMAL(10,2) NOT NULL,
  created_by    INT UNSIGNED NULL,
  updated_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version       INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at    DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_targets (fy, quarter, indicator),
  CONSTRAINT ck_targets_quarter CHECK (quarter BETWEEN 0 AND 4),
  CONSTRAINT ck_targets_value CHECK (target_value >= 0),
  CONSTRAINT fk_targets_created_by FOREIGN KEY (created_by) REFERENCES tb_users (id),
  CONSTRAINT fk_targets_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── audit log: ทุกการเพิ่ม/แก้/ลบ/login/import/export ──────────────────────────
-- ไม่มี FK ไป tb_users เพื่อให้ log อยู่ได้เสมอ (เก็บ username/unit ณ ตอนนั้นไว้ด้วย)
CREATE TABLE tb_audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id     INT UNSIGNED NULL,
  username    VARCHAR(50) NULL,
  unit_id     SMALLINT UNSIGNED NULL,
  ip          VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  action      VARCHAR(30) NOT NULL COMMENT 'create/update/delete/restore/login/login_failed/logout/import/export/migrate/convert',
  entity      VARCHAR(30) NULL COMMENT 'patient/contact/visit/followup/target/user/setting',
  entity_id   VARCHAR(40) NULL,
  before_json JSON NULL,
  after_json  JSON NULL,
  detail      VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity, entity_id, at),
  KEY ix_audit_at (at),
  KEY ix_audit_user (user_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ค่าตั้งระบบ (DB_Settings) — ห้ามเก็บ secret/token ที่นี่ ใช้ env ─────────────
CREATE TABLE tb_settings (
  k           VARCHAR(100) NOT NULL,
  v           TEXT NULL,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k),
  CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES tb_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── outbox สำหรับ sync MySQL → Google Sheet (ช้าได้แต่ชัวร์) ───────────────────
-- เก็บแค่ entity + id; worker ไปอ่านแถวล่าสุดจากตารางหลักเอง ไม่ใช้ payload ตอน enqueue
CREATE TABLE tb_sheet_outbox (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity       ENUM('patient','contact','visit','followup') NOT NULL,
  entity_id    VARCHAR(40) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_try_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      DATETIME NULL,
  last_error   VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY ix_outbox_pending (sent_at, next_try_at),
  KEY ix_outbox_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- tb_app ลบแถวได้เฉพาะ tb_settings (สิทธิ์ระดับตารางต้องให้หลังตารางมีอยู่แล้ว จึงอยู่ในไฟล์นี้
-- ไม่ใช่ใน db/init — บัญชี tb_migrate มี GRANT OPTION เฉพาะ ppc_tb.*)
GRANT DELETE ON ppc_tb.tb_settings TO 'tb_app'@'%';
