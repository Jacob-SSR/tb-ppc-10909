-- รายละเอียดนัดในฐาน ppc_tb เท่านั้น ไม่แก้ schema หรือเขียนข้อมูล HOSxP
ALTER TABLE tb_appointments
  ADD COLUMN appt_time_end TIME NULL AFTER appt_time,
  ADD COLUMN department VARCHAR(150) NULL AFTER place,
  ADD COLUMN contact_point VARCHAR(150) NULL AFTER department,
  ADD COLUMN instructions TEXT NULL AFTER note,
  ADD COLUMN telemed TINYINT(1) NOT NULL DEFAULT 0 AFTER instructions;
