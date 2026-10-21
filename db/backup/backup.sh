#!/bin/bash
# db/backup/backup.sh — backup ppc_tb ทุกคืน (service "backup" ใน docker-compose.yml)
#
#   mysqldump --single-transaction (ไม่ล็อกตาราง ระบบใช้งานต่อได้ระหว่าง backup)
#   → gzip → ตรวจไฟล์ (gzip -t) → /backups/ppc_tb-YYYYMMDD-HHMM.sql.gz + .sha256
#   → ลบไฟล์เก่ากว่า BACKUP_KEEP_DAYS (ค่าเริ่มต้น 30 วัน)
#
# /backups ควร mount ไปที่ปลายทาง "นอกเครื่อง .58" (NAS/แชร์ไดรฟ์) ผ่าน BACKUP_DIR — ดู README
#   docker compose run --rm backup now     backup ทันที (ทดสอบ / ก่อน cutover)
set -euo pipefail

: "${MYSQL_ROOT_PASSWORD:?ต้องตั้ง MYSQL_ROOT_PASSWORD}"
DB_HOST="${BACKUP_DB_HOST:-mysql}"
HOUR="${BACKUP_HOUR:-1}"           # ชั่วโมงที่ backup (เวลาไทย) — 01:00 ก่อน rebuild Sheet ตอน 02:00
KEEP="${BACKUP_KEEP_DAYS:-30}"
OUT=/backups

# รหัสผ่านใส่ในไฟล์ (สิทธิ์ 600) ไม่ใส่ใน command line — กันโผล่ใน ps
CNF=$(mktemp)
trap 'rm -f "$CNF"' EXIT
chmod 600 "$CNF"
printf '[client]\nuser=root\npassword=%s\nhost=%s\n' "$MYSQL_ROOT_PASSWORD" "$DB_HOST" > "$CNF"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

run() {
  local ts file tmp
  ts=$(date +%Y%m%d-%H%M)
  file="$OUT/ppc_tb-$ts.sql.gz"
  tmp="$file.part"
  log "เริ่ม backup → $file"
  mysqldump --defaults-extra-file="$CNF" \
    --single-transaction --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 \
    --databases ppc_tb | gzip -9 > "$tmp"
  gzip -t "$tmp"
  # dump ต้องจบสมบูรณ์ (mysqldump เขียนบรรทัดนี้ท้ายไฟล์เมื่อสำเร็จ)
  if ! gzip -dc "$tmp" | tail -n 1 | grep -q "Dump completed"; then
    log "❌ dump ไม่สมบูรณ์ — ไม่เก็บไฟล์นี้"
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$file"
  (cd "$OUT" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  find "$OUT" -maxdepth 1 -name 'ppc_tb-*.sql.gz*' -mtime +"$KEEP" -delete
  log "✓ เสร็จ $(du -h "$file" | cut -f1) — เก็บย้อนหลัง $KEEP วัน ($(ls "$OUT"/ppc_tb-*.sql.gz | wc -l) ไฟล์)"
}

if [ "${1:-}" = "now" ]; then
  run
  exit
fi

log "รอ backup ทุกวันเวลา $(printf '%02d' "$HOUR"):00 (TZ=${TZ:-UTC}) → $OUT"
last=""
while true; do
  today=$(date +%Y-%m-%d)
  if [ "$(date +%-H)" -eq "$HOUR" ] && [ "$last" != "$today" ]; then
    if run; then last="$today"; else log "❌ backup ล้มเหลว จะลองใหม่ใน 10 นาที"; sleep 540; fi
  fi
  sleep 60
done
