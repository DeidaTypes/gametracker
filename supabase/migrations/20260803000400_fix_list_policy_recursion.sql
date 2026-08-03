-- Fix infinite recursion (SQLSTATE 42P17) across the list policies.
--
-- WHAT BROKE
-- 20260803000000_rls_read_lockdown.sql gave `lists` a collaborator-visibility
-- policy that reads `list_collaborators`, and gave `list_collaborators` a
-- visibility policy that reads `lists`. Each table's policy therefore invokes
-- the other table's policy, and Postgres refuses the cycle at rewrite time:
--
--   ERROR: infinite recursion detected in policy for relation "lists"
--
-- Because the cycle is detected while the query is being rewritten, no amount of
-- AND short-circuiting avoids it. The blast radius was the whole lists feature —
-- lists, list_games, list_comments and list_collaborators all returned HTTP 500
-- for every SELECT, UPDATE, DELETE and INSERT, including a user reading their
-- OWN lists. The list_games write policies were caught in it too, via their
-- pre-existing EXISTS on list_collaborators.
--
-- This was invisible in the pentest matrix because the harness scored "0 rows
-- returned" as a pass, and a 500 returns 0 rows exactly like a successful denial
-- does. Only the read-your-own-row probes flagged it.
--
-- THE FIX
-- Cross-table visibility checks move into SECURITY DEFINER helpers. A definer
-- function reads its table with RLS bypassed, so the chain terminates instead of
-- re-entering the other table's policy. Same rule as the block helpers in
-- 20260801010205: a policy on table X must never read table Y through Y's own
-- RLS if Y's policy reads X.
--
-- Visibility semantics are unchanged from the lockdown migration: a list is
-- visible to its owner, to anyone if is_public and no block exists, or to a
-- collaborator with no block. No write policy is touched.

begin;

-- Reads list_collaborators with RLS bypassed. Used by policies ON lists, so it
-- must not itself go back through lists.
create or replace function private.is_list_collaborator(p_list_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p_uid is not null and exists (
    select 1 from public.list_collaborators lc
    where lc.list_id = p_list_id and lc.user_id = p_uid
  );
$$;

-- The single source of truth for "can p_uid see this list". Reads lists with RLS
-- bypassed, so policies on the child tables (list_games, list_comments,
-- list_collaborators) can call it without re-entering lists' policies.
create or replace function private.list_visible_to(p_list_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.lists l
    where l.id = p_list_id
      and (
        l.user_id = p_uid
        or (
          not private.is_blocked_between(p_uid, l.user_id)
          and (
            l.is_public = true
            or exists (
              select 1 from public.list_collaborators lc
              where lc.list_id = l.id and lc.user_id = p_uid
            )
          )
        )
      )
  );
$$;

revoke all on function private.is_list_collaborator(uuid, uuid) from public;
revoke all on function private.list_visible_to(uuid, uuid) from public;
grant execute on function private.is_list_collaborator(uuid, uuid) to authenticated, anon;
grant execute on function private.list_visible_to(uuid, uuid) to authenticated, anon;

-- lists: the recursive half of the cycle.
-- BEFORE: not is_blocked_between(auth.uid(), user_id)
--         and exists (select 1 from list_collaborators lc
--                     where lc.list_id = lists.id and lc.user_id = auth.uid())
-- AFTER:  the EXISTS becomes private.is_list_collaborator(...)
drop policy if exists lists_select_collaborator on public.lists;
create policy lists_select_collaborator on public.lists
  for select to authenticated
  using (
    not private.is_blocked_between(auth.uid(), user_id)
    and private.is_list_collaborator(id, auth.uid())
  );

-- list_collaborators: the other recursive half.
-- BEFORE: auth.uid() = user_id
--         or exists (select 1 from lists l where l.id = list_collaborators.list_id)
--         -- the bare EXISTS leaned on lists' RLS as the gate, which is what
--         -- closed the cycle
-- AFTER:  auth.uid() = user_id or private.list_visible_to(list_id, auth.uid())
drop policy if exists list_collaborators_select on public.list_collaborators;
create policy list_collaborators_select on public.list_collaborators
  for select to authenticated
  using (
    auth.uid() = user_id
    or private.list_visible_to(list_id, auth.uid())
  );

-- list_games: same pattern — stop inheriting the gate through lists' RLS.
drop policy if exists list_games_select on public.list_games;
create policy list_games_select on public.list_games
  for select to authenticated
  using (private.list_visible_to(list_id, auth.uid()));

-- list_comments: keeps its own author-level block check, and the parent-list
-- gate now resolves through the helper.
drop policy if exists list_comments_select on public.list_comments;
create policy list_comments_select on public.list_comments
  for select to authenticated
  using (
    auth.uid() = user_id
    or (
      not private.is_blocked_between(auth.uid(), user_id)
      and private.list_visible_to(list_id, auth.uid())
    )
  );

commit;
