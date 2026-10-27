-- friend_started respects activity_privacy (A-2 finding, Oct 26).
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
--
-- Before: a user with activity_privacy = 'me' (or 'followers' toward a
-- non-follower) still produced "X started playing a game in your backlog"
-- bell rows and pushes. The feed already hides that activity; the bell did not.
-- After: the recipient must pass private.actor_visible_to(actor, recipient)
-- (blocks in both directions + activity_privacy), the same test review_like,
-- list_comment and mentions use. The insert goes through private.notify, so
-- self, deleted recipients and error swallowing match every other type.
-- Same trigger, same name; only the function body changes.

begin;

create or replace function public.trg_fn_notify_friend_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec record;
begin
  if new.type != 'started' then
    return new;
  end if;

  for v_rec in
    select distinct gt.user_id as recipient_id
      from public.game_trackers gt
      join public.follows f
        on f.follower_id = gt.user_id
       and f.followee_id = new.actor_user_id
     where gt.igdb_game_id::text = new.entity_id
       and gt.status = 'want'
       and gt.user_id <> new.actor_user_id
       and private.actor_visible_to(new.actor_user_id, gt.user_id)
  loop
    perform private.notify(v_rec.recipient_id, new.actor_user_id, 'friend_started', new.entity_id);
  end loop;

  return new;
end;
$$;

revoke execute on function public.trg_fn_notify_friend_started() from public, anon, authenticated;

commit;

-- VERIFY: expect the body to contain actor_visible_to
-- select position('actor_visible_to' in pg_get_functiondef('public.trg_fn_notify_friend_started()'::regprocedure)) > 0 as respects_privacy;
