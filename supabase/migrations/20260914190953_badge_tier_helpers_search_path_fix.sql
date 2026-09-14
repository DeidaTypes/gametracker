-- Fix-up: pin search_path on the two badge tier helpers to close the
-- function_search_path_mutable advisory (same class of warning already
-- present on ~10 other pre-existing functions in this project - not a
-- regression, but cheap to close on the two this migration added).
create or replace function private.badge_tier_rank(p_tier text)
returns int
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_tier
    when 'platinum' then 4
    when 'gold' then 3
    when 'silver' then 2
    when 'bronze' then 1
    else 0
  end;
$$;

create or replace function private.badge_tier_for(
  p_value numeric, p_bronze numeric, p_silver numeric, p_gold numeric
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value >= p_gold then 'gold'
    when p_value >= p_silver then 'silver'
    when p_value >= p_bronze then 'bronze'
    else null
  end;
$$;
