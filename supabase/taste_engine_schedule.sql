-- =====================================================================
-- Taste Engine — daily refresh schedule (pg_cron + pg_net)
-- =====================================================================
-- PRECOMPUTE + CACHE server-side. The UI reads ONLY from the cache tables
-- (game_tags / user_taste_vectors / user_recommendation_seeds /
-- user_recommendations) — it NEVER queries IGDB per page load. This job
-- refreshes those caches once a day by invoking the `taste-engine` Edge
-- Function, which is the only place IGDB is touched: each user's top
-- 10-15 seeds are resolved + scored via a small bounded number of
-- /multiquery POSTs (~2-3/user, ≤4 req/s, ≤8 concurrent) rather than one
-- round trip per seed — see igdbMulti() in supabase/functions/taste-engine.
--
-- Prerequisites (done at deploy time, NOT committed with real values):
--   1. Deploy the Edge Function:  supabase functions deploy taste-engine
--   2. Set the shared secret:      supabase secrets set ENGINE_SECRET=<value>
--   3. Store the SAME secret in Vault so cron can authenticate:
--        select vault.create_secret('<value>', 'taste_engine_secret');
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

-- Re-scheduling: unschedule any prior job of this name first so re-running
-- this file doesn't create duplicates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taste-engine-daily') THEN
    PERFORM cron.unschedule('taste-engine-daily');
  END IF;
END $$;

-- Daily at 04:17 UTC — an off-peak, non-round minute to avoid colliding
-- with other scheduled work. The function fans out over all users with
-- rating/tracking activity, so a single daily invocation is enough.
SELECT cron.schedule(
  'taste-engine-daily',
  '17 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kxypykesyicetabrksfs.supabase.co/functions/v1/taste-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'taste_engine_secret' LIMIT 1)
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 280000
  );
  $$
);
