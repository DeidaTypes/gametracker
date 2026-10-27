-- Q&A on for every account (Oct 27, 2026)
--
-- MANUAL RUN. Paste into the Supabase SQL Editor and run it.
--
-- Until now app_flags 'qa' was enabled = false with Ry on allow_user_ids, so
-- every other account (including brand-new ones) had no Q&A tab and the
-- database refused their questions and answers (qa_questions_insert /
-- qa_answers_insert RLS and qa_pulse all check public.flag_enabled('qa')).
--
-- This is a data change only: no schema, no RLS, no grants. The row stays as
-- a server-side kill switch. Setting enabled back to false stops new
-- questions and answers for everyone except allow_user_ids.
--
-- 'admin' is untouched (its CHECK keeps it off globally; Ry stays on its
-- allow list).

update public.app_flags
   set enabled = true
 where key = 'qa';

-- VERIFY
--   select key, enabled, cardinality(allow_user_ids) as allow_list
--     from public.app_flags order by key;
--   -- EXPECT: admin | false | 1
--   --         qa    | true  | 1
