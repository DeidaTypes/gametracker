-- =====================================================================
-- Drop hidden gems — replaced by "Your Gaming Map"
-- =====================================================================
-- Hidden Gems is being removed from Discover ahead of the new "Your
-- Gaming Map" feature. The taste-engine Edge Function no longer writes
-- to this table (see supabase/functions/taste-engine/index.ts), and no
-- client code reads from it anymore.
--
-- CASCADE takes its RLS policies and index with it. Nothing else in the
-- schema references this table — get_taste_match / get_user_taste_vector
-- read only from user_taste_vectors, which this migration does not touch.
-- =====================================================================

DROP TABLE IF EXISTS public.user_hidden_gems CASCADE;
