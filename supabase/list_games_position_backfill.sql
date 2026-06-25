-- Sprint 16B: Backfill list_games.position for any lists where items share the
-- same position value (e.g. rows inserted before the column was used correctly).
-- Uses ROW_NUMBER() ordered by added_at so the existing visual order is preserved.
-- Safe to re-run: only touches lists where COUNT(*) > COUNT(DISTINCT position).

UPDATE list_games lg
SET position = sub.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY added_at, id) AS rn
  FROM list_games
) sub
WHERE lg.id = sub.id
  AND lg.list_id IN (
    SELECT list_id FROM list_games
    GROUP BY list_id
    HAVING COUNT(*) > COUNT(DISTINCT position)
  );
