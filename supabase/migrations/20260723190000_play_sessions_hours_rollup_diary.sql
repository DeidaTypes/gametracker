-- Migration: play_sessions_hours_rollup_diary
--
-- Context (see DIAGNOSE notes in the F-sessions PR description):
--   `play_sessions` ALREADY EXISTS in this project (created by
--   add_play_sessions / play_sessions_add_game_meta /
--   play_sessions_public_read_for_following_feed — applied directly,
--   not tracked in this repo's migrations/ folder). It is a live table
--   with real rows, used by the timer (start/stop) flow AND the manual
--   "log a session" flow. Its existing shape is:
--     id, user_id, igdb_game_id, started_at, ended_at, seconds, note,
--     created_at, game_title, game_image, played_on
--   i.e. duration is stored in `seconds`, not `hours`, and the free-text
--   note column is called `note` (singular), not `notes`.
--
-- Rather than DROP/CREATE (which would destroy the 10 existing rows and
-- break the timer + following-feed features), this migration ADDS the
-- `hours` column additively and reuses the existing `note` column for
-- the diary-note text. `hours` becomes the canonical field the new
-- `logSession()` service writes; `seconds` is kept in sync for legacy
-- readers (getSessionsFromFollowing, getManualSessionsForGame) so no
-- other screen needs to change.
--
-- Playtime rollup (game_trackers.hours_played) moves from client-side
-- read-then-write (prone to races/double-counting) to a single
-- transactional DB trigger keyed off `hours`, per the task's "one write
-- path, no double-counting, no drift" requirement.

-- ── 1. Additive schema change ────────────────────────────────────────────
alter table public.play_sessions
  add column if not exists hours numeric(6, 2);

alter table public.play_sessions
  add constraint play_sessions_hours_nonnegative
  check (hours is null or hours >= 0) not valid;

alter table public.play_sessions
  validate constraint play_sessions_hours_nonnegative;

comment on column public.play_sessions.hours is
  'Canonical session duration in hours (numeric). Populated by logSession()/stopSession() going forward; backfilled once below from legacy `seconds` rows. Drives the hours_played rollup trigger — never compute hours_played client-side.';

-- One-time backfill for pre-existing rows (BEFORE the trigger exists below,
-- so this UPDATE does not itself fire a rollup and double-count hours that
-- were already applied to game_trackers by the old client-side logic).
update public.play_sessions
set hours = round(seconds / 3600.0, 2)
where hours is null
  and seconds is not null;

-- ── 2. RLS: bring the follower-read policy in line with the
--    activity_privacy-aware pattern already used by game_trackers /
--    activity_events ("own read/write; readable by followers if
--    activity privacy allows").
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists "users can read followed completed play_sessions" on public.play_sessions;
drop policy if exists "users can read followed completed play sessions" on public.play_sessions;

create policy play_sessions_select_visible_to_followers
on public.play_sessions
for select
using (
  auth.uid() = user_id
  or (
    ended_at is not null
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = play_sessions.user_id)
         or (b.blocker_id = play_sessions.user_id and b.blocked_id = auth.uid())
    )
    and exists (
      select 1 from public.users u
      where u.id = play_sessions.user_id
        and (
          u.activity_privacy = 'everyone'::activity_privacy_level
          or (
            u.activity_privacy = 'followers'::activity_privacy_level
            and exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
                and f.followee_id = play_sessions.user_id
            )
          )
        )
    )
  )
);

-- Existing "own manage all" + "own select/insert/delete" policies are left
-- untouched — they already satisfy "own read/write" and are strictly
-- narrower than (thus compatible with) the new follower-read policy above.

-- ── 3. Playtime rollup trigger ───────────────────────────────────────────
-- Single write path for game_trackers.hours_played driven by play_sessions
-- INSERT / UPDATE(hours) / DELETE. Runs inside the same transaction as the
-- session write, so concurrent logs (e.g. "2h" then "3h" back-to-back)
-- never race the way a client-side read-hours-then-write-hours pattern can.
create or replace function public.fn_play_sessions_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
  v_game_id bigint := coalesce(new.igdb_game_id, old.igdb_game_id);
  v_delta numeric;
  v_updated int;
begin
  if tg_op = 'INSERT' then
    v_delta := coalesce(new.hours, 0);
  elsif tg_op = 'UPDATE' then
    v_delta := coalesce(new.hours, 0) - coalesce(old.hours, 0);
  else -- DELETE
    v_delta := -coalesce(old.hours, 0);
  end if;

  if v_delta = 0 then
    return coalesce(new, old);
  end if;

  update public.game_trackers
  set hours_played = greatest(0, coalesce(hours_played, 0) + v_delta),
      updated_at = now()
  where user_id = v_user_id
    and igdb_game_id = v_game_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 and v_delta > 0 then
    -- No tracker row yet for this game (e.g. logging a session before ever
    -- setting a status) — create one so the session isn't silently lost.
    insert into public.game_trackers (user_id, igdb_game_id, status, hours_played, game_title, game_image)
    values (
      v_user_id,
      v_game_id,
      'playing',
      greatest(0, v_delta),
      coalesce(new.game_title, old.game_title),
      coalesce(new.game_image, old.game_image)
    )
    on conflict (user_id, igdb_game_id) do update
      set hours_played = greatest(0, coalesce(public.game_trackers.hours_played, 0) + excluded.hours_played),
          updated_at = now();
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_play_sessions_rollup on public.play_sessions;

create trigger trg_play_sessions_rollup
after insert or update of hours or delete on public.play_sessions
for each row
execute function public.fn_play_sessions_rollup();

-- Trigger functions have no legitimate direct caller — only Postgres
-- itself (via the trigger) should ever invoke this. Revoke the RPC
-- surface PostgREST would otherwise expose by default.
revoke execute on function public.fn_play_sessions_rollup() from anon, authenticated;
