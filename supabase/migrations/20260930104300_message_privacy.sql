-- Recorded after a manual apply on 2026-09-30. Do not re-run by hand.
-- Idempotent: ADD COLUMN IF NOT EXISTS, and get_my_settings is replaced
-- in place. users_update_own and the table-level UPDATE grant already
-- cover the new column, so this adds no policy.

alter table public.users
  add column if not exists message_privacy text not null default 'everyone'
  constraint users_message_privacy_check
  check (message_privacy in ('everyone', 'follows', 'nobody'));

comment on column public.users.message_privacy is
  'Who may message this user: everyone, follows, nobody. Owner-only; read via get_my_settings().';

drop function if exists public.get_my_settings();

create function public.get_my_settings()
returns table(
  activity_privacy    activity_privacy_level,
  presence_opt_in     boolean,
  streak_share_opt_in boolean,
  message_privacy     text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.activity_privacy, u.presence_opt_in, u.streak_share_opt_in, u.message_privacy
  from users u
  where u.id = auth.uid();
$$;

revoke execute on function public.get_my_settings() from anon, public;
grant execute on function public.get_my_settings() to authenticated;
