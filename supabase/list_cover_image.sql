-- ────────────────────────────────────────────────────────────────────────────
-- List custom cover image — migration
-- Run this once in the Supabase SQL editor (dashboard → SQL Editor → New query)
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Add column (idempotent)
ALTER TABLE lists ADD COLUMN IF NOT EXISTS cover_image_url text;

-- 2. Create the storage bucket for list cover images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'list-covers',
  'list-covers',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policies
--    Each policy is dropped and recreated so the script is safely re-runnable.

DROP POLICY IF EXISTS "list-covers: public read"   ON storage.objects;
DROP POLICY IF EXISTS "list-covers: owner insert"  ON storage.objects;
DROP POLICY IF EXISTS "list-covers: owner update"  ON storage.objects;
DROP POLICY IF EXISTS "list-covers: owner delete"  ON storage.objects;

-- Allow anyone to read files in this bucket (covers are public)
CREATE POLICY "list-covers: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'list-covers');

-- Authenticated users may only upload under their own user-id folder
CREATE POLICY "list-covers: owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'list-covers'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "list-covers: owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'list-covers'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "list-covers: owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'list-covers'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
