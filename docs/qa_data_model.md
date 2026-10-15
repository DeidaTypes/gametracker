# Community Q&A data model

Source of truth: `supabase/migrations/20261015213000_community_qa.sql`. Design: `docs/design/checkpoint_community_qa_v5.html`. Read this before writing any Q&A UI. If this page and the SQL disagree, the SQL is right.

Run order: QA-0 (`20261015211100_safety_foundation.sql`) first, then this file. Nothing is applied until you run it by hand.

## Rules the UI can rely on

- **Public board.** Any signed-in user reads every question and answer, regardless of the author's `activity_privacy`. The only exclusions are blocked pairs (both directions, no placeholder) and moderator-removed rows.
- **No fabricated data.** Games have no FK: `igdb_game_id` + copied `game_title` + `game_cover_image_id`.
- **Authors never disappear.** A deleted account shows as `author: null, author_deleted: true`. Render "Deleted user". Their answers stay.
- **Credibility pill** (`Played · 88h`, `Playing · 31h`) is read **as the viewer** from `game_trackers`. A private-activity author shows no pill to non-followers. `credibility: null` means "render nothing". `dropped` / `want_to_play` never show a pill.
- **Read through the RPCs, not the tables.** The report auto-hide (below) lives in the RPCs only.
- **Everything is signed-in only.** `anon` has no access to any table or function.

## Tables (all RLS-enabled, all `public`)

| Table | Key columns |
|---|---|
| `qa_questions` | `id`, `user_id` (null = deleted), `igdb_game_id`, `game_title`, `game_cover_image_id`, `platform` (≤40), `topic` (`boss build item location puzzle quest story strategy tech`), `title` (10–120), `body` (≤2000, default `''`), `location` (≤40), `is_spoiler`, `best_answer_id`, `best_picked_at`, `edited_at`, `removed_at`, `removed_reason`, `created_at`, `search_tsv` |
| `qa_answers` | `id`, `question_id` (cascade), `user_id` (null = deleted), `body` (1–3000), `is_spoiler`, `reply_to_user_id`, `edited_at`, `removed_at`, `removed_reason`, `created_at` |
| `qa_helpful_votes` | PK `(answer_id, user_id)`: one vote per person per answer |
| `qa_stuck` | PK `(question_id, user_id)`: "Stuck here too" |
| `qa_inbox_seen` | `user_id` PK, `seen_at` |
| `app_flags` | `key`, `enabled`, `allow_user_ids` (not client-readable). Seeded `('qa', false, '{}')` |

FK embeds need explicit hints: `users!qa_questions_user_id_fkey`, `users!qa_answers_user_id_fkey`, `users!qa_answers_reply_to_user_id_fkey`.

## Writes (direct table access)

| Action | Allowed when |
|---|---|
| Insert question | `user_id = me`, flag on for me, under the daily limit. Allowed columns only (no `created_at`, `removed_*`, `best_*`). `topic = 'story'` forces `is_spoiler = true` |
| Edit question | owner, not removed. Only `title body location topic platform is_spoiler best_answer_id`. Content edits set `edited_at` (spoiler / best toggles do not) |
| Mark best | owner sets `best_answer_id` to an answer **of this question** (else error). Sets `best_picked_at`; `null` clears both |
| Delete question | owner, not removed, **no answers from anyone** |
| Insert answer | `user_id = me`, flag on, under limit, question not removed, not blocked with the asker. `reply_to_user_id` must be someone who answered this question |
| Edit / delete answer | owner, not removed. Only `body`, `is_spoiler`; a body edit sets `edited_at` |
| Helpful | insert/delete own row; not your own answer; not a blocked author. Duplicate → `23505` |
| Stuck | insert/delete own row; not on your own question |
| Inbox | `rpc('qa_mark_inbox_seen')` |

`removed_at` / `removed_reason` are service-role / SQL-Editor only. Votes and stuck rows are readable only as your own rows (voter identity is private); counts come from the RPCs.

**Limits** (rolling 24h, by `created_at`): account under 7 days → 3 questions / 15 answers; otherwise 10 / 50. Over the limit → RLS error `42501` on insert. The UI should pre-check from its own counts and also handle the error.

**Flag.** `rpc('flag_enabled', { p_key: 'qa' })` → boolean for the current user (`enabled` OR on the allowlist). Do not `select *` from `app_flags` (the allowlist column is not readable). Flag off blocks inserts only; reads still work.

## Status

`status` is computed on read, never stored: `best` (asker picked one) · `community_pick` (question older than 7 days and its top answer has ≥ 3 helpful votes from people whose tracker for that game is `played`) · `open`. A best answer that a moderator removed no longer counts. Unanswered lists use `unanswered_label`: `no_answers` or `waiting` (has answers, none best).

## List item (every list screen)

```json
{ "id": "uuid", "title": "…", "igdb_game_id": 123, "game_title": "…", "game_cover_image_id": "co1abc|null",
  "platform": "PS4|null", "topic": "boss", "is_spoiler": false, "created_at": "ts",
  "status": "best|community_pick|open", "answer_count": 4, "helpful_on_best": 41|null,
  "best_preview": "first 80 chars|null", "unanswered_label": "no_answers|waiting|null" }
```

`best_preview` is `null` when the question or that answer is a spoiler (show "Best answer has spoilers · tap to reveal") and when `status = open`. `is_spoiler` already includes the report auto-flag. Titles always show.

## RPCs (all return one `jsonb`; `authenticated` only)

| RPC | Returns |
|---|---|
| `qa_home()` | `{ most_asked: [{igdb_game_id, game_title, game_cover_image_id, question_count}] (exactly 4 or []), answered_week: [item + week_score] (≤20), can_help: [item] (≤10), can_help_count, newest_open: [item] (≤20), inbox_has_new }` |
| `qa_game(p_igdb_game_id, p_filter='answered'\|'unanswered', p_sort='helpful'\|'newest', p_limit=30, p_before=null)` | `{ header: {question_count, answered_count, unanswered_count, answered_pct (null when 0 questions)}, items: [item + asker_username], has_more, next_before }` |
| `qa_question(p_id)` | `{ state: 'ok'\|'removed'\|'not_found' }` and, for `ok`: `question`, `status`, `pick_answer_id`, `stuck {count, viewer_stuck}`, `answers`, `viewer_is_asker` |
| `qa_search(p_query, p_igdb_game_id=null, p_limit=30)` | bare array of items (group by `game_title` client-side). Last word matches as a prefix |
| `qa_similar(p_title, p_igdb_game_id)` | bare array, ≤3 items; `[]` under 3 words. Same game first |
| `qa_mine()` | `{ asked: [item + new_answer_count], answered: [{ answer: {id, body, is_spoiler, created_at, edited_at, helpful_count, is_best}, question: item }] }`, ≤100 each, does **not** mark seen |
| `qa_mark_inbox_seen()` | `timestamptz`. Call after `qa_mine` has returned |

`qa_question.question`: `id title body location topic platform igdb_game_id game_title game_cover_image_id is_spoiler created_at edited_at best_answer_id best_picked_at is_own asker_deleted asker {id, username, display_name, avatar_url}|null asker_credibility {status:'played'|'playing', hours}|null`.

`qa_question.answers[]` is ordered best first, then helpful desc, then oldest first. A live answer: `id removed:false body is_spoiler created_at edited_at is_best is_community_pick is_own author_deleted author|null credibility|null reply_to_user_id reply_to_username|null helpful_count viewer_helpful`. A moderator-removed answer is only `{ id, removed: true, created_at }` (render "This answer was removed for breaking the rules").

`state` meanings: `removed` = moderators removed it ("This question was removed for breaking the rules"); `not_found` = deleted, never existed, blocked, or hidden from you ("This question was deleted").

Notes: `qa_game` `helpful` sort is a single page (`p_before` ignored); `newest` paginates by passing `next_before`. `newest_open` is not de-duplicated against `can_help`: drop ids you already show. `answered_week` is not filtered to non-zero scores; hide `week_score = 0` rows if you want a stricter "popular".

## Reports and auto-hide (needs QA-0)

Reports use `content_type` `'question'` / `'answer'` and reason `'unmarked_spoiler'`. Counted from pending reports, distinct reporters: **≥ 2 `unmarked_spoiler`** → RPCs return `is_spoiler: true`; **≥ 3 of any kind** → RPCs omit it for everyone except its author. Marking the reports `reviewed` / `dismissed` / `actioned` lifts it. Without QA-0 applied there is no auto-hide.

## Moderating (SQL Editor)

```sql
update qa_questions set removed_at = now(), removed_reason = '…' where id = '…';
update qa_answers   set removed_at = now(), removed_reason = '…' where id = '…';
-- undo: set removed_at = null
```
