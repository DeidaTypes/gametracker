-- Close the game_colors arbitrary-write path — the last remaining FAIL in
-- the RLS pentest matrix (2 of 265 probes: game_colors UPDATE + INSERT).
--
-- MANUAL RUN. Apply after 20260803000600_remove_pentest_userb_profile.sql.
--
-- DIAGNOSIS
--
-- game_colors_insert_authenticated and game_colors_update_authenticated (both
-- from 20260731170000) are `WITH CHECK (true)` for any authenticated user —
-- any signed-in user can overwrite the cached dominant color for ANY game,
-- not just one they're actually caching. Both Supabase security advisors
-- flag these two policies (rls_policy_always_true). The original pentest run
-- scored the INSERT probe as a PASS only because the forged igdb_game_id
-- happened to collide with an existing row and PostgREST returned 409 — not
-- because the policy denied it. A fresh id inserts cleanly; the UPDATE probe
-- always overwrote the canary row (200 both times). Re-run with a clean
-- table state: both are FAIL, and have been the whole time.
--
-- game_colors is not user-scoped data — every row is a deterministic
-- function of a game's cover art, shared and read by every client — but the
-- color is computed CLIENT-SIDE ONLY. src/services/colorExtract.js decodes
-- the cover image onto an offscreen canvas and runs a hue-histogram; there is
-- no Edge Function, cron job, or other server-side path that could ever
-- populate this table. src/services/gameColorService.js
-- (getOrExtractGameColor) is the only writer today, calling
-- `supabase.from('game_colors').upsert(...)` directly with the caller's own
-- session on a cache miss.
--
-- Locking writes to service_role only (Option B) would silently and
-- permanently break dominant-color caching, since nothing server-side could
-- ever compute a replacement. So:
--
-- FIX: OPTION A — a SECURITY DEFINER RPC, upsert_game_color(), is the only
-- write path left. It validates the payload (a real positive igdb_game_id,
-- and a dominant_color that is genuinely an "R G B" triple with each channel
-- 0-255) before upserting. The direct INSERT/UPDATE policies are dropped and
-- the table-level INSERT/UPDATE grants revoked from anon and authenticated,
-- so no role can write the base table directly anymore — RPC or nothing.
-- gameColorService.js is updated in the same change to call
-- supabase.rpc('upsert_game_color', ...) instead of .upsert(...), so
-- caching keeps working end to end.
--
-- SELECT is untouched — game_colors_select_authenticated still reads
-- `USING (true)`, exactly as before. This is a shared read cache and every
-- client needs it.

-- ============================================================
-- 1. upsert_game_color — the only write path left
-- ============================================================
create or replace function public.upsert_game_color(
  p_igdb_game_id bigint,
  p_dominant_color text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_igdb_game_id is null or p_igdb_game_id <= 0 then
    raise exception 'upsert_game_color: p_igdb_game_id must be a positive id';
  end if;

  -- Must be exactly three space-separated 1-3 digit groups (the app's
  -- "R G B" triple convention — see ReviewCard.css / --dominant-rgb).
  if p_dominant_color is null
     or p_dominant_color !~ '^[0-9]{1,3} [0-9]{1,3} [0-9]{1,3}$'
  then
    raise exception 'upsert_game_color: p_dominant_color must be an "R G B" triple';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(p_dominant_color, ' ')) as channel(v)
    where channel.v::int > 255
  ) then
    raise exception 'upsert_game_color: each RGB channel must be 0-255';
  end if;

  insert into public.game_colors (igdb_game_id, dominant_color, updated_at)
  values (p_igdb_game_id, p_dominant_color, now())
  on conflict (igdb_game_id) do update
    set dominant_color = excluded.dominant_color,
        updated_at = now();
end;
$$;

comment on function public.upsert_game_color(bigint, text) is
  'The only write path onto game_colors. SECURITY DEFINER so it can upsert despite the table having no INSERT/UPDATE policy for authenticated. Validates igdb_game_id and the "R G B" triple shape before writing — callers cannot smuggle arbitrary column values through it the way a direct table write could.';

revoke execute on function public.upsert_game_color(bigint, text) from anon, public;
grant execute on function public.upsert_game_color(bigint, text) to authenticated;

-- ============================================================
-- 2. Revoke the direct write path
-- ============================================================
drop policy if exists game_colors_insert_authenticated on public.game_colors;
drop policy if exists game_colors_update_authenticated on public.game_colors;

revoke insert, update on public.game_colors from authenticated;
revoke insert, update on public.game_colors from anon;

-- game_colors_select_authenticated is untouched — reads stay open, as does
-- the anon SELECT revoke from 20260803000050 (unrelated to this write fix).
