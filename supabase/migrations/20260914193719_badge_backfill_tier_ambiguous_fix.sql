-- Fix-up: backfill_my_badges() RETURNS TABLE declares `tier` /
-- `celebrated_at` as PL/pgSQL variables, so the unqualified
-- `tier is not null` predicate was ambiguous (42702) and the RPC
-- aborted before setting badge_backfill_version or celebrating rows.
drop function if exists public.backfill_my_badges();

create or replace function public.backfill_my_badges()
returns table(family_id text, granted_tier text, metric_value numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_version integer;
begin
  if v_user_id is null then
    raise exception 'backfill_my_badges requires an authenticated user';
  end if;

  select coalesce(u.badge_backfill_version, 0) into v_version
    from public.users u
   where u.id = v_user_id;

  if v_version >= 1 then
    return;
  end if;

  perform public.recompute_my_badges();

  update public.user_badges ub
     set celebrated_at = now()
   where ub.user_id = v_user_id
     and ub.tier is not null
     and ub.celebrated_at is null;

  update public.users u
     set badge_backfill_version = 1
   where u.id = v_user_id;

  return query
    select ub.badge_id, ub.tier, ub.current_value
      from public.user_badges ub
     where ub.user_id = v_user_id
       and ub.tier is not null;
end;
$$;

revoke all on function public.backfill_my_badges() from public, anon;
grant execute on function public.backfill_my_badges() to authenticated;
