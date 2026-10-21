#!/bin/bash
# รันครั้งเดียวตอน volume tb_mysql ยังว่าง (docker-entrypoint-initdb.d)
# สร้างแค่ฐานข้อมูล + บัญชี — schema สร้างด้วย `npm run migrate` เท่านั้น
#
#   tb_app      แอป: SELECT, INSERT, UPDATE บน ppc_tb.* (+ DELETE tb_settings ให้ใน 001_init.sql)
#   tb_migrate  migration: DDL บน ppc_tb.* + GRANT OPTION (เพื่อให้สิทธิ์ระดับตารางแก่ tb_app)
#
# ห้ามใช้ MYSQL_USER/MYSQL_PASSWORD ของ image — บัญชีนั้นได้ ALL PRIVILEGES
set -euo pipefail

: "${TB_APP_PASSWORD:?ต้องตั้ง TB_APP_PASSWORD}"
: "${TB_MIGRATE_PASSWORD:?ต้องตั้ง TB_MIGRATE_PASSWORD}"

# escape ' ในรหัสผ่านสำหรับ SQL string literal
sql_quote() { printf "%s" "${1//\'/\'\'}"; }
APP_PW=$(sql_quote "$TB_APP_PASSWORD")
MIG_PW=$(sql_quote "$TB_MIGRATE_PASSWORD")

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS ppc_tb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'tb_app'@'%' IDENTIFIED BY '${APP_PW}';
GRANT SELECT, INSERT, UPDATE ON ppc_tb.* TO 'tb_app'@'%';

CREATE USER IF NOT EXISTS 'tb_migrate'@'%' IDENTIFIED BY '${MIG_PW}';
GRANT ALL PRIVILEGES ON ppc_tb.* TO 'tb_migrate'@'%' WITH GRANT OPTION;

FLUSH PRIVILEGES;
SQL

echo "[init] สร้างฐานข้อมูล ppc_tb + บัญชี tb_app / tb_migrate แล้ว"
