-- Deleting an account also deletes its push tokens.
--
-- Why: delete-account soft-deletes the users row (sets deleted_at), so the
-- device_tokens → users ON DELETE CASCADE never fires. Sign-out removes only
-- the current phone's token, so a deleted account's other phones kept theirs.
-- The privacy policy says deletion removes push tokens; this makes it true.
--
-- Run once: Supabase → SQL Editor → paste ALL → Run.
-- Safe to re-run. The last line must print tokens_on_deleted_accounts = 0.

begin;

create or replace function private.clear_device_tokens_on_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.device_tokens where user_id = new.id;
  return new;
end;
$$;

revoke all on function private.clear_device_tokens_on_account_delete() from public;

drop trigger if exists users_clear_device_tokens_on_delete on public.users;
create trigger users_clear_device_tokens_on_delete
  after update of deleted_at on public.users
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.clear_device_tokens_on_account_delete();

-- Accounts deleted before today.
delete from public.device_tokens dt
 using public.users u
 where u.id = dt.user_id
   and u.deleted_at is not null;

commit;

select count(*) as tokens_on_deleted_accounts
  from public.device_tokens dt
  join public.users u on u.id = dt.user_id
 where u.deleted_at is not null;
