-- 004: ที่อยู่ปัจจุบันของผู้ป่วย (อยู่จริง ใช้ลงเยี่ยม) แยกจากที่อยู่ตามทะเบียน — แบบเดียวกับ tb_contacts.current_address
ALTER TABLE tb_patients
  ADD COLUMN current_address VARCHAR(200) NULL AFTER area;
