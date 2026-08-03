-- Revoke the anon SELECT grant itself.
--
-- MANUAL RUN. Apply after 20260803000000_rls_read_lockdown.sql.
--
-- Belt and braces. The `to authenticated` clauses in 20260803000000 already stop
-- anon, but Supabase grants anon full DML on every new table by default, so the
-- grant is the thing an accidentally-permissive future policy would ride in on.
-- Revoking it means a table has to be *explicitly* re-granted to anon before it
-- can ever answer an unauthenticated request again.
--
-- Two deliberate omissions:
--   * public.reviews — anon must keep reading it (shared review links).
--   * public.users   — 20260801010205 already revoked the table-level grant and
--                      re-granted 14 safe columns; 20260803000100 narrows that
--                      further and adds the block check. Re-revoking the whole
--                      table here would break shared profile links.
--
-- Write grants (INSERT/UPDATE/DELETE) are left alone on purpose. Anon cannot use
-- them — every write policy is an auth.uid() ownership check, which no anonymous
-- caller can satisfy — and the brief is explicit that write paths stay untouched.

revoke select on public.activities          from anon;
revoke select on public.activity_events     from anon;
revoke select on public.blocked_users       from anon;
revoke select on public.comment_likes       from anon;
revoke select on public.comments            from anon;
revoke select on public.direct_messages     from anon;
revoke select on public.drop_candidate_pool from anon;
revoke select on public.drop_filter_types   from anon;
revoke select on public.drop_games          from anon;
revoke select on public.drop_history        from anon;
revoke select on public.drop_schedule       from anon;
revoke select on public.drop_themes         from anon;
revoke select on public.featured_games      from anon;
revoke select on public.follows             from anon;
revoke select on public.game_colors         from anon;
revoke select on public.game_journal        from anon;
revoke select on public.game_tags           from anon;
revoke select on public.game_trackers       from anon;
revoke select on public.journal_entries     from anon;
revoke select on public.likes               from anon;
revoke select on public.list_collaborators  from anon;
revoke select on public.list_comments       from anon;
revoke select on public.list_games          from anon;
revoke select on public.list_saves          from anon;
revoke select on public.lists               from anon;
revoke select on public.new_notable_pool    from anon;
revoke select on public.notifications       from anon;
revoke select on public.play_sessions       from anon;
revoke select on public.reactions           from anon;
revoke select on public.review_comments     from anon;
revoke select on public.review_likes        from anon;
revoke select on public.review_pins         from anon;
revoke select on public.user_badges         from anon;
revoke select on public.user_goals          from anon;
revoke select on public.user_streaks        from anon;
revoke select on public.user_swipe_signals  from anon;
revoke select on public.user_taste_vectors  from anon;
