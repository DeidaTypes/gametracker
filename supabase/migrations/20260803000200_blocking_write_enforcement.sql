-- Blocking enforcement, write side. App Store Guideline 1.2.
--
-- MANUAL RUN. Apply after 20260803000100_public_profile_view.sql.
--
-- The pentest found blocking was decorative on writes: with A blocking B, B could
-- still send A a DM, follow A, and comment on A's review — all HTTP 201. The DM
-- hole is closed by 20260801010205 (dm_insert_self). This closes the rest.
--
-- Every policy below keeps its existing ownership check verbatim and ANDs a block
-- check onto it. No write is made more permissive.
--
-- Null-target behaviour: is_blocked_between(a, null) is false, so `not
-- is_blocked_between(...)` is true when the target cannot be resolved (a
-- nullable parent column, or an id that matches nothing). Unresolvable targets
-- therefore behave exactly as they did before this migration.


-- ============================================================
-- 1. Target-owner resolvers
-- ============================================================
-- "Who owns the thing being interacted with." SECURITY DEFINER so the check does
-- not depend on the actor being able to read the parent row — which matters
-- precisely because a blocked actor now cannot.

create or replace function private.try_uuid(t text)
returns uuid
language plpgsql
immutable
as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.review_author(p_review_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id from reviews r where r.id = p_review_id;
$$;

create or replace function private.review_comment_author(p_comment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select rc.user_id from review_comments rc where rc.id = p_comment_id;
$$;

create or replace function private.list_owner(p_list_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.user_id from lists l where l.id = p_list_id;
$$;

create or replace function private.activity_event_actor(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ae.actor_user_id from activity_events ae where ae.id = p_event_id;
$$;

-- reactions.target_id is text and target_type is polymorphic across five kinds.
create or replace function private.reaction_target_owner(
  p_type      reaction_target_type,
  p_target_id text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'review'  then (select r.user_id  from reviews r         where r.id  = private.try_uuid(p_target_id))
    when 'list'    then (select l.user_id  from lists l           where l.id  = private.try_uuid(p_target_id))
    when 'comment' then (select rc.user_id from review_comments rc where rc.id = private.try_uuid(p_target_id))
    when 'activity' then coalesce(
      (select ae.actor_user_id from activity_events ae where ae.id = private.try_uuid(p_target_id)),
      (select a.user_id       from activities a      where a.id  = private.try_uuid(p_target_id))
    )
    when 'dm_message' then (select dm.sender_id from direct_messages dm where dm.id = private.try_uuid(p_target_id))
  end;
$$;

revoke all on function private.try_uuid(text) from public;
revoke all on function private.review_author(uuid) from public;
revoke all on function private.review_comment_author(uuid) from public;
revoke all on function private.list_owner(uuid) from public;
revoke all on function private.activity_event_actor(uuid) from public;
revoke all on function private.reaction_target_owner(reaction_target_type, text) from public;

grant execute on function private.try_uuid(text) to anon, authenticated, service_role;
grant execute on function private.review_author(uuid) to anon, authenticated, service_role;
grant execute on function private.review_comment_author(uuid) to anon, authenticated, service_role;
grant execute on function private.list_owner(uuid) to anon, authenticated, service_role;
grant execute on function private.activity_event_actor(uuid) to anon, authenticated, service_role;
grant execute on function private.reaction_target_owner(reaction_target_type, text) to anon, authenticated, service_role;


-- ============================================================
-- 2. follows — a blocked user cannot follow the blocker
-- ============================================================
-- Was: with check (auth.uid() = follower_id)

drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows
  for insert
  to authenticated
  with check (
    auth.uid() = follower_id
    and not private.is_blocked_between(auth.uid(), followee_id)
  );


-- ============================================================
-- 3. Comments — a blocked user cannot comment on the blocker's content
-- ============================================================
-- Both comment tables were: with check (auth.uid() = user_id)
--
-- review_comments is polymorphic since 20260728140000 — review_id and
-- activity_event_id are both nullable — so both parents are checked.

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.review_author(comments.review_id)
    )
  );

drop policy if exists review_comments_insert_own on public.review_comments;
create policy review_comments_insert_own on public.review_comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.review_author(review_comments.review_id)
    )
    and not private.is_blocked_between(
      auth.uid(), private.activity_event_actor(review_comments.activity_event_id)
    )
  );


-- ============================================================
-- 4. Likes and reactions
-- ============================================================
-- All were: with check (auth.uid() = user_id), except reactions, which had a
-- block clause that compared blocked_users against reactions.user_id — the
-- actor's own id. It only ever asked "have I blocked myself", so it never
-- rejected anything. It now checks the owner of the target being reacted to.

drop policy if exists likes_insert_self on public.likes;
create policy likes_insert_self on public.likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.review_author(likes.review_id)
    )
  );

drop policy if exists review_likes_insert_own on public.review_likes;
create policy review_likes_insert_own on public.review_likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.review_author(review_likes.review_id)
    )
  );

drop policy if exists comment_likes_insert_own on public.comment_likes;
create policy comment_likes_insert_own on public.comment_likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.review_comment_author(comment_likes.comment_id)
    )
  );

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.reaction_target_owner(reactions.target_type, reactions.target_id)
    )
  );


-- ============================================================
-- 5. Lists — commenting on, saving, and collaborating
-- ============================================================
-- list_comments / list_saves were: with check (auth.uid() = user_id).
-- list_collaborators was owner-of-the-list only, with no check on the invitee.

drop policy if exists list_comments_insert on public.list_comments;
create policy list_comments_insert on public.list_comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.list_owner(list_comments.list_id)
    )
  );

drop policy if exists list_saves_insert on public.list_saves;
create policy list_saves_insert on public.list_saves
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not private.is_blocked_between(
      auth.uid(), private.list_owner(list_saves.list_id)
    )
  );

drop policy if exists list_collaborators_insert on public.list_collaborators;
create policy list_collaborators_insert on public.list_collaborators
  for insert
  to authenticated
  with check (
    auth.uid() = (select lists.user_id from lists where lists.id = list_collaborators.list_id)
    and not private.is_blocked_between(auth.uid(), list_collaborators.user_id)
  );
