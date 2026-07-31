-- =====================================================================
-- New & Notable — daily refresh tick (pg_cron + pg_net)
-- =====================================================================
-- RUN MANUALLY once, after deploying the Edge Function. Nothing here runs
-- on its own.
--
-- Keeps public.new_notable_pool ahead of the clock: re-fetches the
-- recently-RELEASED window from IGDB, re-classifies every game into one of
-- the two notability lanes (or drops it if it clears neither), re-curates the
-- rail, and prunes anything that fell out. Explore never touches IGDB
-- directly — see src/services/newNotableService.js.
--
-- The daily tick is also what keeps the release gate honest as the clock
-- moves: a game whose release date has passed since yesterday becomes
-- eligible, and nothing scheduled for the future is ever fetched.
--
-- Time of day: 02:10 UTC, deliberately spaced from the other two daily
-- jobs sharing the IGDB rate ceiling (taste-engine-daily 04:17,
-- themed-drops-daily 03:41) so no two ever contend for it.
--
-- Prerequisites (done at deploy time, NOT committed with real values):
--   1. Run supabase/migrations/20260730160000_new_notable.sql, then
--      supabase/migrations/20260731110000_new_notable_released_only.sql
--   2. Deploy the function:   supabase functions deploy new-notable
--   3. Reuse the existing shared secret (same one taste-engine /
--      themed-drops use) — no new secret needed if ENGINE_SECRET is
--      already set.
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'new-notable-daily') THEN
    PERFORM cron.unschedule('new-notable-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'new-notable-daily',
  '10 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kxypykesyicetabrksfs.supabase.co/functions/v1/new-notable',
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
