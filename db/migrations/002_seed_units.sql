-- 002_seed_units.sql — หน่วยบริการ 7 แห่ง (ชื่อตรงกับหน่วยใน DB_Users เดิม ใช้แม็ปตอน import)
-- ไม่มี PIN/บัญชีผู้ใช้ — บัญชีสร้างใหม่รายคนใน Phase 2

INSERT INTO tb_units (name, role, sort_order) VALUES
  ('รพ.พลับพลาชัย',  'admin', 0),
  ('รพ.สต.ตาพระ',    'unit',  1),
  ('รพ.สต.ป่าชัน',    'unit',  2),
  ('รพ.สต.จันดุม',    'unit',  3),
  ('รพ.สต.โคกเจริญ', 'unit',  4),
  ('รพ.สต.สำโรง',    'unit',  5),
  ('รพ.สต.โคกขมิ้น',  'unit',  6)
ON DUPLICATE KEY UPDATE role = VALUES(role), sort_order = VALUES(sort_order);
