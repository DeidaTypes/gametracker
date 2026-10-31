-- Player Level: XP and levels (approved by Ry, Oct 30 2026).
-- Mockups: docs/design/checkpoint_xp_levels.html, docs/design/checkpoint_profile_level.html
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor (project
-- kxypykesyicetabrksfs) and press Run once. It is one transaction:
--   1. A guard checks every table and column it reads. If anything differs it
--      STOPS with "STOP (nothing was changed): ..." and changes nothing.
--   2. Adds users.xp_total / level / level_seen (server-only), the xp_events
--      ledger, the award function and one trigger per thing that earns XP.
--   3. Counts everyone's XP from their history, under the same daily caps.
--   4. Self-test inside the transaction (rolled back): logs a fake session for
--      theantifail and checks it earned 10 XP and moved the total.
--   5. The last grid is theantifail's XP by source. Send it to Claude.
-- Re-running the file is safe (it re-counts history the same way).
--
-- DESIGN
--   - XP is added ON THE SERVER by triggers on the same tables the badges read,
--     so the phone can't fake it. The client only reads.
--   - Every award is once per thing (unique user + source + ref) and quick
--     actions have a daily cap (UTC day). Nothing is ever taken away: deleting a
--     review, a session or a game leaves its XP.
--   - A failing XP award never blocks the write that caused it: each trigger
--     catches its own error and only raises a warning.
--   - Level n starts at 100(n-1) + 25(n-1)(n-2) XP (Level 2 = 100, each level
--     costs 50 more than the last), capped at 50. src/data/levels.js mirrors it.
--   - level_seen = the highest level the app has already shown. NULL for players
--     who existed before this file (the app shows one "You're Level N" card),
--     1 for every new account.
--
-- XP PER ACTION (source, amount, daily cap)
--   session 10 (5) · started 5 (3) · finished 50 (5) · backlog 2 (10)
--   rate 5 (10) · review 25 (3) · journal 15 (3) · list 20 (2)
--   qa_answer 20 (5) · qa_best 50 · qa_ask 10 (3)
--   heart_given 1 (10) · comment 3 (10) · heart_received 2 (20) · follow 2 (5)
--   badge: Easy 50 / Medium 150 / Hard 400 · tier: bronze 100 / silver 250 / gold 600
--     (Kept the Fire earns no tier XP: the streak milestones below already pay it)
--   streak: 3 / 7 / 15 / 30 / 100 days = 25 / 50 / 100 / 200 / 500
--   challenge (yearly goal hit, via Year's Work) 1000
--   Weekly quests arrive with the Locker sprint.

begin;

-- ── 1. Guard ───────────────────────────────────────────────────────────────
do $guard$
declare
  r record;
  v_missing text := '';
begin
  for r in
    select * from (values
      ('users','id'), ('users','username'), ('users','created_at'),
      ('play_sessions','id'), ('play_sessions','user_id'), ('play_sessions','created_at'),
      ('activities','user_id'), ('activities','igdb_game_id'), ('activities','activity_type'),
      ('activities','metadata'), ('activities','created_at'),
      ('activity_events','id'), ('activity_events','actor_user_id'), ('activity_events','type'),
      ('activity_events','entity_id'), ('activity_events','created_at'),
      ('reviews','id'), ('reviews','user_id'), ('reviews','igdb_game_id'), ('reviews','rating'),
      ('reviews','body'), ('reviews','created_at'),
      ('journal_entries','id'), ('journal_entries','user_id'), ('journal_entries','body'),
      ('journal_entries','created_at'),
      ('lists','id'), ('lists','user_id'), ('lists','is_curated'),
      ('list_games','list_id'), ('list_games','added_at'),
      ('qa_questions','id'), ('qa_questions','user_id'), ('qa_questions','best_answer_id'),
      ('qa_questions','best_picked_at'), ('qa_questions','removed_at'), ('qa_questions','created_at'),
      ('qa_answers','id'), ('qa_answers','user_id'), ('qa_answers','question_id'),
      ('qa_answers','removed_at'), ('qa_answers','created_at'),
      ('review_likes','review_id'), ('review_likes','user_id'), ('review_likes','created_at'),
      ('reactions','user_id'), ('reactions','target_type'), ('reactions','target_id'),
      ('reactions','emoji'), ('reactions','created_at'),
      ('review_comments','id'), ('review_comments','user_id'), ('review_comments','review_id'),
      ('review_comments','activity_event_id'), ('review_comments','body'),
      ('review_comments','removed_at'), ('review_comments','created_at'),
      ('list_comments','id'), ('list_comments','user_id'), ('list_comments','list_id'),
      ('list_comments','removed_at'), ('list_comments','created_at'),
      ('follows','follower_id'), ('follows','followee_id'), ('follows','created_at'),
      ('user_badges','user_id'), ('user_badges','badge_id'), ('user_badges','tier'),
      ('user_badges','current_value'), ('user_badges','earned_at'),
      ('user_streak_milestones','user_id'), ('user_streak_milestones','milestone_days'),
      ('user_streak_milestones','reached_at')
    ) as t(tbl, col)
  loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name = r.col
    ) then
      v_missing := v_missing || r.tbl || '.' || r.col || ' ';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'STOP (nothing was changed): missing columns: %. Send Claude this message.', v_missing;
  end if;

  if (select c.data_type from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'reactions' and c.column_name = 'target_id') <> 'text' then
    raise exception 'STOP (nothing was changed): reactions.target_id is not text. Send Claude this message.';
  end if;

  begin
    perform 1 from public.reactions where false and target_type = 'activity';
    perform 1 from public.reactions where false and target_type = 'list';
    perform 1 from public.activity_events where false and type = 'backlogged';
  exception when others then
    raise exception 'STOP (nothing was changed): a reaction / event type is missing (%). Send Claude this message.', sqlerrm;
  end;

  if to_regprocedure('private.badge_tier_rank(text)') is null then
    raise exception 'STOP (nothing was changed): private.badge_tier_rank(text) not found. Send Claude this message.';
  end if;
end;
$guard$;

-- ── 2. Users: total XP, level, last level the app showed ──────────────────
alter table public.users
  add column if not exists xp_total integer not null default 0,
  add column if not exists level smallint not null default 1;
-- No default on the first add: every existing player gets NULL ("never saw
-- their level"), so the app shows them one "You're Level N" card. New accounts
-- start at 1 from here on.
alter table public.users add column if not exists level_seen smallint;
alter table public.users alter column level_seen set default 1;

comment on column public.users.xp_total is 'Player Level XP. Server-only: written by private.award_xp(). Never decreases.';
comment on column public.users.level is 'Player Level 1-50 from xp_total (private.level_for). Server-only.';
comment on column public.users.level_seen is 'Highest level the app has shown this player (acknowledge_my_level). NULL = existed before levels shipped, show the one-time card.';

-- Reads: everyone (visitors see your level). Writes: never from the app.
grant select (xp_total, level, level_seen) on public.users to anon, authenticated;

-- The app has table-level INSERT/UPDATE on users, so a guard keeps these
-- three columns server-only (same pattern as users_plus_guard). It quietly
-- keeps the old values instead of raising, so a profile save never fails.
create or replace function private.users_xp_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.xp_total := 0;
      new.level := 1;
      new.level_seen := 1;
    else
      new.xp_total := old.xp_total;
      new.level := old.level;
      new.level_seen := old.level_seen;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.users_xp_guard() from public, anon, authenticated;
drop trigger if exists users_xp_guard on public.users;
create trigger users_xp_guard before insert or update on public.users
  for each row execute function private.users_xp_guard();

-- ── 3. The ledger ──────────────────────────────────────────────────────────
create table if not exists public.xp_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  source     text not null,
  ref        text not null,
  amount     integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint xp_events_once unique (user_id, source, ref)
);

create index if not exists xp_events_user_created_idx on public.xp_events (user_id, created_at desc);
create index if not exists xp_events_user_source_created_idx on public.xp_events (user_id, source, created_at);

alter table public.xp_events enable row level security;
drop policy if exists xp_events_select_own on public.xp_events;
create policy xp_events_select_own on public.xp_events
  for select to authenticated using (user_id = auth.uid());
revoke all on public.xp_events from anon, authenticated;
grant select on public.xp_events to authenticated;

comment on table public.xp_events is 'Player Level ledger. One row per XP award, once per (user, source, ref). Written only by private.award_xp() (triggers) and the backfill. Readable by its owner.';

-- ── 4. Level math + the award function ─────────────────────────────────────
create or replace function private.level_for(p_xp integer)
returns smallint
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(max(n), 1)::smallint
    from generate_series(1, 50) as n
   where 100 * (n - 1) + 25 * (n - 1) * (n - 2) <= greatest(coalesce(p_xp, 0), 0);
$$;

create or replace function private.award_xp(
  p_user uuid, p_source text, p_ref text, p_amount integer, p_cap integer,
  p_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day timestamptz;
  v_count integer;
  v_id bigint;
begin
  if p_user is null or p_ref is null or coalesce(p_amount, 0) <= 0 then
    return 0;
  end if;
  -- Deleted account (its cascade can fire triggers after the row is gone).
  if not exists (select 1 from public.users u where u.id = p_user) then
    return 0;
  end if;
  if p_cap is not null then
    v_day := date_trunc('day', p_at at time zone 'UTC') at time zone 'UTC';
    select count(*) into v_count
      from public.xp_events e
     where e.user_id = p_user and e.source = p_source
       and e.created_at >= v_day and e.created_at < v_day + interval '1 day';
    if v_count >= p_cap then
      return 0;
    end if;
  end if;

  insert into public.xp_events (user_id, source, ref, amount, created_at)
  values (p_user, p_source, p_ref, p_amount, p_at)
  on conflict on constraint xp_events_once do nothing
  returning id into v_id;

  if v_id is null then
    return 0;
  end if;

  update public.users u
     set xp_total = u.xp_total + p_amount,
         level = private.level_for(u.xp_total + p_amount)
   where u.id = p_user;
  return p_amount;
end;
$$;

revoke all on function private.award_xp(uuid, text, text, integer, integer, timestamptz) from public, anon, authenticated;

-- One-step badge difficulty, by id (src/data/badges.js levels).
create or replace function private.single_badge_xp(p_badge text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_badge = any(array['press-start', 'starter-pack', 'top-four', 'now-playing', 'credits-roll', 'on-the-clock', 'quick-judge', 'hot-take', 'mixtape', 'party-up']) then 50
    when p_badge = any(array['hat-trick', 'speedrun', 'off-the-shelf', 'dear-diary', 'fan-mail', 'good-vibes', 'lifeline', 'second-opinion', 'window-shopper', 'defend-your-picks']) then 150
    when p_badge = any(array['list-cleared', 'hot-month', 'specialist', 'kindred-spirit', 'century', 'fan-favorite', 'report-card', 'century-club', 'retro-run', 'squad-goals']) then 400
    else null
  end;
$$;

-- ── 5. Triggers: one per thing that earns XP ──────────────────────────────
-- Each catches its own error so XP can never block the write that caused it.

create or replace function private.xp_on_play_session()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform private.award_xp(new.user_id, 'session', new.id::text, 10, 5);
  exception when others then
    raise warning 'xp_on_play_session: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_play_session on public.play_sessions;
create trigger xp_on_play_session after insert on public.play_sessions
  for each row execute function private.xp_on_play_session();

-- Status log: Played (finished), Currently Playing (started), Backlog.
create or replace function private.xp_on_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to text := new.metadata->>'to_status';
begin
  begin
    if new.igdb_game_id is not null then
      if v_to = 'played' then
        perform private.award_xp(new.user_id, 'finished', new.igdb_game_id::text, 50, 5);
      elsif v_to = 'currently' then
        perform private.award_xp(new.user_id, 'started', new.igdb_game_id::text, 5, 3);
      elsif v_to = 'want' then
        perform private.award_xp(new.user_id, 'backlog', new.igdb_game_id::text, 2, 10);
      end if;
    end if;
  exception when others then
    raise warning 'xp_on_activity: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_activity on public.activities;
create trigger xp_on_activity after insert on public.activities
  for each row when (new.activity_type = 'status_changed')
  execute function private.xp_on_activity();

-- Quick-add to Backlog writes a 'backlogged' event and skips the status log.
-- Same source and ref as above, so a game is paid once either way.
create or replace function private.xp_on_backlogged_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.entity_id is not null then
      perform private.award_xp(new.actor_user_id, 'backlog', new.entity_id, 2, 10);
    end if;
  exception when others then
    raise warning 'xp_on_backlogged_event: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_backlogged_event on public.activity_events;
create trigger xp_on_backlogged_event after insert on public.activity_events
  for each row when (new.type = 'backlogged')
  execute function private.xp_on_backlogged_event();

-- Rating and review with words, once per game each (also when added by an edit).
create or replace function private.xp_on_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.igdb_game_id is not null then
      if new.rating is not null and new.rating > 0 then
        perform private.award_xp(new.user_id, 'rate', new.igdb_game_id::text, 5, 10);
      end if;
      if new.body is not null and length(trim(new.body)) > 0 then
        perform private.award_xp(new.user_id, 'review', new.igdb_game_id::text, 25, 3);
      end if;
    end if;
  exception when others then
    raise warning 'xp_on_review: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_review on public.reviews;
create trigger xp_on_review after insert or update of rating, body on public.reviews
  for each row execute function private.xp_on_review();

create or replace function private.xp_on_journal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.body is not null and length(trim(new.body)) > 0 then
      perform private.award_xp(new.user_id, 'journal', new.id::text, 15, 3);
    end if;
  exception when others then
    raise warning 'xp_on_journal: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_journal on public.journal_entries;
create trigger xp_on_journal after insert or update of body on public.journal_entries
  for each row execute function private.xp_on_journal();

-- A list you own reaching 3 games (once per list).
create or replace function private.xp_on_list_game()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  begin
    select l.user_id into v_owner
      from public.lists l
     where l.id = new.list_id and coalesce(l.is_curated, false) = false;
    if v_owner is not null
       and (select count(*) from public.list_games lg where lg.list_id = new.list_id) >= 3 then
      perform private.award_xp(v_owner, 'list', new.list_id::text, 20, 2);
    end if;
  exception when others then
    raise warning 'xp_on_list_game: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_list_game on public.list_games;
create trigger xp_on_list_game after insert on public.list_games
  for each row execute function private.xp_on_list_game();

-- Answering someone else's question.
create or replace function private.xp_on_qa_answer()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if exists (
      select 1 from public.qa_questions q
       where q.id = new.question_id and q.user_id is distinct from new.user_id
    ) then
      perform private.award_xp(new.user_id, 'qa_answer', new.id::text, 20, 5);
    end if;
  exception when others then
    raise warning 'xp_on_qa_answer: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_qa_answer on public.qa_answers;
create trigger xp_on_qa_answer after insert on public.qa_answers
  for each row execute function private.xp_on_qa_answer();

-- Asking a question, and your answer picked as the best (to the answerer).
create or replace function private.xp_on_qa_question()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_answerer uuid;
begin
  begin
    if tg_op = 'INSERT' then
      perform private.award_xp(new.user_id, 'qa_ask', new.id::text, 10, 3);
    elsif new.best_answer_id is not null
          and new.best_answer_id is distinct from old.best_answer_id then
      select a.user_id into v_answerer from public.qa_answers a where a.id = new.best_answer_id;
      if v_answerer is not null and v_answerer is distinct from new.user_id then
        perform private.award_xp(v_answerer, 'qa_best', new.best_answer_id::text, 50, null);
      end if;
    end if;
  exception when others then
    raise warning 'xp_on_qa_question: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_qa_question on public.qa_questions;
create trigger xp_on_qa_question after insert or update of best_answer_id on public.qa_questions
  for each row execute function private.xp_on_qa_question();

-- Hearts on reviews: +1 to the giver, +2 to the review's author.
create or replace function private.xp_on_review_like()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  begin
    select r.user_id into v_owner from public.reviews r where r.id = new.review_id;
    if v_owner is not null and v_owner <> new.user_id then
      perform private.award_xp(new.user_id, 'heart_given', 'review:' || new.review_id, 1, 10);
      perform private.award_xp(v_owner, 'heart_received',
        new.user_id || ':review:' || new.review_id, 2, 20);
    end if;
  exception when others then
    raise warning 'xp_on_review_like: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_review_like on public.review_likes;
create trigger xp_on_review_like after insert on public.review_likes
  for each row execute function private.xp_on_review_like();

-- The Pulse heart on posts (activity events) and lists.
create or replace function private.xp_on_reaction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  begin
    if new.emoji not in (E'❤️', E'❤') then
      return null;
    end if;
    if new.target_type = 'activity' then
      select ae.actor_user_id into v_owner from public.activity_events ae where ae.id::text = new.target_id;
    elsif new.target_type = 'list' then
      select l.user_id into v_owner from public.lists l where l.id::text = new.target_id;
    end if;
    if v_owner is not null and v_owner <> new.user_id then
      perform private.award_xp(new.user_id, 'heart_given',
        new.target_type || ':' || new.target_id, 1, 10);
      perform private.award_xp(v_owner, 'heart_received',
        new.user_id || ':' || new.target_type || ':' || new.target_id, 2, 20);
    end if;
  exception when others then
    raise warning 'xp_on_reaction: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_reaction on public.reactions;
create trigger xp_on_reaction after insert on public.reactions
  for each row execute function private.xp_on_reaction();

-- Commenting on someone else's review, Pulse post or list.
create or replace function private.xp_on_review_comment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  begin
    if new.body is null or length(trim(new.body)) = 0 then
      return null;
    end if;
    if new.review_id is not null then
      select r.user_id into v_owner from public.reviews r where r.id = new.review_id;
    elsif new.activity_event_id is not null then
      select ae.actor_user_id into v_owner from public.activity_events ae where ae.id = new.activity_event_id;
    end if;
    if v_owner is not null and v_owner <> new.user_id then
      perform private.award_xp(new.user_id, 'comment', 'rc:' || new.id, 3, 10);
    end if;
  exception when others then
    raise warning 'xp_on_review_comment: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_review_comment on public.review_comments;
create trigger xp_on_review_comment after insert on public.review_comments
  for each row execute function private.xp_on_review_comment();

create or replace function private.xp_on_list_comment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  begin
    if new.body is null or length(trim(new.body)) = 0 then
      return null;
    end if;
    select l.user_id into v_owner from public.lists l where l.id = new.list_id;
    if v_owner is not null and v_owner <> new.user_id then
      perform private.award_xp(new.user_id, 'comment', 'lc:' || new.id, 3, 10);
    end if;
  exception when others then
    raise warning 'xp_on_list_comment: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_list_comment on public.list_comments;
create trigger xp_on_list_comment after insert on public.list_comments
  for each row execute function private.xp_on_list_comment();

create or replace function private.xp_on_follow()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.follower_id <> new.followee_id then
      perform private.award_xp(new.follower_id, 'follow', new.followee_id::text, 2, 5);
    end if;
  exception when others then
    raise warning 'xp_on_follow: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_follow on public.follows;
create trigger xp_on_follow after insert on public.follows
  for each row execute function private.xp_on_follow();

-- Badges: a one-step badge earned, a tier reached, and the yearly Challenge
-- (Year's Work counts how many yearly goals you've hit).
create or replace function private.xp_on_badge()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_rank integer := 0;
  v_new_rank integer;
  v_single integer;
  v_old_value integer := 0;
  v_new_value integer;
  i integer;
begin
  begin
    if tg_op = 'UPDATE' then
      v_old_rank := private.badge_tier_rank(old.tier);
      v_old_value := coalesce(floor(old.current_value), 0)::integer;
    end if;
    v_new_rank := private.badge_tier_rank(new.tier);

    if v_new_rank > v_old_rank and new.current_value is not null then
      v_single := private.single_badge_xp(new.badge_id);
      if v_single is not null then
        perform private.award_xp(new.user_id, 'badge', new.badge_id, v_single, null);
      elsif new.badge_id <> 'kept-the-fire' then
        for i in (v_old_rank + 1)..least(v_new_rank, 3) loop
          perform private.award_xp(new.user_id, 'tier',
            new.badge_id || ':' || (array['bronze', 'silver', 'gold'])[i],
            (array[100, 250, 600])[i], null);
        end loop;
      end if;
    end if;

    if new.badge_id = 'years-work' then
      v_new_value := coalesce(floor(new.current_value), 0)::integer;
      if v_new_value > v_old_value then
        for i in (v_old_value + 1)..v_new_value loop
          perform private.award_xp(new.user_id, 'challenge', 'years-work:' || i, 1000, null);
        end loop;
      end if;
    end if;
  exception when others then
    raise warning 'xp_on_badge: %', sqlerrm;
  end;
  return null;
end;
$$;
-- recompute_my_badges() rewrites every row on each run, so the update
-- trigger only wakes up when the tier rises or Year's Work moves.
drop trigger if exists xp_on_badge on public.user_badges;
drop trigger if exists xp_on_badge_insert on public.user_badges;
drop trigger if exists xp_on_badge_update on public.user_badges;
create trigger xp_on_badge_insert after insert on public.user_badges
  for each row execute function private.xp_on_badge();
create trigger xp_on_badge_update after update of tier, current_value on public.user_badges
  for each row
  when (old.tier is distinct from new.tier
        or (new.badge_id = 'years-work' and old.current_value is distinct from new.current_value))
  execute function private.xp_on_badge();

create or replace function private.xp_on_streak_milestone()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_amount integer := case new.milestone_days
    when 3 then 25 when 7 then 50 when 15 then 100 when 30 then 200 when 100 then 500 end;
begin
  begin
    perform private.award_xp(new.user_id, 'streak', new.milestone_days::text, v_amount, null);
  exception when others then
    raise warning 'xp_on_streak_milestone: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists xp_on_streak_milestone on public.user_streak_milestones;
create trigger xp_on_streak_milestone after insert on public.user_streak_milestones
  for each row execute function private.xp_on_streak_milestone();

-- ── 6. History: the same rules, applied to everything already recorded ────
-- Set-based: per source, the first event per thing, then the first N per
-- player per UTC day (the cap), at the time it happened. Re-running adds
-- nothing new (once-per-thing) and re-counts totals from the ledger.
create temporary table xp_history (
  user_id uuid, source text, ref text, amount integer, at timestamptz, cap integer
) on commit drop;

insert into xp_history
  select user_id, 'session', id::text, 10, created_at, 5
    from public.play_sessions where user_id is not null and created_at is not null;

insert into xp_history
  select user_id, src, ref, amt, at, cap from (
    select a.user_id, a.igdb_game_id::text as ref, min(a.created_at) as at,
           case a.metadata->>'to_status' when 'played' then 'finished'
                when 'currently' then 'started' else 'backlog' end as src,
           case a.metadata->>'to_status' when 'played' then 50
                when 'currently' then 5 else 2 end as amt,
           case a.metadata->>'to_status' when 'played' then 5
                when 'currently' then 3 else 10 end as cap
      from public.activities a
     where a.activity_type = 'status_changed'
       and a.metadata->>'to_status' in ('played', 'currently', 'want')
       and a.igdb_game_id is not null and a.user_id is not null
     group by a.user_id, a.igdb_game_id, a.metadata->>'to_status'
  ) s;

insert into xp_history
  select actor_user_id, 'backlog', entity_id, 2, min(created_at), 10
    from public.activity_events
   where type = 'backlogged' and entity_id is not null and actor_user_id is not null
   group by actor_user_id, entity_id;

insert into xp_history
  select user_id, 'rate', igdb_game_id::text, 5, min(created_at), 10
    from public.reviews
   where rating is not null and rating > 0 and igdb_game_id is not null and user_id is not null
   group by user_id, igdb_game_id;

insert into xp_history
  select user_id, 'review', igdb_game_id::text, 25, min(created_at), 3
    from public.reviews
   where body is not null and length(trim(body)) > 0 and igdb_game_id is not null and user_id is not null
   group by user_id, igdb_game_id;

insert into xp_history
  select user_id, 'journal', id::text, 15, created_at, 3
    from public.journal_entries
   where body is not null and length(trim(body)) > 0 and user_id is not null;

insert into xp_history
  select l.user_id, 'list', l.id::text, 20, g.third_at, 2
    from public.lists l
    join lateral (
      select lg.added_at as third_at
        from public.list_games lg
       where lg.list_id = l.id
       order by lg.added_at, lg.id
       offset 2 limit 1
    ) g on true
   where coalesce(l.is_curated, false) = false and l.user_id is not null;

insert into xp_history
  select a.user_id, 'qa_answer', a.id::text, 20, a.created_at, 5
    from public.qa_answers a
    join public.qa_questions q on q.id = a.question_id
   where a.removed_at is null and a.user_id is not null
     and q.user_id is distinct from a.user_id;

insert into xp_history
  select a.user_id, 'qa_best', a.id::text, 50, coalesce(q.best_picked_at, a.created_at), null
    from public.qa_questions q
    join public.qa_answers a on a.id = q.best_answer_id
   where a.removed_at is null and q.removed_at is null and a.user_id is not null
     and q.user_id is distinct from a.user_id;

insert into xp_history
  select user_id, 'qa_ask', id::text, 10, created_at, 3
    from public.qa_questions
   where removed_at is null and user_id is not null;

-- Hearts on reviews.
insert into xp_history
  select rl.user_id, 'heart_given', 'review:' || rl.review_id, 1, rl.created_at, 10
    from public.review_likes rl join public.reviews r on r.id = rl.review_id
   where r.user_id <> rl.user_id;
insert into xp_history
  select r.user_id, 'heart_received', rl.user_id || ':review:' || rl.review_id, 2, rl.created_at, 20
    from public.review_likes rl join public.reviews r on r.id = rl.review_id
   where r.user_id <> rl.user_id;

-- Pulse hearts on posts and lists.
with hearts as (
  select rx.user_id as giver, rx.target_type::text as tt, rx.target_id, rx.created_at,
         coalesce(ae.actor_user_id, l.user_id) as owner
    from public.reactions rx
    left join public.activity_events ae
      on rx.target_type = 'activity' and ae.id::text = rx.target_id
    left join public.lists l
      on rx.target_type = 'list' and l.id::text = rx.target_id
   where rx.emoji in (E'❤️', E'❤')
     and rx.target_type in ('activity', 'list')
)
insert into xp_history
  select giver, 'heart_given', tt || ':' || target_id, 1, created_at, 10
    from hearts where owner is not null and owner <> giver
  union all
  select owner, 'heart_received', giver || ':' || tt || ':' || target_id, 2, created_at, 20
    from hearts where owner is not null and owner <> giver;

insert into xp_history
  select rc.user_id, 'comment', 'rc:' || rc.id, 3, rc.created_at, 10
    from public.review_comments rc
    left join public.reviews r on r.id = rc.review_id
    left join public.activity_events ae on ae.id = rc.activity_event_id
   where rc.removed_at is null and rc.body is not null and length(trim(rc.body)) > 0
     and coalesce(r.user_id, ae.actor_user_id) is not null
     and coalesce(r.user_id, ae.actor_user_id) <> rc.user_id;

insert into xp_history
  select lc.user_id, 'comment', 'lc:' || lc.id, 3, lc.created_at, 10
    from public.list_comments lc join public.lists l on l.id = lc.list_id
   where lc.removed_at is null and lc.body is not null and length(trim(lc.body)) > 0
     and l.user_id <> lc.user_id;

insert into xp_history
  select follower_id, 'follow', followee_id::text, 2, created_at, 5
    from public.follows where follower_id <> followee_id;

-- Badges as they stand now.
insert into xp_history
  select ub.user_id, 'badge', ub.badge_id, private.single_badge_xp(ub.badge_id), ub.earned_at, null
    from public.user_badges ub
   where ub.tier is not null and ub.current_value is not null
     and private.single_badge_xp(ub.badge_id) is not null;

insert into xp_history
  select ub.user_id, 'tier', ub.badge_id || ':' || (array['bronze', 'silver', 'gold'])[i],
         (array[100, 250, 600])[i], ub.earned_at, null
    from public.user_badges ub
    cross join lateral generate_series(1, least(private.badge_tier_rank(ub.tier), 3)) as i
   where ub.tier is not null and ub.current_value is not null
     and private.single_badge_xp(ub.badge_id) is null
     and ub.badge_id <> 'kept-the-fire';

insert into xp_history
  select ub.user_id, 'challenge', 'years-work:' || i, 1000, ub.earned_at, null
    from public.user_badges ub
    cross join lateral generate_series(1, coalesce(floor(ub.current_value), 0)::integer) as i
   where ub.badge_id = 'years-work';

insert into xp_history
  select user_id, 'streak', milestone_days::text,
         case milestone_days when 3 then 25 when 7 then 50 when 15 then 100
              when 30 then 200 when 100 then 500 end,
         reached_at, null
    from public.user_streak_milestones
   where milestone_days in (3, 7, 15, 30, 100);

-- Once per thing, then the daily cap, then into the ledger.
insert into public.xp_events (user_id, source, ref, amount, created_at)
select user_id, source, ref, amount, at
  from (
    select h.*,
           row_number() over (
             partition by h.user_id, h.source, date_trunc('day', h.at at time zone 'UTC')
             order by h.at, h.ref
           ) as day_rank
      from (
        select distinct on (user_id, source, ref) *
          from xp_history
         where user_id is not null and ref is not null and amount > 0 and at is not null
         order by user_id, source, ref, at
      ) h
     where exists (select 1 from public.users u where u.id = h.user_id)
       and not exists (
         select 1 from public.xp_events e
          where e.user_id = h.user_id and e.source = h.source and e.ref = h.ref
       )
  ) ranked
 where cap is null or day_rank + coalesce((
         select count(*) from public.xp_events e2
          where e2.user_id = ranked.user_id and e2.source = ranked.source
            and e2.created_at >= date_trunc('day', ranked.at at time zone 'UTC') at time zone 'UTC'
            and e2.created_at < (date_trunc('day', ranked.at at time zone 'UTC') at time zone 'UTC') + interval '1 day'
       ), 0) <= cap
on conflict on constraint xp_events_once do nothing;

-- Totals and levels from the ledger (runs as the SQL Editor's owner role, so
-- the users_xp_guard lets it through).
update public.users u
   set xp_total = s.total,
       level = private.level_for(s.total)
  from (
    select uu.id, coalesce(sum(e.amount), 0)::integer as total
      from public.users uu
      left join public.xp_events e on e.user_id = uu.id
     group by uu.id
  ) s
 where s.id = u.id
   and (u.xp_total is distinct from s.total or u.level is distinct from private.level_for(s.total));

-- ── 7. The app tells the server which level it has shown ──────────────────
create or replace function public.acknowledge_my_level(p_level integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'acknowledge_my_level requires an authenticated user';
  end if;
  update public.users u
     set level_seen = greatest(coalesce(u.level_seen, 0), least(coalesce(p_level, 0), u.level))
   where u.id = auth.uid();
end;
$$;

revoke all on function public.acknowledge_my_level(integer) from public, anon;
grant execute on function public.acknowledge_my_level(integer) to authenticated;

-- ── 8. Self-test (rolled back): a fake session for theantifail ────────────
do $selftest$
declare
  v_test uuid;
  v_before integer;
  v_after integer;
  v_event integer;
  v_cap integer := 0;
  i integer;
begin
  select id into v_test from public.users where username = 'theantifail';
  if v_test is null then
    raise exception 'STOP (nothing was changed): user theantifail not found for the self-test. Send Claude this message.';
  end if;

  -- The ledger and the totals agree for everyone.
  if exists (
    select 1 from public.users u
     where u.xp_total <> coalesce((select sum(e.amount) from public.xp_events e where e.user_id = u.id), 0)
        or u.level <> private.level_for(u.xp_total)
  ) then
    raise exception 'STOP (nothing was changed): XP totals do not match the ledger. Send Claude this message.';
  end if;

  if private.level_for(0) <> 1 or private.level_for(99) <> 1 or private.level_for(100) <> 2
     or private.level_for(249) <> 2 or private.level_for(250) <> 3 or private.level_for(5430) <> 14
     or private.level_for(63700) <> 50 or private.level_for(999999) <> 50 then
    raise exception 'STOP (nothing was changed): level math is off. Send Claude this message.';
  end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_test::text, 'role', 'authenticated')::text, true);
    select xp_total into v_before from public.users where id = v_test;

    -- Daily cap: a test source capped at 2 a day pays twice, then stops.
    for i in 1..4 loop
      v_cap := v_cap + private.award_xp(v_test, 'selftest', 'cap:' || i, 1, 2);
    end loop;
    -- Once per thing.
    v_cap := v_cap + private.award_xp(v_test, 'selftest', 'cap:1', 1, null);
    if v_cap <> 2 then
      raise exception 'selftest_fail: cap/once paid %, expected 2', v_cap;
    end if;

    -- The session trigger path, end to end. If another trigger on
    -- play_sessions refuses this fake row, skip this part.
    begin
      insert into public.play_sessions (user_id, igdb_game_id, hours, played_on)
      values (v_test, 1, 1, current_date);
      select count(*) into v_event from public.xp_events
       where user_id = v_test and source = 'session' and created_at >= now() - interval '1 minute';
      select xp_total into v_after from public.users where id = v_test;
      if v_event = 0 then
        -- Allowed only when theantifail already hit today's 5-session cap.
        if (select count(*) from public.xp_events where user_id = v_test and source = 'session'
             and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') < 5 then
          raise exception 'selftest_fail: a logged session earned no XP';
        end if;
      elsif v_after <> v_before + 2 + 10 then
        raise exception 'selftest_fail: total moved from % to %, expected +12', v_before, v_after;
      end if;
    exception
      when raise_exception then
        if sqlerrm like 'selftest_fail%' then raise; end if;
        raise notice 'session part skipped: %', sqlerrm;
      when others then
        raise notice 'session part skipped: %', sqlerrm;
    end;

    raise exception 'selftest_ok';
  exception
    when raise_exception then
      if sqlerrm <> 'selftest_ok' then
        raise exception 'STOP (nothing was changed): self-test failed (%). Send Claude this message.', sqlerrm;
      end if;
  end;
end;
$selftest$;

commit;

-- ── 9. Result for Claude: theantifail's XP by source (read-only) ──────────
select coalesce(e.source, 'TOTAL') as source,
       count(*) as events,
       sum(e.amount) as xp,
       max(u.level) as level,
       max(u.level_seen) as level_seen
  from public.xp_events e
  join public.users u on u.id = e.user_id
 where u.username = 'theantifail'
 group by rollup (e.source)
 order by (e.source is null), sum(e.amount) desc;
