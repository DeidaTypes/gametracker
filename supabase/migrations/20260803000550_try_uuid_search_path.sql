-- Pin search_path on private.try_uuid.
--
-- 20260803000200 added this helper without a fixed search_path, which the
-- database linter flags (0011_function_search_path_mutable). Every other helper
-- added in this pass pins it; this one was missed. It is only a text->uuid cast,
-- but the helper is reached from RLS policies, so an unqualified name resolving
-- somewhere unexpected is not a risk worth carrying for the sake of one line.

begin;

create or replace function private.try_uuid(t text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

commit;
