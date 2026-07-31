-- Escalating year-long challenge tiers for user_goals.
--
-- The yearly game-count challenge used to be a single flat target for
-- the whole year. It now escalates: reaching the current tier's target
-- climbs the goal by +15 for the next tier (15 -> 30 -> 45 -> ...) and
-- keeps climbing through the year, with a one in-app-day celebration
-- before auto-advancing (see goalService.resolveTierState). These
-- columns let tier state survive app restarts/devices instead of
-- living only in memory.
--
--   tier            — current tier number, starts at 1.
--   tier_base       — the cumulative-games threshold where this tier
--                      started (0 for tier 1, the previous tier's
--                      target after that); progress within the tier
--                      is `current - tier_base`.
--   goal_reached_at — local calendar date (YYYY-MM-DD) the current
--                      tier's target was first reached; NULL while
--                      still in progress. Comparing this against
--                      "today" drives the one-day celebration and the
--                      next-app-day auto-advance in goalService.

alter table public.user_goals
  add column if not exists tier smallint not null default 1,
  add column if not exists tier_base integer not null default 0,
  add column if not exists goal_reached_at date;

alter table public.user_goals
  add constraint user_goals_tier_check check (tier >= 1),
  add constraint user_goals_tier_base_check check (tier_base >= 0);

comment on column public.user_goals.tier is
  'Current escalating-challenge tier (1 = original goal, climbs +15 per tier).';
comment on column public.user_goals.tier_base is
  'Cumulative games-finished threshold where the current tier started.';
comment on column public.user_goals.goal_reached_at is
  'Local date the current tier''s target was first reached; drives the one-day celebration and next-day auto-advance.';
