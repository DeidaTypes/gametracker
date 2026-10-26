-- Migration: Helper badge (best answers) + best answers on profiles (Sprint L2)
--
-- WHAT THIS DOES
--   1. Counts a user's "best answers": answers the ASKER picked as best, where
--      the answer was not removed, the question was not removed, and the asker
--      is not the answerer (an asker answering and picking their own answer
--      does not count).
--   2. Keeps one user_badges row, badge_id = 'helper', in step with that count.
--      Tier ladder 1 / 10 / 50 (bronze / silver / gold) is the same
--      private.badge_tier_for() every other family uses. Tier is monotonic,
--      exactly like recompute_my_badges(): current_value follows the live
--      count, a tier already reached is never taken away.
--   3. public.qa_user_best_answers(user, limit): the profile "{n} best answers"
--      count and the pushed list, for ANY user, same for self and visitors.
--
-- WHY A TRIGGER AND NOT recompute_my_badges()
--   recompute_my_badges() only ever runs for auth.uid(). A best answer is
--   picked by the ASKER, a different person from the answerer who earns the
--   badge, so the answerer's own recompute would not run until some unrelated
--   write of theirs. The triggers below update the ANSWERER's row at the moment
--   of the pick. recompute_my_badges() is left exactly as it is.
--
-- NOT DONE HERE
--   The unlock celebration needs the answerer's app to re-read user_badges.
--   That is client work (see the chat report).
--
-- EXISTING BEST ANSWERS
--   Step 5 gives every user who already has a best answer their Helper row,
--   SILENTLY (celebrated_at set at migration time; decided by Ry/Claude Oct 26).
--
-- Safe to re-run: every statement is create-or-replace / drop-if-exists.

begin;

-- ── 1. The count ────────────────────────────────────────────────────────────
create or replace function private.qa_best_answer_count(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.qa_answers a
    join public.qa_questions q on q.best_answer_id = a.id
   where a.user_id = p_user_id
     and a.removed_at is null
     and q.removed_at is null
     and q.user_id is distinct from a.user_id
$$;

-- ── 2. Write the badge row ─────────────────────────────────────────────────
create or replace function private.sync_helper_badge(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n    int;
  v_tier text;
begin
  if p_user_id is null then
    return;
  end if;

  -- Account being deleted: its cascade can fire this after the user row is gone.
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    return;
  end if;

  v_n := private.qa_best_answer_count(p_user_id);
  v_tier := private.badge_tier_for(v_n, 1, 10, 50);

  -- No row for someone who has never had a best answer.
  if v_n = 0 and not exists (
       select 1 from public.user_badges b
        where b.user_id = p_user_id and b.badge_id = 'helper') then
    return;
  end if;

  insert into public.user_badges (user_id, badge_id, tier, current_value, earned_at)
  values (p_user_id, 'helper', v_tier, v_n, now())
  on conflict (user_id, badge_id) do update
    set current_value = excluded.current_value,
        tier = case
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then excluded.tier
          else public.user_badges.tier
        end,
        earned_at = case
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then now()
          else public.user_badges.earned_at
        end;
end;
$$;

-- ── 3. Triggers: update the ANSWERER when anything that affects the count moves
-- A question's best pick changes, or the question is removed.
create or replace function private.helper_badge_on_question()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  -- A badge problem must never block picking or removing (same rule as private.notify).
  begin
    if new.best_answer_id is distinct from old.best_answer_id
       or new.removed_at is distinct from old.removed_at then
      if old.best_answer_id is not null then
        select a.user_id into v_old from public.qa_answers a where a.id = old.best_answer_id;
      end if;
      if new.best_answer_id is not null then
        select a.user_id into v_new from public.qa_answers a where a.id = new.best_answer_id;
      end if;
      perform private.sync_helper_badge(v_old);
      if v_new is distinct from v_old then
        perform private.sync_helper_badge(v_new);
      end if;
    end if;
  exception when others then
    raise warning 'private.helper_badge_on_question: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists helper_badge_on_question on public.qa_questions;
create trigger helper_badge_on_question
  after update of best_answer_id, removed_at on public.qa_questions
  for each row execute function private.helper_badge_on_question();

-- An answer is removed by a moderator, or deleted by its author.
create or replace function private.helper_badge_on_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform private.sync_helper_badge(old.user_id);
    elsif new.removed_at is distinct from old.removed_at then
      perform private.sync_helper_badge(new.user_id);
    end if;
  exception when others then
    raise warning 'private.helper_badge_on_answer: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists helper_badge_on_answer_update on public.qa_answers;
create trigger helper_badge_on_answer_update
  after update of removed_at on public.qa_answers
  for each row execute function private.helper_badge_on_answer();

drop trigger if exists helper_badge_on_answer_delete on public.qa_answers;
create trigger helper_badge_on_answer_delete
  after delete on public.qa_answers
  for each row execute function private.helper_badge_on_answer();

-- ── 4. Profile: count + list, for any user ─────────────────────────────────
-- SECURITY INVOKER on purpose, like qa_mine / qa_item: RLS decides which
-- questions and answers the viewer can see (blocked pairs, removed rows) and
-- report auto-hide applies per viewer. A visitor and the owner run the same
-- code. Q&A is a public board, so this does not depend on activity_privacy.
--
-- p_limit = 0 returns the count only (what the profile line needs); the list is
-- capped at 100, newest pick first. Each item is the standard
-- private.qa_item() list-row shape plus picked_at.
create or replace function public.qa_user_best_answers(p_user_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_limit int := least(greatest(coalesce(p_limit, 0), 0), 100);
  v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user_id is null then
    return jsonb_build_object('count', 0, 'items', '[]'::jsonb);
  end if;

  select count(*)::int
    into v_count
    from public.qa_answers a
    join public.qa_questions q on q.best_answer_id = a.id
   where a.user_id = p_user_id
     and a.removed_at is null
     and q.removed_at is null
     and q.user_id is distinct from a.user_id
     and not private.qa_report_hidden('answer', a.id, a.user_id)
     and not private.qa_report_hidden('question', q.id, q.user_id);

  if v_limit > 0 and v_count > 0 then
    select coalesce(jsonb_agg(x.j order by x.picked desc nulls last), '[]'::jsonb)
      into v_items
      from (
        select q.best_picked_at as picked,
               private.qa_item(q.id) || jsonb_build_object('picked_at', q.best_picked_at) as j
          from public.qa_answers a
          join public.qa_questions q on q.best_answer_id = a.id
         where a.user_id = p_user_id
           and a.removed_at is null
           and q.removed_at is null
           and q.user_id is distinct from a.user_id
           and not private.qa_report_hidden('answer', a.id, a.user_id)
           and not private.qa_report_hidden('question', q.id, q.user_id)
         order by q.best_picked_at desc nulls last
         limit v_limit
      ) x
     where x.j is not null;
  end if;

  return jsonb_build_object('count', v_count, 'items', v_items);
end;
$$;

-- ── 5. Existing best answers → Helper rows ─────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select distinct a.user_id
      from public.qa_answers a
      join public.qa_questions q on q.best_answer_id = a.id
     where a.user_id is not null
  loop
    perform private.sync_helper_badge(r.user_id);
  end loop;

  -- Silent backfill (same as 20260914193453_badge_silent_backfill): rows created
  -- here are marked celebrated, so nobody gets a surprise celebration for old picks.
  -- New picks after this migration celebrate normally.
  update public.user_badges
     set celebrated_at = now()
   where badge_id = 'helper' and celebrated_at is null;
end;
$$;

-- ── 6. Grants ──────────────────────────────────────────────────────────────
revoke all on function private.qa_best_answer_count(uuid)   from public, anon, authenticated;
revoke all on function private.sync_helper_badge(uuid)      from public, anon, authenticated;
revoke all on function private.helper_badge_on_question()   from public, anon, authenticated;
revoke all on function private.helper_badge_on_answer()     from public, anon, authenticated;

revoke all on function public.qa_user_best_answers(uuid, int) from public, anon;
grant execute on function public.qa_user_best_answers(uuid, int) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ── Checks (run by hand in the SQL Editor after applying) ──────────────────
-- A. Triggers exist:
--   select tgname from pg_trigger where tgname like 'helper_badge_on_%' and not tgisinternal;
--   -- EXPECT 3 rows: helper_badge_on_question, helper_badge_on_answer_update, helper_badge_on_answer_delete
-- B. Existing users with a best answer got a row:
--   select user_id, tier, current_value, celebrated_at from public.user_badges where badge_id = 'helper';
-- C. A pick moves the ANSWERER's row (pick as the asker, then):
--   select tier, current_value from public.user_badges where badge_id = 'helper' and user_id = '<answerer id>';
--   -- EXPECT tier = bronze, current_value = 1
-- D. Self-pick does not count: asker answers own question, picks it -> count unchanged.
