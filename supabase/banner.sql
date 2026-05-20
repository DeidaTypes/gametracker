-- Add profile banner URL column to the users table.
-- The existing users RLS policy already covers updates to own row, so no
-- additional policy change is needed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url text;
