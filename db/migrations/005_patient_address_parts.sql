-- 005: ที่อยู่ผู้ป่วยแยก อำเภอ / จังหวัด / รหัสไปรษณีย์ (เดิมมีแค่ บ้านเลขที่/หมู่ + ตำบล/พื้นที่) — HOSxP เติมให้ได้
ALTER TABLE tb_patients
  ADD COLUMN amphoe   VARCHAR(100) NULL AFTER area,
  ADD COLUMN province VARCHAR(100) NULL AFTER amphoe,
  ADD COLUMN postcode CHAR(5)      NULL AFTER province;
