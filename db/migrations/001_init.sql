-- 001_init.sql = docs/ppc_tb_schema.sql ตัดส่วนบัญชี MySQL ท้ายไฟล์ออก (CLAUDE.md §4.1)
-- ห้ามแก้ไฟล์นี้หลังรันบน production แล้ว — แก้ schema ให้เพิ่มไฟล์ 00N_*.sql ใหม่

-- =====================================================================
-- ppc_tb : ทะเบียนวัณโรคและผู้สัมผัส รพ.พลับพลาชัย (ย้ายจาก Google Sheets)
-- แม็ปจาก Apps Script: P_FIELDS / C_FIELDS / V_FIELDS / DB_Users / DB_Log / DB_Settings
-- ต้องใช้ MySQL 8.0.16+ หรือ MariaDB 10.4+ (CHECK constraint และ JSON)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS ppc_tb
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ppc_tb;

-- ---------------------------------------------------------------------
-- หน่วยบริการ (เดิม DB_Users: หน่วย + PIN + สิทธิ์)
-- ---------------------------------------------------------------------
CREATE TABLE tb_units (
  id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,          -- 'รพ.พลับพลาชัย', 'รพ.สต.ตาพระ', ...
  hcode       CHAR(5) NULL,                          -- รหัสสถานพยาบาล 5 หลัก (ไว้ join HOSxP / 43 แฟ้ม)
  role        ENUM('admin','unit') NOT NULL DEFAULT 'unit',
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ผู้ใช้รายคน (แทน PIN รวมของหน่วย) ผูกกับหน่วย สิทธิ์ตามหน่วย
CREATE TABLE tb_users (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  unit_id        SMALLINT UNSIGNED NOT NULL,
  username       VARCHAR(50) NOT NULL UNIQUE,
  display_name   VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,              -- bcrypt/argon2 ห้ามเก็บ PIN ตรงๆ
  active         TINYINT(1) NOT NULL DEFAULT 1,
  failed_logins  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until   DATETIME NULL,
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_unit FOREIGN KEY (unit_id) REFERENCES tb_units(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ผู้ป่วยวัณโรค (index case) เดิม DB_Patients
-- id เก็บรูปแบบเดิม 'P' + 10 hex เพื่อให้ข้อมูลที่ย้ายมาและประวัติอ้างอิงกันได้
-- ---------------------------------------------------------------------
CREATE TABLE tb_patients (
  id            VARCHAR(16) PRIMARY KEY,
  fy            SMALLINT UNSIGNED NOT NULL,          -- ปีงบ พ.ศ. คำนวณจากวันเริ่มยา (ต.ค. = ปีงบถัดไป)
  seq           SMALLINT UNSIGNED NULL,              -- ลำดับในทะเบียนปีงบ
  name          VARCHAR(150) NOT NULL,
  hn            VARCHAR(12)  NULL,
  tb_no         VARCHAR(20)  NULL,
  cid           CHAR(13)     NULL,
  rights        VARCHAR(50)  NULL,                   -- สิทธิการรักษา
  sex           ENUM('ชาย','หญิง') NULL,
  age           TINYINT UNSIGNED NULL,
  address       VARCHAR(200) NULL,                   -- บ้านเลขที่/หมู่
  area          VARCHAR(100) NULL,                   -- ตำบล/พื้นที่
  unit_id       SMALLINT UNSIGNED NULL,              -- รพ.สต.รับผิดชอบ
  phone         VARCHAR(30)  NULL,
  lat           DECIMAL(9,6) NULL,
  lng           DECIMAL(9,6) NULL,
  comorbid      VARCHAR(200) NULL,                   -- โรคร่วม (U/D)
  hiv           VARCHAR(20)  NULL,                   -- ลบ / บวก / ไม่ได้ตรวจ
  patient_type  VARCHAR(40)  NULL,                   -- NEW / Relapse / Transfer in / ...
  reg_place     VARCHAR(100) NULL,
  diag_basis    VARCHAR(200) NULL,                   -- วิธีวินิจฉัย/ผล เช่น 'AFB 1+, sputum c/s, CXR'
  rr            VARCHAR(40)  NULL,                   -- ผลดื้อ Rifampicin
  diag_date     DATE NULL,
  start_date    DATE NULL,
  regimen       VARCHAR(100) NULL,                   -- datalist ให้พิมพ์เองได้ จึงไม่ใช้ ENUM
  admit_date    DATE NULL,
  dc_date       DATE NULL,
  lft           VARCHAR(300) NULL,
  -- ผลติดตามระหว่างรักษา (เดิม m2Cxr/m2Afb/m5Afb/m6Cxr/m6Afb) ย้ายไป tb_treatment_followups
  outcome      VARCHAR(30) NOT NULL DEFAULT 'กำลังรักษา',
  outcome_date  DATE NULL,
  notes         TEXT NULL,
  version       INT UNSIGNED NOT NULL DEFAULT 1,     -- optimistic lock แทน LockService
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    INT UNSIGNED NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL,                       -- soft delete แทน deleteRow
  CONSTRAINT fk_pat_unit    FOREIGN KEY (unit_id)    REFERENCES tb_units(id),
  CONSTRAINT fk_pat_created FOREIGN KEY (created_by) REFERENCES tb_users(id),
  CONSTRAINT fk_pat_updated FOREIGN KEY (updated_by) REFERENCES tb_users(id),
  CONSTRAINT chk_pat_cid CHECK (cid IS NULL OR cid REGEXP '^[0-9]{13}$'),
  KEY idx_pat_fy (fy, deleted_at),
  KEY idx_pat_hn (hn),
  KEY idx_pat_cid (cid),
  KEY idx_pat_unit (unit_id),
  KEY idx_pat_outcome (outcome)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ผู้สัมผัส เดิม DB_Contacts
-- ตัด fy / indexHn ที่ซ้ำออก (join จาก tb_patients แทน ไม่ต้อง sync เองอีก)
-- ---------------------------------------------------------------------
CREATE TABLE tb_contacts (
  id              VARCHAR(16) PRIMARY KEY,
  patient_id      VARCHAR(16) NOT NULL,              -- index case
  name            VARCHAR(150) NOT NULL,
  cid             CHAR(13) NULL,
  hn              VARCHAR(12) NULL,
  sex             ENUM('ชาย','หญิง') NULL,
  age             TINYINT UNSIGNED NULL,
  relation        VARCHAR(50) NULL,
  contact_type    ENUM('household','close') NOT NULL, -- คลินิกติดตามแค่ 2 กลุ่ม: ร่วมบ้าน / ใกล้ชิด
  ring            TINYINT UNSIGNED NULL,             -- 1 / 2 / 3 (เก็บไว้ ยังไม่ตัด รอเจ้าของงานยืนยัน)
  unit_id         SMALLINT UNSIGNED NOT NULL,        -- รพ.สต.รับผิดชอบ = ขอบเขตสิทธิ์ของผู้ใช้ unit
  address         VARCHAR(200) NULL,                 -- ที่อยู่ตามทะเบียนบ้าน
  current_address VARCHAR(200) NULL,                 -- ใหม่: ที่อยู่ปัจจุบัน (อยู่จริง ใช้ลงเยี่ยม)
  phone           VARCHAR(30) NULL,                  -- ต้องแสดงในฟอร์ม/การ์ด/รายการ
  tb_treat_place  VARCHAR(150) NULL,                 -- ใหม่: ถ้าป่วย TB รักษาที่ไหน (ใช้เมื่อไม่ได้ลงทะเบียนที่ รพ. เรา)
  risk            VARCHAR(100) NULL,
  -- A สอบสวน
  invest_date     DATE NULL,
  -- B คัดกรอง
  screen_date     DATE NULL,
  symptom         VARCHAR(40) NULL,
  cxr_date        DATE NULL,
  cxr_result      VARCHAR(40) NULL,
  screen_result   VARCHAR(30) NULL,                  -- รอผล / ไม่ป่วย / ส่งตรวจเพิ่ม / ป่วยเป็นวัณโรค
  new_patient_id  VARCHAR(16) NULL,                  -- ผู้สัมผัสที่ป่วย → ผู้ป่วยรายใหม่
  -- C TPT
  tpt_eligible    VARCHAR(10) NULL,
  tpt_regimen     VARCHAR(20) NULL,
  tpt_start       DATE NULL,
  tpt_end         DATE NULL,
  tpt_status      VARCHAR(40) NULL,
  -- D ติดตาม 2 ปี (ร่วมบ้าน 6/12/18/24 ด., ใกล้ชิด 12/24 ด.)
  fu6_date        DATE NULL,  fu6_result  VARCHAR(40) NULL,
  fu12_date       DATE NULL,  fu12_result VARCHAR(40) NULL,
  fu18_date       DATE NULL,  fu18_result VARCHAR(40) NULL,
  fu24_date       DATE NULL,  fu24_result VARCHAR(40) NULL,
  notes           TEXT NULL,
  version         INT UNSIGNED NOT NULL DEFAULT 1,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by      INT UNSIGNED NULL,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  CONSTRAINT fk_con_patient FOREIGN KEY (patient_id)     REFERENCES tb_patients(id),
  CONSTRAINT fk_con_newpat  FOREIGN KEY (new_patient_id) REFERENCES tb_patients(id),
  CONSTRAINT fk_con_unit    FOREIGN KEY (unit_id)        REFERENCES tb_units(id),
  CONSTRAINT fk_con_created FOREIGN KEY (created_by)     REFERENCES tb_users(id),
  CONSTRAINT fk_con_updated FOREIGN KEY (updated_by)     REFERENCES tb_users(id),
  CONSTRAINT chk_con_cid CHECK (cid IS NULL OR cid REGEXP '^[0-9]{13}$'),
  KEY idx_con_patient (patient_id, deleted_at),
  KEY idx_con_unit (unit_id, deleted_at),
  KEY idx_con_cid (cid)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ติดตามระหว่างรักษา (หมวด 4) สูงสุด 12 ช่องต่อผู้ป่วย
-- 5 ช่องแรกเป็นค่าเริ่มต้น (เดือน 2 CXR, 2 AFB, 5 AFB, 6 CXR, 6 AFB) กด "+ เพิ่มเติม" ได้ถึง 12
-- ---------------------------------------------------------------------
CREATE TABLE tb_treatment_followups (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id  VARCHAR(16) NOT NULL,
  slot        TINYINT UNSIGNED NOT NULL,             -- 1..12 ลำดับที่แสดงในฟอร์ม
  month_no    TINYINT UNSIGNED NOT NULL,             -- เดือนที่ของการรักษา 0..24
  test        ENUM('CXR','AFB','Xpert','culture','LFT','other') NOT NULL,
  test_date   DATE NULL,
  result      VARCHAR(100) NULL,                     -- NEG / Scanty / 1+ / normal / abnormal / ...
  note        VARCHAR(300) NULL,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fu_patient FOREIGN KEY (patient_id) REFERENCES tb_patients(id),
  CONSTRAINT fk_fu_updated FOREIGN KEY (updated_by) REFERENCES tb_users(id),
  CONSTRAINT chk_fu_slot CHECK (slot BETWEEN 1 AND 12),
  UNIQUE KEY uq_fu_slot (patient_id, slot),
  KEY idx_fu_patient (patient_id, month_no)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- บันทึกการรักษา/ติดตามรายครั้ง เดิม DB_Visits (refId ขึ้นต้น P หรือ C)
-- แยกเป็น FK สองช่อง ให้ DB บังคับความถูกต้องได้ ต้องมีอย่างใดอย่างหนึ่ง
-- ---------------------------------------------------------------------
CREATE TABLE tb_visits (
  id          VARCHAR(16) PRIMARY KEY,
  patient_id  VARCHAR(16) NULL,
  contact_id  VARCHAR(16) NULL,
  visit_date  DATE NOT NULL,
  visit_type  VARCHAR(50) NOT NULL,                  -- DOT / เยี่ยมบ้าน / รับยา / ...
  detail      TEXT NULL,
  next_appt   DATE NULL,
  lat         DECIMAL(9,6) NULL,                     -- ใหม่: พิกัด GPS ตอนบันทึกนอกพื้นที่
  lng         DECIMAL(9,6) NULL,
  client_uuid CHAR(36) NULL UNIQUE,                  -- ใหม่: กันบันทึกซ้ำเมื่อส่งร่างออฟไลน์ซ้ำ
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME NULL,
  CONSTRAINT fk_vis_patient FOREIGN KEY (patient_id) REFERENCES tb_patients(id),
  CONSTRAINT fk_vis_contact FOREIGN KEY (contact_id) REFERENCES tb_contacts(id),
  CONSTRAINT fk_vis_created FOREIGN KEY (created_by) REFERENCES tb_users(id),
  CONSTRAINT fk_vis_updated FOREIGN KEY (updated_by) REFERENCES tb_users(id),
  CONSTRAINT chk_vis_ref CHECK ((patient_id IS NULL) <> (contact_id IS NULL)),
  KEY idx_vis_patient (patient_id, visit_date),
  KEY idx_vis_contact (contact_id, visit_date),
  KEY idx_vis_appt (next_appt)                       -- สำหรับแจ้งเตือนนัด 07:00
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ประวัติการแก้ไข เดิม DB_Log (เก็บ diff เป็น JSON แทนข้อความต่อกัน)
-- ---------------------------------------------------------------------
CREATE TABLE tb_audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id     INT UNSIGNED NULL,                     -- NULL = ระบบ/ย้ายข้อมูล
  action      VARCHAR(20) NOT NULL,                  -- login / add / save / delete / import / migrate / settings
  entity      ENUM('patient','contact','visit','settings','user','system') NOT NULL,
  entity_id   VARCHAR(16) NULL,
  patient_id  VARCHAR(16) NULL,                      -- รวมประวัติของผู้ป่วยรายเดียวได้ query เดียว
  changes     JSON NULL,                             -- {"field": ["เดิม","ใหม่"], ...}
  ip          VARCHAR(45) NULL,
  KEY idx_log_entity (entity, entity_id, at),
  KEY idx_log_patient (patient_id, at),
  KEY idx_log_user (user_id, at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ค่าตั้งเป้าหมาย เดิม DB_Settings (LINE token ย้ายไป env ห้ามเก็บใน DB)
-- ---------------------------------------------------------------------
CREATE TABLE tb_settings (
  k           VARCHAR(50) PRIMARY KEY,               -- target_cases_2570, coverage_target, reminder_emails ...
  v           VARCHAR(1000) NOT NULL DEFAULT '',
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- เป้าหมายรายตัวชี้วัด ตั้งเองได้ แยกปีงบ + ไตรมาส (แทน key target_* ใน tb_settings)
-- quarter: 0 = ทั้งปีงบ, 1 = ต.ค.–ธ.ค., 2 = ม.ค.–มี.ค., 3 = เม.ย.–มิ.ย., 4 = ก.ค.–ก.ย.
-- ---------------------------------------------------------------------
CREATE TABLE tb_targets (
  fy          SMALLINT UNSIGNED NOT NULL,
  quarter     TINYINT UNSIGNED NOT NULL,
  indicator   VARCHAR(40) NOT NULL,                  -- case_finding / coverage / success_rate / death_rate / ...
  target      DECIMAL(8,2) NOT NULL,                 -- ค่า B ในการแสดงผล A/B
  unit        ENUM('cases','percent') NOT NULL,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (fy, quarter, indicator),
  CONSTRAINT chk_tg_q CHECK (quarter BETWEEN 0 AND 4),
  CONSTRAINT fk_tg_updated FOREIGN KEY (updated_by) REFERENCES tb_users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Outbox: งานส่งข้อมูลไป Google Sheet (MySQL → Sheet ทางเดียว)
-- INSERT ใน transaction เดียวกับการบันทึกข้อมูลเสมอ
-- ---------------------------------------------------------------------
CREATE TABLE tb_sheet_outbox (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity      ENUM('patient','contact','visit','followup') NOT NULL,
  entity_id   VARCHAR(16) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME NULL,
  attempts    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_try_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error  VARCHAR(500) NULL,
  KEY idx_outbox_pending (sent_at, next_try_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้น: หน่วยบริการ (ผู้ใช้สร้างผ่านหน้า admin พร้อม hash รหัสผ่าน)
-- ---------------------------------------------------------------------
INSERT INTO tb_units (name, role) VALUES
  ('รพ.พลับพลาชัย', 'admin'),
  ('รพ.สต.ตาพระ', 'unit'),
  ('รพ.สต.ป่าชัน', 'unit'),
  ('รพ.สต.จันดุม', 'unit'),
  ('รพ.สต.โคกเจริญ', 'unit'),
  ('รพ.สต.สำโรง', 'unit'),
  ('รพ.สต.โคกขมิ้น', 'unit');

