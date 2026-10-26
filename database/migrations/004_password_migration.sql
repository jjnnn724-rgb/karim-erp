-- =====================================================
-- Migration 004: Password Migration Tracking
-- Adds password_migrated_at column to users table
-- for tracking plaintext → bcrypt migration status
-- =====================================================

-- Add password_migrated_at column (nullable, defaults to NULL)
-- NULL means password hasn't been migrated yet (still plaintext)
-- TIMESTAMP value means when it was migrated to bcrypt
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'password_migrated_at'
    ) THEN
        ALTER TABLE users 
        ADD COLUMN password_migrated_at TIMESTAMP;
        
        RAISE NOTICE '✅ Column password_migrated_at added to users table';
    ELSE
        RAISE NOTICE 'ℹ Column password_migrated_at already exists in users table';
    END IF;
END $$;

-- Create index for querying unmigrated users (for deprecation timeline)
CREATE INDEX IF NOT EXISTS idx_users_password_not_migrated 
ON users (id) 
WHERE password_migrated_at IS NULL;

-- =====================================================
-- Migration Verification Query:
--   SELECT id, username, 
--          CASE WHEN password LIKE '$2$%' THEN 'bcrypt' ELSE 'plaintext' END as password_type,
--          password_migrated_at 
--   FROM users;
-- =====================================================
