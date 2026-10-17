-- Q&A report Undo. A reporter can delete their own still-pending report
-- so "Reported. It's hidden for you." can be undone. Reviewed rows stay.
-- Run this in the Supabase SQL Editor. Do not apply it from the app.

begin;

drop policy if exists reports_delete_own_pending on public.reports;
create policy reports_delete_own_pending on public.reports
  for delete
  to authenticated
  using (reporter_id = auth.uid() and status = 'pending');

grant delete on table public.reports to authenticated;

notify pgrst, 'reload schema';

commit;
