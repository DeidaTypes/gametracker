-- Silent first-launch backfill for Sprint 16 badges.
--
-- Detection of "first launch after badges went live":
--   public.users.badge_backfill_version (integer, default 0).
--   Version 1 = the S16-4 Wave 1 + 5 promoted Wave 2 catalogue has been
--   computed and acknowledged for this user. Stored on the users row so
--   it survives reinstall, device switch, and localStorage wipe, and so
--   the summary screen can never re-show.
--
-- Does NOT alter recompute_my_badges() (S16-4). This function CALLS it,
-- then stamps celebrated_at on every family that actually has a tier.

-- ── 1. Per-user migration marker ─────────────────────────────────────
alter table public.users
  add column if not exists badge_backfill_version integer not null default 0;

comment on column public.users.badge_backfill_version is
  'Catalogue version of the one-time badge backfill. 0 = never run; 1 = S16-4 Wave 1 + promoted Wave 2 grants persisted with celebrated_at set. Survives reinstall. Never decremented.';

comment on column public.user_badges.celebrated_at is
  'When this family''s current tier was acknowledged. Backfill stamps it so historical grants do not celebrate. A later tier-up (trigger below) clears it so the new tier can celebrate once.';

-- ── 2. Clear celebrated_at when a family climbs a tier ───────────────
-- Additive trigger — does not change recompute_my_badges(). The S16-4
-- RPC updates tier/earned_at/current_value and leaves celebrated_at
-- untouched; this trigger is what makes a genuine later unlock
-- celebratable again after a backfill stamp.
create or replace function private.clear_badge_celebrated_on_tier_up()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if private.badge_tier_rank(NEW.tier) > private.badge_tier_rank(OLD.tier) then
    NEW.celebrated_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists user_badges_clear_celebrated_on_tier_up on public.user_badges;
create trigger user_badges_clear_celebrated_on_tier_up
  before update on public.user_badges
  for each row
  execute function private.clear_badge_celebrated_on_tier_up();

-- ── 3. One-time backfill RPC ─────────────────────────────────────────
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

  -- Already acknowledged this catalogue. Do not recompute or re-grant.
  if v_version >= 1 then
    return;
  end if;

  -- Compute current earned tiers via the unchanged S16-4 RPC.
  perform public.recompute_my_badges();

  -- Persist as already-acknowledged so the watcher fires nothing.
  -- Output column names are family_id / granted_tier / metric_value so
  -- they cannot clash with user_badges.tier (PL/pgSQL RETURNS TABLE
  -- variables shadow unqualified column names).
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

-- ── 4. Acknowledge a single family after a genuine unlock ────────────
-- user_badges has no client UPDATE policy (S16-4: writes go through
-- SECURITY DEFINER). Individual celebrations stamp celebrated_at here.
create or replace function public.acknowledge_my_badge(p_badge_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'acknowledge_my_badge requires an authenticated user';
  end if;
  if p_badge_id is null or length(trim(p_badge_id)) = 0 then
    return;
  end if;

  update public.user_badges
     set celebrated_at = now()
   where user_id = v_user_id
     and badge_id = p_badge_id
     and celebrated_at is null;
end;
$$;

revoke all on function public.acknowledge_my_badge(text) from public, anon;
grant execute on function public.acknowledge_my_badge(text) to authenticated;
