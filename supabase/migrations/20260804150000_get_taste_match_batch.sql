-- =====================================================================
-- get_taste_match_batch(user_a uuid, user_bs uuid[])
-- =====================================================================
-- The Discover "Recently" shelf annotates every card with the viewer↔actor
-- taste match. It was calling get_taste_match(viewer, actor) once per
-- distinct actor on the shelf — up to 10 parallel RPCs on a single screen
-- entry, each paying a full PostgREST round-trip plus its own RLS setup.
--
-- This returns every pair in one call, keyed by user_b:
--   { "<uuid>": { ...get_taste_match result... }, ... }
--
-- It delegates to get_taste_match rather than reimplementing the scoring,
-- so the batch path can never drift from the single-pair path — thresholds,
-- the genre/theme blend and the null-below-confidence contract are all
-- whatever that function says they are.
--
-- SECURITY DEFINER for the same reason get_taste_match is: comparing two
-- users' vectors must not require row access to both.
CREATE OR REPLACE FUNCTION public.get_taste_match_batch(user_a uuid, user_bs uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  target uuid;
BEGIN
  IF user_a IS NULL OR user_bs IS NULL THEN
    RETURN result;
  END IF;

  FOREACH target IN ARRAY user_bs LOOP
    IF target IS NOT NULL AND NOT result ? target::text THEN
      result := result || jsonb_build_object(
        target::text,
        public.get_taste_match(user_a, target)
      );
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_taste_match_batch(uuid, uuid[]) TO anon, authenticated;

COMMENT ON FUNCTION public.get_taste_match_batch(uuid, uuid[]) IS
  'Batched get_taste_match: one call for a whole shelf of actors. Returns a jsonb map keyed by user_b id.';
