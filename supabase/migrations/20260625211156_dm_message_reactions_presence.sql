-- =====================================================================
-- Sprint 8 — DM context, reactions (F3), and presence (F1)
-- =====================================================================
-- Adds 'dm_message' to the reaction_target_type enum so emoji reactions
-- can be persisted on direct message bubbles.
--
-- No new tables required:
--   • Reactions:  existing `reactions` table + RLS already supports
--     arbitrary authenticated users reacting; adding the enum value is
--     the only schema change needed.
--   • Presence:   Supabase Realtime presence channel (client-side only,
--     no DB objects required).
--   • Shared-game context: reads existing `game_trackers` table.
-- =====================================================================

ALTER TYPE reaction_target_type ADD VALUE IF NOT EXISTS 'dm_message';
