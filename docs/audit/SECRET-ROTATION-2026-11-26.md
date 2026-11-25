# Secret rotation - 2026-11-26

Values are deliberately NOT recorded. Generated with CSPRNG (32 bytes, hex).
Rotated keys: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_SECRET, API_KEY, VAULT_KEY, EMPLOYEE_QR_SECRET, KARIM_BACKUP_PASSPHRASE, KARIM_FIXED_ADMIN_PASSWORD, METRICS_API_KEY, HEALTH_TOKEN
Excluded (external/coordinated): DB_PASSWORD, DB_ADMIN_PASSWORD, YARASOFT_ORACLE_PASSWORD, SMTP_PASS, GEMINI_API_KEY, ZATCA keys.

Files processed:
- karim-erp-phase5-8\.env :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY,VAULT_KEY,KARIM_BACKUP_PASSPHRASE
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\.env :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY,VAULT_KEY,KARIM_BACKUP_PASSPHRASE
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\docker-deploy\.env :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY,KARIM_FIXED_ADMIN_PASSWORD
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\database\backups\secret-rollback\.env.2026-10-20T22-05-31.bak :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY,KARIM_FIXED_ADMIN_PASSWORD,VAULT_KEY
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\database\backups\secret-rollback\.env.2026-10-20T22-07-17.bak :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY,KARIM_FIXED_ADMIN_PASSWORD,VAULT_KEY
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp-backup-pre-v71\.env :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET,API_KEY
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp-backup-pre-v71\.env.backup-before-karim-rebrand :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET
- karimabdelhamedeldsouky\karimabdelhamed12\karim-erp-backup-pre-v71\.env.preflight-backup-2026-09-21T21-49-18-801Z :: JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,EMPLOYEE_QR_SECRET
