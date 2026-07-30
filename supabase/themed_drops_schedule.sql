-- =====================================================================
-- Themed Drops — daily scheduler tick (pg_cron + pg_net)
-- =====================================================================
-- RUN MANUALLY once, after deploying the Edge Function. Nothing here runs
-- on its own.
--
-- ── What this job is NOT ────────────────────────────────────────────────
-- It is NOT what makes the drop change at midnight.
--
-- The obvious design is a cron entry firing at 00:00 Thursday to flip the
-- weekend drop on. That would make the product's headline promise depend
-- on a scheduler being punctual, and it fails visibly — an empty Explore —
-- whenever a run is late, slow, or errors.
--
-- Instead public.drop_schedule tiles the timeline with non-overlapping
-- windows and get_active_themed_drop() resolves "live" as the window
-- containing now(). The Thu/Mon 00:00 swap is therefore exact to the
-- second and executes no code at all.
--
-- ── What this job IS ────────────────────────────────────────────────────
-- The thing that keeps the calendar AHEAD of the clock:
--   • extends drop_schedule 4 weeks forward
--   • refreshes the candidate pool from IGDB when stale (>3 days)
--   • pre-selects games for every window in the next 12 days
--
-- Because it works ~12 days ahead (3-4 windows), the job can fail for over
-- a week before any user notices. Time of day is therefore irrelevant;
-- 03:41 UTC is simply off-peak and away from taste-engine-daily at 04:17
-- so the two never contend for the IGDB rate ceiling.
--
-- Prerequisites (done at deploy time, NOT committed with real values):
--   1. Run supabase/migrations/20260730140000_themed_drops.sql
--   2. Deploy the function:   supabase functions deploy themed-drops
--   3. Reuse the existing shared secret (same one taste-engine uses):
--        supabase secrets set ENGINE_SECRET=<value>
--        select vault.create_secret('<value>', 'taste_engine_secret');
--      If the Vault secret already exists from taste-engine, skip step 3.
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'themed-drops-daily') THEN
    PERFORM cron.unschedule('themed-drops-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'themed-drops-daily',
  '41 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kxypykesyicetabrksfs.supabase.co/functions/v1/themed-drops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'taste_engine_secret' LIMIT 1)
    ),
    body := jsonb_build_object('trigger', 'cron', 'action', 'tick'),
    timeout_milliseconds := 280000
  );
  $$
);
