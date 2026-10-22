-- Q&A in The Pulse: one read-only RPC that returns the Q&A events from people
-- the viewer follows, for the Home feed.
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   public.qa_questions, public.qa_answers, public.follows, public.users
--   public.flag_enabled, private.qa_report_hidden, private.qa_user_deleted
--     (all from 20261015213000_community_qa.sql)
--
-- WHY AN RPC AND NOT A CLIENT-SIDE TABLE READ
--   Report auto-hide for Q&A lives only in private.qa_report_hidden(), which
--   reads public.reports. Only the reporter can read that table, so the app
--   cannot reproduce the check. A direct qa_questions read from the Home feed
--   would show a question or answer that the community already hid. Every
--   other Q&A list reads through an RPC for the same reason
--   (20261015213000_community_qa.sql, "Read through the RPCs, not the tables").
--
-- WHAT IT RETURNS
--   A bare jsonb array, newest event first, at most p_limit items (cap 10).
--   Each item:
--     kind                'asked' | 'best'
--     event_at            questions.created_at for 'asked', best_picked_at for 'best'
--     question_id, title, igdb_game_id, game_title, game_cover_image_id
--     actor               { id, username, display_name, avatar_url }
--                           'asked' -> the asker, 'best' -> the author of the picked answer
--   No question body and no answer body is returned, so a spoiler question
--   can only ever show its title (titles are always spoiler-free).
--
-- RULES
--   * Only people the viewer follows (public.follows, follower_id = caller).
--   * Returns [] when the 'qa' flag is off for the caller.
--   * Same visibility as every other Q&A read: SECURITY INVOKER, so RLS drops
--     removed rows and blocked pairs; report auto-hide and deleted authors are
--     dropped explicitly below.
--   * Window: the last 14 days, so a quiet week does not resurface old items.
--   * A 'best' event needs a live (not removed, not report-hidden) picked
--     answer written by someone other than the asker.
--   * Uses existing indexes: qa_questions_user_created_idx (asked),
--     qa_questions_best_answer_idx (best).

begin;

create or replace function public.qa_pulse(p_limit int default 6)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int  := least(greatest(coalesce(p_limit, 6), 1), 10);
  v_since timestamptz := now() - interval '14 days';
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not public.flag_enabled('qa') then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(e.j order by e.event_at desc, e.question_id), '[]'::jsonb)
    into v_items
    from (
      select x.event_at,
             x.question_id,
             jsonb_build_object(
               'kind',                x.kind,
               'event_at',            x.event_at,
               'question_id',         x.question_id,
               'title',               x.title,
               'igdb_game_id',        x.igdb_game_id,
               'game_title',          x.game_title,
               'game_cover_image_id', x.game_cover_image_id,
               'actor', jsonb_build_object(
                 'id',           u.id,
                 'username',     u.username,
                 'display_name', u.display_name,
                 'avatar_url',   u.avatar_url
               )
             ) as j
        from (
          -- someone I follow asked a question
          select 'asked'::text as kind,
                 q.created_at  as event_at,
                 q.id          as question_id,
                 q.title, q.igdb_game_id, q.game_title, q.game_cover_image_id,
                 q.user_id     as actor_id
            from public.qa_questions q
           where q.user_id in (select f.followee_id from public.follows f where f.follower_id = v_uid)
             and q.created_at >= v_since
             and q.removed_at is null
             and not private.qa_report_hidden('question', q.id, q.user_id)

          union all

          -- someone I follow had their answer picked as best
          select 'best'::text,
                 q.best_picked_at,
                 q.id,
                 q.title, q.igdb_game_id, q.game_title, q.game_cover_image_id,
                 a.user_id
            from public.qa_answers a
            join public.qa_questions q
              on q.best_answer_id = a.id
           where a.user_id in (select f.followee_id from public.follows f where f.follower_id = v_uid)
             and q.best_picked_at >= v_since
             and q.removed_at is null
             and a.removed_at is null
             and a.user_id is distinct from q.user_id
             and not private.qa_report_hidden('question', q.id, q.user_id)
             and not private.qa_report_hidden('answer', a.id, a.user_id)
        ) x
        join public.users u
          on u.id = x.actor_id
         and not private.qa_user_deleted(x.actor_id)
       order by x.event_at desc, x.question_id
       limit v_limit
    ) e;

  return v_items;
end;
$$;

revoke all on function public.qa_pulse(int) from public, anon;
grant execute on function public.qa_pulse(int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- ---- Checks (run after the file, in the SQL Editor) ----
-- The SQL Editor runs as postgres, so auth.uid() is null there. Impersonate a
-- test account first:
--
--   select set_config('request.jwt.claims',
--                     '{"sub":"<viewer uuid>","role":"authenticated"}', true);
--   set local role authenticated;
--
-- 1. Viewer follows a test account that asked a question in the last 14 days:
--      select public.qa_pulse();
--    EXPECT: one 'asked' item with that question's title and the asker as actor.
--
-- 2. That test account's answer is picked as best on someone else's question:
--      EXPECT: one 'best' item, actor = the answer's author, event_at = best_picked_at.
--
-- 3. Flag off for the viewer (app_flags 'qa' disabled, viewer not in allow_user_ids):
--      EXPECT: [] (not an error).
--
-- 4. Viewer reports (or enough people report) one of those questions:
--      EXPECT: it is gone from the result for the viewer.
--
-- 5. Accounts the viewer does not follow never appear.
