-- Allow Finisher / Omnivore tiers to drop when the caller is undoing an
-- accidental completion. S16-4's recompute_my_badges() is otherwise
-- monotonic: current_value always updates, but a reached tier is never
-- lowered. Accidental-completion removal is the one operation that is
-- allowed to take a completion event away, so a tier can legitimately
-- drop here. Every other call site keeps the default (false).

comment on column public.user_badges.tier is
  'Highest tier reached for multi-tier (Sprint 16) badges. NULL for legacy single-tier badge rows and for multi-tier badges not yet earned at any tier. recompute_my_badges() never lowers this UNLESS p_allow_completion_tier_drop is true, in which case finisher and omnivore (the two badges that read completion events) may drop.';

drop function if exists public.recompute_my_badges();

create or replace function public.recompute_my_badges(p_allow_completion_tier_drop boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_timekeeper numeric;
  v_marathoner numeric;
  v_devoted numeric;
  v_critic numeric;
  v_chronicler numeric;
  v_finisher numeric;
  v_kept_the_fire numeric;
  v_honest numeric;
  v_full_picture numeric;
  v_omnivore numeric;
  v_regular numeric;
  v_resonant numeric;
begin
  if v_user_id is null then
    raise exception 'recompute_my_badges requires an authenticated user';
  end if;

  select count(*) into v_timekeeper
    from public.play_sessions where user_id = v_user_id;

  select coalesce(max(hours), 0) into v_marathoner
    from public.play_sessions where user_id = v_user_id;

  select coalesce(max(hours_played), 0) into v_devoted
    from public.game_trackers where user_id = v_user_id;

  select count(*) into v_critic
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  select count(*) into v_chronicler
    from public.journal_entries
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  -- Finisher (and Omnivore below) read completion EVENTS, never
  -- game_trackers.status. The COUNT itself is unchanged from S16-4.
  select count(distinct igdb_game_id) into v_finisher
    from public.activities
    where user_id = v_user_id
      and activity_type = 'status_changed'
      and metadata->>'to_status' = 'played';

  select coalesce(highest_streak_milestone, 0) into v_kept_the_fire
    from public.users where id = v_user_id;

  select count(*) into v_honest
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0
      and rating < 3;

  select count(*) into v_full_picture
    from public.journal_entries
    where user_id = v_user_id
      and mood is not null and hours_played is not null
      and body is not null and length(trim(body)) > 0;

  select count(distinct genre) into v_omnivore
    from (
      select distinct a.igdb_game_id
      from public.activities a
      where a.user_id = v_user_id
        and a.activity_type = 'status_changed'
        and a.metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
    cross join lateral unnest(gt.genre_names) as genre;

  select count(distinct date_trunc('month', played_on)) into v_regular
    from public.play_sessions
    where user_id = v_user_id and played_on is not null;

  select count(*) into v_resonant
    from public.review_likes rl
    join public.reviews r on r.id = rl.review_id
    where r.user_id = v_user_id;

  with computed(badge_id, value, new_tier) as (
    values
      ('timekeeper', v_timekeeper, private.badge_tier_for(v_timekeeper, 25, 150, 500)),
      ('marathoner', v_marathoner, private.badge_tier_for(v_marathoner, 4, 8, 12)),
      ('devoted', v_devoted, private.badge_tier_for(v_devoted, 50, 150, 400)),
      ('critic', v_critic, private.badge_tier_for(v_critic, 10, 50, 200)),
      ('chronicler', v_chronicler, private.badge_tier_for(v_chronicler, 15, 75, 250)),
      ('finisher', v_finisher, private.badge_tier_for(v_finisher, 10, 50, 150)),
      ('kept-the-fire', v_kept_the_fire, private.badge_tier_for(v_kept_the_fire, 7, 30, 100)),
      ('honest', v_honest, private.badge_tier_for(v_honest, 5, 20, 60)),
      ('full-picture', v_full_picture, private.badge_tier_for(v_full_picture, 10, 50, 150)),
      ('omnivore', v_omnivore, private.badge_tier_for(v_omnivore, 5, 12, 20)),
      ('regular', v_regular, private.badge_tier_for(v_regular, 3, 12, 24)),
      ('resonant', v_resonant, private.badge_tier_for(v_resonant, 25, 150, 500))
  )
  insert into public.user_badges (user_id, badge_id, tier, current_value, earned_at)
  select v_user_id, badge_id, new_tier, value, now()
  from computed
  on conflict (user_id, badge_id) do update
    set current_value = excluded.current_value,
        tier = case
          when p_allow_completion_tier_drop
            and public.user_badges.badge_id in ('finisher', 'omnivore')
            then excluded.tier
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then excluded.tier
          else public.user_badges.tier
        end,
        earned_at = case
          when p_allow_completion_tier_drop
            and public.user_badges.badge_id in ('finisher', 'omnivore')
            then case
              when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
                then now()
              else public.user_badges.earned_at
            end
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then now()
          else public.user_badges.earned_at
        end;
end;
$$;

revoke all on function public.recompute_my_badges(boolean) from public, anon;
grant execute on function public.recompute_my_badges(boolean) to authenticated;
