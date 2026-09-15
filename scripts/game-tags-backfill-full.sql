-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 1 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (115, '2009-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 52026685, 50826150, '2026-09-15T15:44:09.505Z'::timestamptz),
  (123, '2004-11-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 23820010, 53208012, '2026-09-15T15:44:09.505Z'::timestamptz),
  (124, '2009-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14,12]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 104400, 550800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (472, '2011-11-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 392583, 723927, '2026-09-15T15:44:09.505Z'::timestamptz),
  (498, '2009-10-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12,49,130]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360','Xbox One','Nintendo Switch']::text[], 154800, 211680, '2026-09-15T15:44:09.505Z'::timestamptz),
  (538, '2013-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,6,14,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox 360','Xbox One']::text[], 60403, 102982, '2026-09-15T15:44:09.505Z'::timestamptz),
  (545, '2010-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,167,14,12]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox 360']::text[], 49704, 173700, '2026-09-15T15:44:09.505Z'::timestamptz),
  (548, '2008-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], 28800, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (559, '2009-11-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 32376, 39600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (964, '2002-07-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (987, '2007-09-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,12,49]::integer[], ARRAY['PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1011, '2012-09-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,14,46,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','Mac','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 239400, 524160, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1020, '2013-09-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,9,48,6,167,12,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 3','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox 360','Xbox One']::text[], 458844, 1918449, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1069, '1989-04-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,33]::integer[], ARRAY['Nintendo 3DS','Game Boy']::text[], 3300, 4500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1077, '2007-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,41]::integer[], ARRAY['Wii','Wii U']::text[], 50400, 69375, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1090, '1994-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,5,41,137,58]::integer[], ARRAY['Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], 10800, 14400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1091, '1995-06-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,33]::integer[], ARRAY['Nintendo 3DS','Game Boy']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1092, '1995-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,5,41,137,58]::integer[], ARRAY['Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], 52200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1094, '1996-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,5,41,137,58]::integer[], ARRAY['Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], null::integer, 36000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1100, '2010-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,41]::integer[], ARRAY['Wii','Wii U']::text[], 90000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1121, '2014-05-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,9,48,6,41,12,49]::integer[], ARRAY['Google Stadia','PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Wii U','Xbox 360','Xbox One']::text[], 134930, 216000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1185, '1996-09-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,34,46,7,38]::integer[], ARRAY['PlayStation 3','Android','PlayStation Vita','PlayStation','PlayStation Portable']::text[], 136800, 146400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1186, '1997-11-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,34,7,38]::integer[], ARRAY['PlayStation 3','Android','PlayStation','PlayStation Portable']::text[], 32400, 43200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1187, '1998-11-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 36000, 43200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1192, '1999-10-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 54000, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1221, '2005-12-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 117600, 196200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1242, '1994-12-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1246, '2005-02-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 97200, 140400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1267, '2012-08-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 72771, 148800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1522, '2010-09-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[20]::integer[], ARRAY['Nintendo DS']::text[], 154800, 234000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1877, '2020-12-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,508,6,167,14,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 260403, 465210, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2566, '2004-11-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 36000, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2601, '2007-05-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], 7200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2923, '2014-02-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41]::integer[], ARRAY['Wii U']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4000, '1998-10-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4002, '2000-04-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[7]::integer[], ARRAY['PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4631, '2003-04-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,9,6,8]::integer[], ARRAY['Xbox','PlayStation 3','PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5658, '1982-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[71,59,65,67,133]::integer[], ARRAY['Commodore VIC-20','Atari 2600','Atari 8-bit','Intellivision','Odyssey 2 / Videopac G7000']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6032, '2014-10-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,14,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','Mac','Xbox 360','Xbox One','Nintendo Switch']::text[], 107280, 221040, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6782, '2008-06-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7346, '2017-03-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,130]::integer[], ARRAY['Wii U','Nintendo Switch']::text[], 332160, 888480, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8253, '1980-03-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[59]::integer[], ARRAY['Atari 2600']::text[], 12600, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11116, '1981-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,69,59,157]::integer[], ARRAY['Arcade','BBC Microcomputer System','Atari 2600','NEC PC-6000 Series']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11133, '2016-03-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 185370, 381600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11737, '2019-05-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 68400, 115200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11854, '1979-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[59,65,126]::integer[], ARRAY['Atari 2600','Atari 8-bit','TRS-80']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18032, '1982-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[59]::integer[], ARRAY['Atari 2600']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19164, '2019-09-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,14,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 150000, 360000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19441, '2016-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,6,49]::integer[], ARRAY['Google Stadia','PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 137400, 154800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (21073, '2012-02-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25076, '2018-10-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,6,49]::integer[], ARRAY['Google Stadia','PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 318200, 749781, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26192, '2020-06-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,167]::integer[], ARRAY['PlayStation 4','PlayStation 5']::text[], 110883, 154774, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26472, '2019-10-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 119290, 160400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (72639, '1987-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[15,26,25]::integer[], ARRAY['Commodore C64/128/MAX','ZX Spectrum','Amstrad CPC']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76882, '2019-03-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,6,49]::integer[], ARRAY['Google Stadia','PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 150685, 181800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (78371, '1982-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[59]::integer[], ARRAY['Atari 2600']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (113112, '2020-09-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 253600, 542700, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119133, '2022-02-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 433575, 625976, '2026-09-15T15:44:09.505Z'::timestamptz),
  (133236, '2024-02-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 350400, 336000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (135400, '2016-12-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[132,169,48,3,508,388,74,34,6,39,167,14,49,130]::integer[], ARRAY['Amazon Fire TV','Xbox Series X|S','PlayStation 4','Linux','Nintendo Switch 2','Gear VR','Windows Phone','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 1512830, 6114900, '2026-09-15T15:44:09.505Z'::timestamptz),
  (152061, '2022-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 102600, 252000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (164664, '2020-10-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 214200, 311400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (172427, '2022-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 32400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (172788, '1981-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[59]::integer[], ARRAY['Atari 2600']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (189781, '2026-05-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,3,508,6,167,14,130]::integer[], ARRAY['Xbox Series X|S','Linux','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Nintendo Switch']::text[], 74400, 126000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (208417, '2024-09-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (222341, '2024-10-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 66800, 99000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (228542, '2023-08-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 224550, 422160, '2026-09-15T15:44:09.505Z'::timestamptz),
  (240452, '2017-09-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (305169, '2012-04-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[39]::integer[], ARRAY['iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (305775, '1996-03-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 30000, 43200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (306134, '1998-03-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[7]::integer[], ARRAY['PlayStation']::text[], 54000, 67200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (338106, '2025-07-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[508]::integer[], ARRAY['Nintendo Switch 2']::text[], 112200, 167760, '2026-09-15T15:44:09.505Z'::timestamptz),
  (365702, '2023-11-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[46]::integer[], ARRAY['PlayStation Vita']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (393182, '2002-03-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (15, '2008-10-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 189000, 630000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (16, '2010-10-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 189774, 341844, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20, '2007-08-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 57270, 88344, '2026-09-15T15:44:09.505Z'::timestamptz),
  (22, '1999-08-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 46800, 116280, '2026-09-15T15:44:09.505Z'::timestamptz),
  (39, '2002-08-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,6,8]::integer[], ARRAY['Xbox','PC (Microsoft Windows)','PlayStation 2']::text[], 74700, 108000, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 2 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (72, '2011-04-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,14,12,130]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Mac','Xbox 360','Nintendo Switch']::text[], 37320, 101781, '2026-09-15T15:44:09.505Z'::timestamptz),
  (75, '2012-03-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 135876, 200565, '2026-09-15T15:44:09.505Z'::timestamptz),
  (113, '2010-11-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 83604, 155520, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116, '2003-07-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,34,6,39,14,130]::integer[], ARRAY['Xbox','Android','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 139800, 254400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (121, '2011-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 3439800, 73499437, '2026-09-15T15:44:09.505Z'::timestamptz),
  (132, '2002-07-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 100440, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (293, '2005-10-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (378, '2013-02-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 54360, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (425, '1999-02-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 189000, 324000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (500, '2009-08-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,72,6,14,12,130]::integer[], ARRAY['PlayStation 3','Ouya','PC (Microsoft Windows)','Mac','Xbox 360','Nintendo Switch']::text[], 51972, 73000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (501, '2011-10-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[113,9,6,12,130]::integer[], ARRAY['OnLive Game System','PlayStation 3','PC (Microsoft Windows)','Xbox 360','Nintendo Switch']::text[], 88268, 181440, '2026-09-15T15:44:09.505Z'::timestamptz),
  (533, '2012-10-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 58045, 179190, '2026-09-15T15:44:09.505Z'::timestamptz),
  (549, '2005-03-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 33075, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (732, '2004-10-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,9,48,74,34,6,39,14,12,8]::integer[], ARRAY['Xbox','PlayStation 3','PlayStation 4','Windows Phone','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360','PlayStation 2']::text[], 122400, 112970, '2026-09-15T15:44:09.505Z'::timestamptz),
  (866, '2010-09-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 190800, 1839600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (986, '2004-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,6,49]::integer[], ARRAY['Xbox','PC (Microsoft Windows)','Xbox One']::text[], 39600, 63000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1089, '1994-06-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,33]::integer[], ARRAY['Nintendo 3DS','Game Boy']::text[], 10800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1137, '2005-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,8]::integer[], ARRAY['Xbox','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1147, '2010-08-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12]::integer[], ARRAY['PlayStation 3','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1164, '2013-03-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,34,6,39,14,12]::integer[], ARRAY['PlayStation 3','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360']::text[], 51138, 75564, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1195, '2000-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 108000, 216000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1204, '2003-08-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 180000, 252000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1371, '2009-04-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1372, '2012-08-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,14,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 590295, 129240000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1517, '2004-09-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[24]::integer[], ARRAY['Game Boy Advance']::text[], 189810, 151200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1587, '2001-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[24]::integer[], ARRAY['Game Boy Advance']::text[], 25200, 28800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1691, '2001-09-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,24]::integer[], ARRAY['Wii U','Game Boy Advance']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1871, '2012-04-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,39,14,46,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 47775, 53485, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1942, '2015-05-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 254778, 581483, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1983, '2011-07-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,39,14,46,12,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 32512, 53760, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1985, '2015-09-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], 363600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2136, '2009-10-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 56265, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2671, '2007-10-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,5,6,14,12,8]::integer[], ARRAY['PlayStation 3','Wii','PC (Microsoft Windows)','Mac','Xbox 360','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2993, '2013-10-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,34,6,39,14,46,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Xbox One']::text[], 36471, 46800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3061, '2007-02-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3156, '2006-11-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4069, '2003-08-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,24]::integer[], ARRAY['Wii U','Game Boy Advance']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5607, '2014-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6189, '2004-12-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,37,5,6,14,159]::integer[], ARRAY['Linux','Nintendo 3DS','Wii','PC (Microsoft Windows)','Mac','Nintendo DSi']::text[], 31050, 38700, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6656, '2014-04-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,48,6,12]::integer[], ARRAY['Arcade','PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7334, '2015-03-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], 136107, 206244, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7789, '2014-11-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,37,6,39,14,41,46,137,49]::integer[], ARRAY['PlayStation 4','Linux','Nintendo 3DS','PC (Microsoft Windows)','iOS','Mac','Wii U','PlayStation Vita','New Nintendo 3DS','Xbox One']::text[], 118200, 1357200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9932, '2006-10-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11169, '2020-04-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 138600, 217280, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18699, '1998-12-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,34,7,38]::integer[], ARRAY['PlayStation 3','Android','PlayStation','PlayStation Portable']::text[], 21600, 108000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18855, '2004-11-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19130, '2016-10-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 226800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26845, '2019-07-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 273320, 852840, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28287, '2017-07-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28512, '2020-08-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 158400, 522000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36926, '2018-01-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 711000, 432000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (49844, '2002-01-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,24]::integer[], ARRAY['Wii U','Game Boy Advance']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (75235, '2020-07-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,167]::integer[], ARRAY['PlayStation 4','PlayStation 5']::text[], 175222, 357720, '2026-09-15T15:44:09.505Z'::timestamptz),
  (86737, '2018-10-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (115060, '2024-03-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 173700, 259200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119171, '2023-08-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,3,6,167,14]::integer[], ARRAY['Google Stadia','Xbox Series X|S','Linux','PC (Microsoft Windows)','PlayStation 5','Mac']::text[], 475420, 20338705, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119388, '2023-05-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 420424, 634834, '2026-09-15T15:44:09.505Z'::timestamptz),
  (125642, '2024-12-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167,14]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5','Mac']::text[], 175200, 28800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (126459, '2020-06-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 1876800, 3712800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (131687, '2020-08-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (131890, '2023-08-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,34,6,39,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Xbox One','Nintendo Switch']::text[], 117600, 157440, '2026-09-15T15:44:09.505Z'::timestamptz),
  (132181, '2023-03-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,39,167,14]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','iOS','PlayStation 5','Mac']::text[], 71225, 155500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (133968, '2018-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 10800, 10800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (134799, '2022-04-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 79200, 255600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (136879, '2024-08-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 157680, 244800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (138950, '2021-03-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 214200, 360000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (143232, '2021-12-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,14]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac']::text[], 216000, 810000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (185258, '2025-10-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 360000, 360000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (217554, '2023-02-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 396000, 486000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (249324, '2026-04-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 43200, 97200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (279661, '2025-02-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 89100, 216000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (282831, '2026-09-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 145800, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (293671, '2026-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (294041, '2024-12-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 48600, 16800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (296831, '2026-03-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 109800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (305152, '2025-04-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 147888, 283104, '2026-09-15T15:44:09.505Z'::timestamptz),
  (314246, '2025-09-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 171000, 297000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (319294, '2017-10-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34]::integer[], ARRAY['Android']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (325580, '2025-07-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 32400, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (325591, '2025-05-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 95040, 205200, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 3 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (325608, '2025-09-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], null::integer, 360000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (337712, '2026-09-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (340113, '2026-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (347121, '2025-09-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Nintendo Switch']::text[], 144000, 252000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (361855, '2026-05-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 68400, 118800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (386577, '2021-09-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[26]::integer[], ARRAY['ZX Spectrum']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (14, '1998-10-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 140400, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18, '2001-07-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,9,48,34,6,39,14,12,49,8]::integer[], ARRAY['Xbox','PlayStation 3','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360','Xbox One','PlayStation 2']::text[], 39300, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (21, '2010-02-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 51600, 164400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (37, '2008-10-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 73400, 136800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (40, '2010-08-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 58070, 183600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (43, '2011-08-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 145200, 201600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (56, '2002-05-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,6]::integer[], ARRAY['Xbox','PC (Microsoft Windows)']::text[], 323088, 1116000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (59, '2006-03-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 164250, 471260, '2026-09-15T15:44:09.505Z'::timestamptz),
  (60, '1990-10-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[63,14,13,118,16,78]::integer[], ARRAY['Atari ST/STE','Mac','DOS','FM Towns','Amiga','Sega CD']::text[], 25200, 81840, '2026-09-15T15:44:09.505Z'::timestamptz),
  (61, '1991-12-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[14,13,16]::integer[], ARRAY['Mac','DOS','Amiga']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (71, '2007-10-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,34,6,14,12,130]::integer[], ARRAY['PlayStation 3','Linux','Android','PC (Microsoft Windows)','Mac','Xbox 360','Nintendo Switch']::text[], 14844, 27300, '2026-09-15T15:44:09.505Z'::timestamptz),
  (73, '2007-11-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 108560, 174922, '2026-09-15T15:44:09.505Z'::timestamptz),
  (74, '2010-01-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 133910, 222246, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76, '2009-11-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 213726, 308880, '2026-09-15T15:44:09.505Z'::timestamptz),
  (92, '1998-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,7]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (94, '2000-03-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,7]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (95, '2002-09-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], 50400, 59400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (96, '2003-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], 36000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (97, '2004-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], 57750, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (98, '2005-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,12]::integer[], ARRAY['PC (Microsoft Windows)','Xbox 360']::text[], 86400, 115200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (105, '2010-11-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 48600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (118, '2004-12-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,3,34,6,39,14,130]::integer[], ARRAY['Xbox','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 128365, 192000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119, '2011-04-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,46,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','PlayStation Vita','Xbox 360']::text[], 149040, 210000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (126, '2000-06-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 177600, 779400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (127, '2009-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 92700, 133992, '2026-09-15T15:44:09.505Z'::timestamptz),
  (128, '2007-11-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12]::integer[], ARRAY['PlayStation 3','Xbox 360']::text[], 54798, 91200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (129, '1994-11-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[149,6,14,13]::integer[], ARRAY['PC-9800 Series','PC (Microsoft Windows)','Mac','DOS']::text[], 56640, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (130, '1995-12-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[14,13]::integer[], ARRAY['Mac','DOS']::text[], 90660, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (133, '2003-07-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (134, '2001-08-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 54000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (193, '1993-06-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[14,13,16]::integer[], ARRAY['Mac','DOS','Amiga']::text[], 25200, 43290, '2026-09-15T15:44:09.505Z'::timestamptz),
  (212, '2009-10-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,14,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 78480, 183600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (223, '2000-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (224, '2004-09-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (230, '1998-03-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (231, '1998-11-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 43086, 67182, '2026-09-15T15:44:09.505Z'::timestamptz),
  (233, '2004-11-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,9,3,34,6,14,12]::integer[], ARRAY['Xbox','PlayStation 3','Linux','Android','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 48631, 73542, '2026-09-15T15:44:09.505Z'::timestamptz),
  (234, '2005-04-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 180214200, 181078200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (239, '2010-07-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 90000, 1008000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (245, '2000-10-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (247, '2007-10-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,14,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 22545, 32400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (255, '2001-08-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (257, '2004-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 64800, 136800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (260, '2009-06-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (295, '1996-11-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,13,7,38]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','DOS','PlayStation','PlayStation Portable']::text[], 54000, 126000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (299, '2005-10-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (321, '2007-03-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14,12,49]::integer[], ARRAY['PC (Microsoft Windows)','Mac','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (324, '2002-10-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 100800, 111600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (327, '1999-09-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14,23,8]::integer[], ARRAY['PC (Microsoft Windows)','Mac','Dreamcast','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (359, '2016-11-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,6,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 188652, 288000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (364, '1999-02-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, 252000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (375, '1998-09-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 43815, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (376, '2001-11-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 45300, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (379, '2004-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 49700, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (386, '2013-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,9,48,508,6,167,14]::integer[], ARRAY['Xbox Series X|S','PlayStation 3','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac']::text[], 358200, 2586600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (412, '2003-08-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 54000, 108000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (427, '1997-09-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,7,38]::integer[], ARRAY['PlayStation 3','PlayStation','PlayStation Portable']::text[], 174168, 271365, '2026-09-15T15:44:09.505Z'::timestamptz),
  (432, '2011-03-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (434, '2010-05-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 91297, 164880, '2026-09-15T15:44:09.505Z'::timestamptz),
  (438, '2004-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (440, '2006-11-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (456, '1998-12-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (457, '2013-03-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 72000, 108000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (458, '2015-11-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 108000, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (478, '2011-05-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14,12]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 101700, 180360, '2026-09-15T15:44:09.505Z'::timestamptz),
  (481, '2001-09-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 46080, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (492, '2011-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], 32400, 7149600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (494, '2011-02-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 29820, 32100, '2026-09-15T15:44:09.505Z'::timestamptz),
  (499, '2010-03-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], 66600, 129600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (503, '2010-09-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (509, '2011-10-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 72900, 104400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (512, '2011-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], 45900, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (524, '2011-05-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, 172800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (529, '2012-11-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 77760, 124080, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 4 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (530, '2012-11-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,34,6,39,14,12,130]::integer[], ARRAY['PlayStation 3','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360','Nintendo Switch']::text[], 49490, 260025, '2026-09-15T15:44:09.505Z'::timestamptz),
  (534, '2011-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,41]::integer[], ARRAY['Wii','Wii U']::text[], 164680, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (547, '2006-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], 32620, 52200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (558, '2010-03-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Xbox 360']::text[], 79200, 192320, '2026-09-15T15:44:09.505Z'::timestamptz),
  (561, '2009-09-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[113,9,6,14,12]::integer[], ARRAY['OnLive Game System','PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (564, '2009-11-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 21600, 39600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (565, '2009-10-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], 51648, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (569, '2009-08-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 46800, 86400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (571, '2010-06-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Xbox 360']::text[], 30600, 99000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (583, '2002-04-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (620, '2008-01-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, 144000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (623, '2007-11-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 32400, 64800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (642, '2000-07-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,7]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (647, '1995-09-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,4,6,14,13,32,7,38]::integer[], ARRAY['PlayStation 3','Nintendo 64','PC (Microsoft Windows)','Mac','DOS','Sega Saturn','PlayStation','PlayStation Portable']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (649, '2003-02-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (653, '2001-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,6,14,8]::integer[], ARRAY['Xbox','PC (Microsoft Windows)','Mac','PlayStation 2']::text[], null::integer, 198000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (654, '2006-09-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS']::text[], 25200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (698, '2000-10-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,8]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (699, '1998-06-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4,6,7]::integer[], ARRAY['Nintendo 64','PC (Microsoft Windows)','PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (705, '1997-11-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4,6,7]::integer[], ARRAY['Nintendo 64','PC (Microsoft Windows)','PlayStation']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (730, '2001-10-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,48,34,6,39,14,8]::integer[], ARRAY['Xbox','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation 2']::text[], 81000, 139140, '2026-09-15T15:44:09.505Z'::timestamptz),
  (731, '2008-04-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 196912, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (733, '2002-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,9,6,14,8]::integer[], ARRAY['Xbox','PlayStation 3','PC (Microsoft Windows)','Mac','PlayStation 2']::text[], 484386, 654600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (740, '2001-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,6,14,12]::integer[], ARRAY['Xbox','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 37040, 45000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (826, '2008-10-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Xbox 360']::text[], 100170, 86400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (827, '1999-06-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (836, '2003-11-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], 37200, 39600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (848, '2003-05-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (872, '2008-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (873, '2011-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,12,130]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Xbox 360','Nintendo Switch']::text[], 97020, 134748, '2026-09-15T15:44:09.505Z'::timestamptz),
  (880, '1998-01-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,21,6,7,38,23]::integer[], ARRAY['PlayStation 3','Nintendo GameCube','PC (Microsoft Windows)','PlayStation','PlayStation Portable','Dreamcast']::text[], 25980, 32400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (884, '2008-07-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,34,6,39,12]::integer[], ARRAY['Arcade','PlayStation 3','Android','PC (Microsoft Windows)','iOS','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (913, '2000-09-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,39,14,7,23]::integer[], ARRAY['PC (Microsoft Windows)','iOS','Mac','PlayStation','Dreamcast']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (914, '2001-10-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,14,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','Mac','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (915, '2002-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,14,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','Mac','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (942, '2008-10-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,5,74,34,6,39,14,130]::integer[], ARRAY['Linux','Wii','Windows Phone','Android','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 24400, 36000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (960, '2012-05-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 41622, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (965, '2001-10-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 27480, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (974, '2005-01-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 86400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (979, '2011-11-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 47700, 82800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (980, '1997-10-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,4,6,13,7,38]::integer[], ARRAY['PlayStation 3','Nintendo 64','PC (Microsoft Windows)','DOS','PlayStation','PlayStation Portable']::text[], 28800, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1006, '2012-02-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, 158400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1009, '2013-06-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], 71621, 147975, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1022, '1986-02-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[51,37,5,99,41,18]::integer[], ARRAY['Family Computer Disk System','Nintendo 3DS','Wii','Family Computer','Wii U','Nintendo Entertainment System']::text[], 25200, 30600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1026, '1991-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[306,19,5,41,137,58]::integer[], ARRAY['Satellaview','Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], null::integer, 30600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1029, '1998-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,416,41]::integer[], ARRAY['Wii','Nintendo 64','64DD','Wii U']::text[], 111888, 164700, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1030, '2000-04-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,416,41]::integer[], ARRAY['Wii','Nintendo 64','64DD','Wii U']::text[], 84320, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1032, '2001-02-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[22,37]::integer[], ARRAY['Game Boy Color','Nintendo 3DS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1033, '2002-12-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 117820, 149400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1035, '2004-11-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,41,24]::integer[], ARRAY['Nintendo 3DS','Wii U','Game Boy Advance']::text[], 57600, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1036, '2006-12-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 108000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1037, '2007-06-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,20]::integer[], ARRAY['Wii U','Nintendo DS']::text[], 72000, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1070, '1990-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,19,5,41,137,58]::integer[], ARRAY['Arcade','Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], 18000, 36000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1074, '1996-06-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,41]::integer[], ARRAY['Wii','Nintendo 64','Wii U']::text[], 46800, 50520, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1081, '2014-04-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,14,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1183, '2012-08-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 327600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1217, '1999-12-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,49,23]::integer[], ARRAY['PlayStation 4','Xbox One','Dreamcast']::text[], 288000, 432000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1238, '2012-09-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,12]::integer[], ARRAY['Arcade','PlayStation 3','Xbox 360']::text[], 172800, 64800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1243, '1995-06-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1244, '1997-03-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1247, '2007-11-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,38,12]::integer[], ARRAY['Arcade','PlayStation 3','PlayStation Portable','Xbox 360']::text[], 140400, 64800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1249, '1999-07-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1262, '2014-03-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One','Nintendo Switch']::text[], 45120, 76500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1269, '2012-08-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,41,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Wii U','Xbox 360']::text[], 126000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1270, '2010-01-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Xbox 360']::text[], 88200, 115200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1277, '2009-05-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,74,34,6,39,14,46,12,159]::integer[], ARRAY['PlayStation 3','Windows Phone','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Nintendo DSi']::text[], 50400, 198615, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1279, '2014-03-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1318, '2012-10-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,34,6,39,14,12]::integer[], ARRAY['PlayStation 3','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360']::text[], 110053, 194400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1331, '2010-07-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,39,14,46,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 13048, 22577, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1333, '1972-11-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,6,377,55]::integer[], ARRAY['Arcade','PC (Microsoft Windows)','Plug & Play','Legacy Mobile Device']::text[], 2440, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1334, '2013-08-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,74,34,6,39,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Windows Phone','Android','PC (Microsoft Windows)','iOS','Xbox 360','Xbox One','Nintendo Switch']::text[], 11560, 19980, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1377, '2012-06-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,3,6,14,12]::integer[], ARRAY['PlayStation 3','Linux','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 22824, 36240, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1384, '2012-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,9,48,3,34,6,167,14,46,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','PlayStation 5','Mac','PlayStation Vita','Xbox One','Nintendo Switch']::text[], 20150, 42711, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1404, '1996-04-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,80,9,3,5,34,6,39,14,38,136]::integer[], ARRAY['Arcade','Neo Geo AES','PlayStation 3','Linux','Wii','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Portable','Neo Geo CD']::text[], 10800, 21600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1407, '1998-01-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,80,9,79,5,34,6,39,46,38,136]::integer[], ARRAY['Arcade','Neo Geo AES','PlayStation 3','Neo Geo MVS','Wii','Android','PC (Microsoft Windows)','iOS','PlayStation Vita','PlayStation Portable','Neo Geo CD']::text[], 10800, 21600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1408, '2000-01-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,80,82,79,5,12,49]::integer[], ARRAY['Arcade','Neo Geo AES','Web browser','Neo Geo MVS','Wii','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1426, '2005-09-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[20]::integer[], ARRAY['Nintendo DS']::text[], null::integer, 93600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1427, '2006-03-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,20]::integer[], ARRAY['PC (Microsoft Windows)','Nintendo DS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1428, '2007-08-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,6,20]::integer[], ARRAY['Wii','PC (Microsoft Windows)','Nintendo DS']::text[], 54000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1528, '2001-12-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,8]::integer[], ARRAY['PlayStation 4','PlayStation 2']::text[], 37800, 33160, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 5 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (1561, '1996-02-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,33]::integer[], ARRAY['Nintendo 3DS','Game Boy']::text[], 137700, 216000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1565, '2002-07-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1566, '2005-10-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1567, '2008-07-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12]::integer[], ARRAY['PlayStation 3','Xbox 360']::text[], 97200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1570, '2002-02-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11]::integer[], ARRAY['Xbox']::text[], 55800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1594, '1997-12-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[7]::integer[], ARRAY['PlayStation']::text[], 90000, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1595, '2013-08-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, 359996400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1602, '2010-11-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1618, '1992-08-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,13,16]::integer[], ARRAY['Arcade','DOS','Amiga']::text[], 3600, 7200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1619, '1994-01-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,19,30,29,13,16,32,7]::integer[], ARRAY['Arcade','PlayStation 3','Super Nintendo Entertainment System','Sega 32X','Sega Mega Drive/Genesis','DOS','Amiga','Sega Saturn','PlayStation']::text[], 3600, 10800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1624, '1997-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,13]::integer[], ARRAY['PC (Microsoft Windows)','DOS']::text[], 54000, 54960, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1626, '1999-01-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4]::integer[], ARRAY['Wii','Nintendo 64']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1627, '2001-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], null::integer, 1080000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1628, '2008-01-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1653, '1992-12-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,3,5,29,34,6,39,14,12]::integer[], ARRAY['Arcade','PlayStation 3','Linux','Wii','Sega Mega Drive/Genesis','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360']::text[], null::integer, 16680, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1802, '1995-03-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[306,19,5,58]::integer[], ARRAY['Satellaview','Super Nintendo Entertainment System','Wii','Super Famicom']::text[], 105075, 162000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1876, '2008-09-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 72000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1879, '2011-05-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,9,48,3,37,74,34,6,39,14,41,46,12,49,130]::integer[], ARRAY['Google Stadia','PlayStation 3','PlayStation 4','Linux','Nintendo 3DS','Windows Phone','Android','PC (Microsoft Windows)','iOS','Mac','Wii U','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 243000, 2772000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1887, '2014-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], 257673, 443454, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1904, '2013-08-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 613800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1905, '2020-06-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 1072800, 45087428, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1911, '2013-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,167,14,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 194400, 720000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1918, '2013-04-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,41,12]::integer[], ARRAY['PlayStation 3','Wii U','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1970, '2013-10-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,9,48,6,41,12,49,130]::integer[], ARRAY['Google Stadia','PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Wii U','Xbox 360','Xbox One','Nintendo Switch']::text[], 129690, 206100, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1976, '2013-05-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12,130]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360','Nintendo Switch']::text[], 23400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1979, '2013-10-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], 53500, 249600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (1990, '2010-01-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,72,3,37,34,6,39,14,46,130]::integer[], ARRAY['PlayStation 4','Ouya','Linux','Nintendo 3DS','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Nintendo Switch']::text[], 12000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2002, '2014-02-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 43200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2025, '2010-03-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One']::text[], 292290, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2031, '2014-05-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], 43762, 89130, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2040, '2005-10-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 162000, 216000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2058, '2013-08-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,6,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','PC (Microsoft Windows)','Xbox 360','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2066, '2011-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,46,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','PlayStation Vita','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2138, '2013-05-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], 108000, 122400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2148, '1998-06-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4]::integer[], ARRAY['Nintendo 64']::text[], null::integer, 66240, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2153, '2012-09-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2155, '2011-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One','Nintendo Switch']::text[], 178560, 409500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2159, '2008-05-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,9,6,14,12]::integer[], ARRAY['Arcade','PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], null::integer, 68400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2174, '2012-11-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,34,39,41,46,12]::integer[], ARRAY['PlayStation 3','Android','iOS','Wii U','PlayStation Vita','Xbox 360']::text[], 25200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2181, '2006-11-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], 46800, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2182, '2009-07-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2183, '2008-04-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2207, '2005-10-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 32925, 70200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2239, '2001-10-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 14400, 14400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2252, '2006-10-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 43200, 64800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2286, '2013-10-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], 144000, 684000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2327, '1998-12-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4]::integer[], ARRAY['Nintendo 64']::text[], 100800, 151200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2328, '1999-12-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,416,41]::integer[], ARRAY['Wii','Nintendo 64','64DD','Wii U']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2329, '2000-12-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4]::integer[], ARRAY['Nintendo 64']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2332, '1992-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,5,41,137,58]::integer[], ARRAY['Super Nintendo Entertainment System','Wii','Wii U','New Nintendo 3DS','Super Famicom']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2336, '2012-03-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5]::integer[], ARRAY['Wii']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2342, '1996-12-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,41]::integer[], ARRAY['Wii','Nintendo 64','Wii U']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2343, '2001-07-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,41,24]::integer[], ARRAY['Nintendo 3DS','Wii U','Game Boy Advance']::text[], 36000, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2344, '2003-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 36000, 43200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2345, '2005-11-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41,20]::integer[], ARRAY['Wii U','Nintendo DS']::text[], 54000, 79200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2349, '2011-12-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], 14400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2350, '2014-05-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41]::integer[], ARRAY['Wii U']::text[], 28800, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2364, '2010-06-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,41]::integer[], ARRAY['Wii','Wii U']::text[], 234000, 298800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2365, '2005-08-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,39,14,16]::integer[], ARRAY['Linux','PC (Microsoft Windows)','iOS','Mac','Amiga']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2368, '2014-03-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 216514, 316080, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2369, '2006-10-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 32400, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2473, '1993-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,6,14,24,58]::integer[], ARRAY['Super Nintendo Entertainment System','PC (Microsoft Windows)','Mac','Game Boy Advance','Super Famicom']::text[], 2700, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2484, '2006-04-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,8]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2552, '2015-09-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One']::text[], 215542, 250800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2587, '2010-05-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12,49]::integer[], ARRAY['PlayStation 3','Xbox 360','Xbox One']::text[], 46800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2599, '2012-12-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14,130]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 39150, 123600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2629, '2010-09-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,5,12]::integer[], ARRAY['PlayStation 3','Wii','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2668, '2006-06-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,3,6,14,49,8]::integer[], ARRAY['Xbox','Linux','PC (Microsoft Windows)','Mac','Xbox One','PlayStation 2']::text[], 73200, 125880, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2698, '2003-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], 25200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2699, '2004-10-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2700, '2007-10-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12]::integer[], ARRAY['PlayStation 3','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2750, '1980-05-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], 3600, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2878, '1985-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[75]::integer[], ARRAY['Apple II']::text[], null::integer, 199500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2899, '1994-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[19,41,137,24,58]::integer[], ARRAY['Super Nintendo Entertainment System','Wii U','New Nintendo 3DS','Game Boy Advance','Super Famicom']::text[], 90000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2909, '2013-11-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], 60360, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2920, '2013-09-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 4920, 4920, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2935, '2013-08-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14,46]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita']::text[], 22335, 114040, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2941, '2012-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2946, '2011-09-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2963, '2013-07-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 5423724, 20976030, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 6 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (2985, '2012-06-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[46]::integer[], ARRAY['PlayStation Vita']::text[], 468090, 591400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (2990, '2009-10-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,39,14,46,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox One','Nintendo Switch']::text[], 20400, 19440, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3000, '1993-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[29]::integer[], ARRAY['Sega Mega Drive/Genesis']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3012, '2007-09-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3015, '2013-07-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,14,46,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Mac','PlayStation Vita','Xbox 360']::text[], 6495, 14400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3022, '2014-05-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,39,14,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 26910, 54771, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3024, '1992-03-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,19,13,16,38]::integer[], ARRAY['PlayStation 3','Super Nintendo Entertainment System','DOS','Amiga','PlayStation Portable']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3025, '2014-09-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,6,14,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox 360','Xbox One']::text[], 64440, 204214, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3070, '2012-10-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,6,167,14,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 190800, 493200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3075, '2012-09-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,39,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','iOS','Mac']::text[], 74010, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3097, '2013-12-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,72,34,6,39,14,46,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Ouya','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox 360','Xbox One','Nintendo Switch']::text[], 36210, 45500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3133, '2009-10-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,12]::integer[], ARRAY['PlayStation 3','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3152, '2013-04-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3154, '2004-12-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3155, '2006-03-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,12]::integer[], ARRAY['PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3174, '2009-10-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3186, '1991-02-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52]::integer[], ARRAY['Arcade']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3191, '2014-04-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,12,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3193, '2012-10-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 72000, 115200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3225, '2016-08-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,390,48,508,165,6,163,167,14,385,49]::integer[], ARRAY['Xbox Series X|S','PlayStation VR2','PlayStation 4','Nintendo Switch 2','PlayStation VR','PC (Microsoft Windows)','SteamVR','PlayStation 5','Mac','Oculus Rift','Xbox One']::text[], 277200, 354870, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3235, '2010-05-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3251, '2012-08-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[73,3,34,6,39,14]::integer[], ARRAY['BlackBerry OS','Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, 17400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3265, '2009-02-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], 21600, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3277, '2018-02-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 1858500, 11543040, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3278, '2004-12-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 120604800, 145800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3349, '2004-07-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], 89580, 144000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3406, '2000-07-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,4,41]::integer[], ARRAY['Wii','Nintendo 64','Wii U']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3418, '2000-11-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[4]::integer[], ARRAY['Nintendo 64']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3601, '1978-06-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,39,411,55]::integer[], ARRAY['Arcade','iOS','Handheld Electronic LCD','Legacy Mobile Device']::text[], 3600, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3715, '1993-11-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,33]::integer[], ARRAY['Nintendo 3DS','Game Boy']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3772, '2018-06-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,34,6,39,167,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Xbox One','Nintendo Switch']::text[], 79200, 278400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3783, '2002-05-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (3994, '2001-05-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,7,23]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation','Dreamcast']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4068, '1999-04-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[22]::integer[], ARRAY['Game Boy Color']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4539, '1994-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[29]::integer[], ARRAY['Sega Mega Drive/Genesis']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (4643, '2002-04-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5025, '2011-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,3,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','Linux','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 13612, 18720, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5231, '2006-11-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[5,8]::integer[], ARRAY['Wii','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5328, '2014-03-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], 11250, 100800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5503, '2015-06-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 141894, 207600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5551, '2014-01-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,46]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','PlayStation Vita']::text[], null::integer, 25200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5589, '2012-08-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,39]::integer[], ARRAY['Android','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5833, '2006-02-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (5850, '2005-10-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,48,6,14,8]::integer[], ARRAY['Xbox','PlayStation 4','PC (Microsoft Windows)','Mac','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6023, '1992-10-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[114,9,19,39,13,16,62,46,38]::integer[], ARRAY['Amiga CD32','PlayStation 3','Super Nintendo Entertainment System','iOS','DOS','Amiga','Atari Jaguar','PlayStation Vita','PlayStation Portable']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6036, '2014-07-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], 84508, 139410, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6165, '1992-04-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[13]::integer[], ARRAY['DOS']::text[], null::integer, 198000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6204, '2006-11-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,38,8]::integer[], ARRAY['Xbox','PlayStation Portable','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6341, null::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6692, '1999-09-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[42,7,23]::integer[], ARRAY['N-Gage','PlayStation','Dreamcast']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6707, '2014-11-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,34,6,39,14,12,49,130]::integer[], ARRAY['PlayStation 3','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360','Xbox One','Nintendo Switch']::text[], 43200, 72000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (6801, '2014-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,9,48,6,167,12,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 3','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox 360','Xbox One']::text[], 94800, 157200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7020, '2012-06-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7099, '2013-03-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7102, '2008-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[12]::integer[], ARRAY['Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7194, '2009-10-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,34,6,39,46,38,12]::integer[], ARRAY['PlayStation 3','PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation Vita','PlayStation Portable','Xbox 360']::text[], 72000, 144000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7219, '2005-10-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[11,21,6,8]::integer[], ARRAY['Xbox','Nintendo GameCube','PC (Microsoft Windows)','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7226, '2008-04-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,38,12,8]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','PlayStation Portable','Xbox 360','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7292, '2015-04-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 90000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7313, '2015-06-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7323, '2015-11-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,3,165,6,14,12,49]::integer[], ARRAY['Google Stadia','PlayStation 4','Linux','PlayStation VR','PC (Microsoft Windows)','Mac','Xbox 360','Xbox One']::text[], 78714, 175731, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7331, '2016-05-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], 61058, 61200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7342, '2016-06-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 12604, 17755, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7344, '2015-03-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,49,130]::integer[], ARRAY['PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 31650, 44322, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7350, '2017-06-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 25200, 36000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7351, '2016-05-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 61748, 146400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7498, '2017-06-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,165,6,49]::integer[], ARRAY['PlayStation 4','PlayStation VR','PC (Microsoft Windows)','Xbox One']::text[], null::integer, 32400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7504, '2018-04-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,163]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','SteamVR']::text[], 60171, 102000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7574, '2014-09-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,49]::integer[], ARRAY['PlayStation 4','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7585, '2019-06-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,163]::integer[], ARRAY['PC (Microsoft Windows)','SteamVR']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7592, '2002-12-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,13]::integer[], ARRAY['PC (Microsoft Windows)','DOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7593, '2004-11-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7599, '2015-01-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,3,34,6,39,14,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox 360','Xbox One']::text[], 56228, 75550, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7601, '2015-09-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7603, '2017-08-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 28452, 37400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7706, '2014-11-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One']::text[], 73680, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7739, '1999-05-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7842, '2010-11-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14,46,38]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','PlayStation Portable']::text[], 142800, 151200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (7862, '2001-12-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[21]::integer[], ARRAY['Nintendo GameCube']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8173, '2016-05-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 2917800, 90000, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 7 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (8197, '1989-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[18]::integer[], ARRAY['Nintendo Entertainment System']::text[], 3600, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8247, '2000-02-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,11,23,8]::integer[], ARRAY['Arcade','Xbox','Dreamcast','PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8422, '2013-07-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14,46]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8456, '2014-10-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8469, '1999-11-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,7,23]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation','Dreamcast']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8479, '2014-09-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8682, '2015-01-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,46,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','Xbox One','Nintendo Switch']::text[], 37800, 32400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8838, '2008-10-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,6,12]::integer[], ARRAY['PlayStation 3','PC (Microsoft Windows)','Xbox 360']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (8968, '2014-11-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], 27000, 122400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9061, '2017-09-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 63490, 75600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9066, '2015-03-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,3,6,14]::integer[], ARRAY['Google Stadia','Linux','PC (Microsoft Windows)','Mac']::text[], 315600, 201600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9174, '2017-04-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,34,6,39,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Xbox One','Nintendo Switch']::text[], 13009, 32400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9243, '2015-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9278, '2014-09-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], 61200, 1216800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9460, '2005-04-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9472, '2015-07-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9543, '2009-12-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[20]::integer[], ARRAY['Nintendo DS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9602, '2014-11-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[41]::integer[], ARRAY['Wii U']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9604, '2013-02-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82,34]::integer[], ARRAY['Web browser','Android']::text[], 3920, 1557481, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9621, '2014-09-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], 360000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9630, '2015-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 271117, 707850, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9655, '2015-01-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 35280, 70200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9694, '2012-07-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,39,14,46,38,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','iOS','Mac','PlayStation Vita','PlayStation Portable','Nintendo Switch']::text[], 183360, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9789, '2018-10-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9927, '2016-09-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48]::integer[], ARRAY['PlayStation 3','PlayStation 4']::text[], 429206, 702000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (9928, '2015-12-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,385,49]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Oculus Rift','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (10297, '2012-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (10776, '2014-12-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (10919, '2016-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 162000, 244800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (10929, '2014-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (10964, '2017-04-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11059, '2016-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 48600, 120600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11071, '2015-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11156, '2017-02-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,167]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','PlayStation 5']::text[], 212355, 301068, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11171, '2017-03-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 170070, 324000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11182, '2016-04-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,3,34,6,39,14,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 198000, 558000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11198, '2015-07-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,6,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 439200, 4431600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11208, '2017-02-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 120009, 276726, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11227, '1995-09-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[306,19,130,58]::integer[], ARRAY['Satellaview','Super Nintendo Entertainment System','Nintendo Switch','Super Famicom']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11233, '2017-04-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 9153, 9066, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11260, '2015-01-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 117000, 212400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11270, '2012-12-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6]::integer[], ARRAY['Linux','PC (Microsoft Windows)']::text[], 27000, 52560, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11346, '2015-06-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], 12108, 15300, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11397, '2015-03-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 187848, 414000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11549, '2016-06-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,37,6,46,49]::integer[], ARRAY['PlayStation 4','Nintendo 3DS','PC (Microsoft Windows)','PlayStation Vita','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11582, '2016-05-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,6,167,14,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 282600, 1483200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11625, '2012-09-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,130]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Nintendo Switch']::text[], 7590, 9840, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11642, '2013-08-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], 9336400, 294064560, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11646, '2014-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,41,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Wii U','Xbox One','Nintendo Switch']::text[], 25200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11667, '2017-07-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)']::text[], 241620, 393240, '2026-09-15T15:44:09.505Z'::timestamptz),
  (11800, '2017-09-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,39,14]::integer[], ARRAY['PC (Microsoft Windows)','iOS','Mac']::text[], 456000, 576000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (12517, '2015-09-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,46,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','PlayStation Vita','Xbox One','Nintendo Switch']::text[], 29997, 46628, '2026-09-15T15:44:09.505Z'::timestamptz),
  (12579, '2017-01-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,34,6,39,46,130]::integer[], ARRAY['PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation Vita','Nintendo Switch']::text[], 147600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (12595, '2016-01-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,9,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 3','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 118290, 309600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (13210, '2016-09-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (14394, '2017-03-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (14593, '2017-02-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,508,6,167,14,41,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Wii U','Xbox One','Nintendo Switch']::text[], 131119, 263537, '2026-09-15T15:44:09.505Z'::timestamptz),
  (14647, '2015-11-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], 24780, 31940, '2026-09-15T15:44:09.505Z'::timestamptz),
  (15894, '2016-06-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (16036, '1993-11-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,5,29,6,14,24]::integer[], ARRAY['Linux','Wii','Sega Mega Drive/Genesis','PC (Microsoft Windows)','Mac','Game Boy Advance']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (17000, '2016-02-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,508,34,6,39,14,41,46,49,130]::integer[], ARRAY['PlayStation 4','Linux','Nintendo Switch 2','Android','PC (Microsoft Windows)','iOS','Mac','Wii U','PlayStation Vita','Xbox One','Nintendo Switch']::text[], 324000, 747900, '2026-09-15T15:44:09.505Z'::timestamptz),
  (17548, '2015-02-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18011, '2015-12-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], 7956, 16920, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18182, '2016-03-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 18000, 44400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18433, '2016-08-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 22800, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18730, '2013-06-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82,3,6,14]::integer[], ARRAY['Web browser','Linux','PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (18822, '2017-07-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac']::text[], 57600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19007, '2000-10-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[23]::integer[], ARRAY['Dreamcast']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19085, '2016-12-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,508,6,167,14,49]::integer[], ARRAY['PlayStation 4','Linux','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], 145950, 146160, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19404, '2017-01-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19459, '2016-09-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19470, '2017-05-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 57600, 187200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19474, '2018-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,34,6,39,49]::integer[], ARRAY['PlayStation 4','Android','PC (Microsoft Windows)','iOS','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19531, '2017-05-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 103656, 134020, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19560, '2018-04-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,167]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','PlayStation 5']::text[], 117189, 171968, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19562, '2017-01-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,508,165,6,39,167,14,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PlayStation VR','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One']::text[], 39065, 93600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19565, '2018-09-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], 97714, 165202, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19686, '2019-01-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,39,167,14,49]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One']::text[], 46517, 108000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (19835, '2004-09-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[24]::integer[], ARRAY['Game Boy Advance']::text[], 50400, 72000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20048, '2015-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 105750, 169200, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 8 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (20150, '2019-04-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14,49,130]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 20700, 50400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20228, '2014-10-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One']::text[], 98400, 148628, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20286, '2007-03-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], 80580, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20329, '2017-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,3,34,6,39,14,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 19800, 28800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (20342, '2015-10-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,41,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Wii U','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (21084, '2011-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (22117, '2013-11-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,39]::integer[], ARRAY['Android','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (22436, '2016-08-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,3,34,6,39,14]::integer[], ARRAY['Google Stadia','Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (22704, '2016-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14,130]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac','Nintendo Switch']::text[], 23468, 28800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (23193, '2017-11-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,49]::integer[], ARRAY['PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (23248, '2018-04-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One']::text[], 135600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (23733, '2022-03-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 65520, 112200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25222, '2016-10-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], 16080, 20460, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25311, '2018-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 108000, 212400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25623, '2017-03-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37,130]::integer[], ARRAY['Nintendo 3DS','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25646, '2017-08-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,165,6,49,130]::integer[], ARRAY['PlayStation 4','PlayStation VR','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (25935, '2021-09-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 13440, 18000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26194, '2017-09-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48]::integer[], ARRAY['PlayStation 4']::text[], null::integer, 72000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26226, '2018-01-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,3,6,14,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 76556, 195750, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26574, '2016-12-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26709, '2017-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26758, '2017-10-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[508,130]::integer[], ARRAY['Nintendo Switch 2','Nintendo Switch']::text[], 66908, 247125, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26764, '2017-04-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[508,130]::integer[], ARRAY['Nintendo Switch 2','Nintendo Switch']::text[], 30600, 270000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26820, '2019-09-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 90514, 154800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (26916, '2017-03-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 23970, 43200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27081, '2017-09-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27093, '2016-11-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27367, '2018-05-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 19800, 30900, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27384, '2018-08-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 140400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27725, '2018-01-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS']::text[], 14940, 15400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (27789, '2017-12-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 16800, 10800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28070, '2018-09-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28168, '2019-09-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 120000, 162000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28309, '2018-07-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,130]::integer[], ARRAY['PC (Microsoft Windows)','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28540, '2017-10-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 187200, 298850, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28751, '2017-07-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 99210, 1832610, '2026-09-15T15:44:09.505Z'::timestamptz),
  (28862, '2017-09-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9,48,6,12,49]::integer[], ARRAY['PlayStation 3','PlayStation 4','PC (Microsoft Windows)','Xbox 360','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (30229, '2019-02-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (31515, '2020-04-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (34155, '2016-04-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36198, '2019-09-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 66780, 91800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36269, '2014-10-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36553, '2017-06-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36732, '2004-06-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[8]::integer[], ARRAY['PlayStation 2']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36872, '2017-10-03T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,49]::integer[], ARRAY['PC (Microsoft Windows)','Xbox One']::text[], 140400, 381600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (36911, '2018-01-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 54000, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (40477, '2019-01-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,34,6,39,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 176400, 1062000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (47823, '2019-11-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55036, '2019-04-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 104400, 504000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55038, '2018-09-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 7200, 10800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55056, '2019-11-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167,14,49]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55190, '2019-01-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,3,34,6,39,14,49,130]::integer[], ARRAY['Google Stadia','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 14400, 18000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55199, '2019-01-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (55935, '2017-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], 30075, 47244, '2026-09-15T15:44:09.505Z'::timestamptz),
  (56033, '2018-06-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (58114, '2019-08-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (64244, '2009-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82]::integer[], ARRAY['Web browser']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (65827, '2017-09-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,34,6,39,14]::integer[], ARRAY['Linux','Android','PC (Microsoft Windows)','iOS','Mac']::text[], 1800000, 5400000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (68286, '2019-04-11T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (69547, '2018-08-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac']::text[], 252000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (71628, '2018-08-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,167,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 55800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76253, '2019-03-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,508,6,49]::integer[], ARRAY['PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','Xbox One']::text[], 31500, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76263, '2023-03-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76852, '2016-05-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[37]::integer[], ARRAY['Nintendo 3DS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76885, '2018-10-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (76888, '2022-10-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (78550, '2018-08-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 32400, 54000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (79247, '1995-10-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (79824, '2013-02-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39,14]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS','Mac']::text[], 6807600, 27131400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (80468, '2010-04-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[9]::integer[], ARRAY['PlayStation 3']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (80916, '2018-05-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (81249, null::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (81275, '2018-05-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[3,6,14,130]::integer[], ARRAY['Linux','PC (Microsoft Windows)','Mac','Nintendo Switch']::text[], 25200, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (81680, '2021-03-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,14,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (82090, '2018-10-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,49]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','Xbox One']::text[], null::integer, 633600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (83731, '2018-05-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[386,390,161,165,163,471,385,384]::integer[], ARRAY['Meta Quest 2','PlayStation VR2','Windows Mixed Reality','PlayStation VR','SteamVR','Meta Quest 3','Oculus Rift','Oculus Quest']::text[], 41400, 3600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (88223, '2018-01-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,39]::integer[], ARRAY['Android','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (89550, '2019-02-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (90099, '2019-03-15T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 161100, 252900, '2026-09-15T15:44:09.505Z'::timestamptz),
  (90101, '2018-12-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 360000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 9 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (96209, '2018-09-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (96217, '2019-03-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (100359, '2018-08-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (101608, '2018-06-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (102122, '2018-08-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103275, '2018-09-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,49]::integer[], ARRAY['PlayStation 4','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103288, '2019-02-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, 136800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103298, '2020-03-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 70700, 95310, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103301, '2019-07-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,6,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], 48600, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103329, '2019-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 76745, 112080, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103339, '2018-10-05T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103341, '2018-08-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,508,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','Nintendo Switch 2','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], 28800, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (103369, '2019-07-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (105049, '2019-08-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 70350, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (105269, '2018-07-17T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 1512000, 248400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (105322, '2018-09-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (105482, '2019-09-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (106805, '2019-05-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,39]::integer[], ARRAY['Android','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (106987, '2020-06-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (107262, '2020-04-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,48,3,34,6,39,14,49,130]::integer[], ARRAY['Google Stadia','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','Mac','Xbox One','Nintendo Switch']::text[], 11400, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (107300, '2018-10-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,34,6,39,49,130]::integer[], ARRAY['PlayStation 4','Android','PC (Microsoft Windows)','iOS','Xbox One','Nintendo Switch']::text[], 206040, 190800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (107318, '2020-09-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (109277, '2019-06-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[52,170,169,48,34,6,39,49,130]::integer[], ARRAY['Arcade','Google Stadia','Xbox Series X|S','PlayStation 4','Android','PC (Microsoft Windows)','iOS','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (109462, '2020-03-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 347040, 576000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (109606, '2019-04-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,46]::integer[], ARRAY['PlayStation 4','PlayStation Vita']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (111253, '2019-05-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,3,6,14,49,130]::integer[], ARRAY['PlayStation 4','Linux','PC (Microsoft Windows)','Mac','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (112412, '2019-07-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,14]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac']::text[], 216000, 990000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (112659, '2018-11-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], 180000, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (112875, '2022-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,167]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','PlayStation 5']::text[], 134830, 211464, '2026-09-15T15:44:09.505Z'::timestamptz),
  (112916, '2019-04-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49,130]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], null::integer, 176400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (113362, null::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (113598, '2021-09-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 68400, 95400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (113895, '2019-04-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (114145, '2006-02-14T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82]::integer[], ARRAY['Web browser']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (114286, '2019-08-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (114287, '2019-09-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (115078, '2024-08-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (115280, '2019-08-22T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (115289, '2025-09-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,508,6,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 185400, 295200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (115843, '2021-11-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 10800, 20400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116349, '2013-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34]::integer[], ARRAY['Android']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116350, '2014-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34]::integer[], ARRAY['Android']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116352, '2017-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34]::integer[], ARRAY['Android']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116353, '2018-12-31T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34]::integer[], ARRAY['Android']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116417, '2019-09-06T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49,130]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One','Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (116992, '2021-04-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (117526, '2019-04-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82,6]::integer[], ARRAY['Web browser','PC (Microsoft Windows)']::text[], 21600, 58500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (117605, '2019-08-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,14]::integer[], ARRAY['PC (Microsoft Windows)','Mac']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (118218, '2019-10-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[170,169,48,6,167,49]::integer[], ARRAY['Google Stadia','Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119260, '2020-03-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,49]::integer[], ARRAY['PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119313, '2020-08-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,34,6,39,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Xbox One','Nintendo Switch']::text[], 102860, 194700, '2026-09-15T15:44:09.505Z'::timestamptz),
  (119422, '2019-09-10T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,6,49]::integer[], ARRAY['PlayStation 4','PC (Microsoft Windows)','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (124701, '2020-04-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[34,6,39]::integer[], ARRAY['Android','PC (Microsoft Windows)','iOS']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (133887, '2020-09-04T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 43200, 126000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (134709, '2022-04-12T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,167]::integer[], ARRAY['Xbox Series X|S','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (135243, '2021-03-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 53064, 71617, '2026-09-15T15:44:09.505Z'::timestamptz),
  (139090, '2021-10-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,6,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','PC (Microsoft Windows)','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 56880, 72000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (141114, '2026-05-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 60685, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (141503, '2021-11-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167,49]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5','Xbox One']::text[], 3600, 475200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (144465, '2022-06-16T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,34,6,39,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Xbox One','Nintendo Switch']::text[], 20700, 82800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (186725, '2022-02-01T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,3,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Linux','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 100800, 198000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (191411, '2022-07-29T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], 331200, 790200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (191692, '2023-06-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,6,167]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','PC (Microsoft Windows)','PlayStation 5']::text[], 72000, 180000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (205201, '2022-12-13T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Xbox One','Nintendo Switch']::text[], 75600, 136800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (205673, '2017-09-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,49,130]::integer[], ARRAY['PlayStation 4','Xbox One','Nintendo Switch']::text[], 144000, 198000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (217590, '2024-01-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, 90000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (224415, null::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (228525, '2025-09-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167,14,130]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Mac','Nintendo Switch']::text[], 154800, 314400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (228530, '2025-06-26T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6,167]::integer[], ARRAY['PC (Microsoft Windows)','PlayStation 5']::text[], 201600, 404400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (229246, '2020-09-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[130]::integer[], ARRAY['Nintendo Switch']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (233585, '2023-01-25T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 48012, 106200, '2026-09-15T15:44:09.505Z'::timestamptz),
  (238884, '2020-02-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,49]::integer[], ARRAY['PlayStation 4','Xbox One']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (250622, '2024-08-08T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 28800, 36000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (251833, '2024-02-20T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,34,6,39,167,14,49,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Mac','Xbox One','Nintendo Switch']::text[], 165330, 628800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (255078, '2025-07-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (275070, '2024-04-30T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (282566, '2024-08-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (286568, '2018-05-24T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[82]::integer[], ARRAY['Web browser']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (293325, '2024-03-28T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (299596, '2019-05-27T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], 602400, 37539600, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some `time_to_beat_normally_seconds`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into 10 chunks of up to 80 rows each purely so each
-- statement is small enough to run individually; this is chunk 10 of 10.

update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
  (305157, '2026-05-07T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 12960, 14400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (305296, '2025-01-23T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[6]::integer[], ARRAY['PC (Microsoft Windows)']::text[], null::integer, null::integer, '2026-09-15T15:44:09.505Z'::timestamptz),
  (314178, '2025-09-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[48,34,6,39,167,130]::integer[], ARRAY['PlayStation 4','Android','PC (Microsoft Windows)','iOS','PlayStation 5','Nintendo Switch']::text[], 3600, 10800, '2026-09-15T15:44:09.505Z'::timestamptz),
  (317627, '2025-10-02T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[167]::integer[], ARRAY['PlayStation 5']::text[], 171000, 202500, '2026-09-15T15:44:09.505Z'::timestamptz),
  (329130, '2025-10-21T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 62400, 84600, '2026-09-15T15:44:09.505Z'::timestamptz),
  (334239, '2025-10-09T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,48,508,6,167,130]::integer[], ARRAY['Xbox Series X|S','PlayStation 4','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5','Nintendo Switch']::text[], 50400, 86400, '2026-09-15T15:44:09.505Z'::timestamptz),
  (348330, '2026-05-19T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,6,167]::integer[], ARRAY['Xbox Series X|S','PC (Microsoft Windows)','PlayStation 5']::text[], 80400, 198000, '2026-09-15T15:44:09.505Z'::timestamptz),
  (358534, '2026-06-18T00:00:00.000Z'::timestamptz, '2026-09-15T15:44:09.505Z'::timestamptz, ARRAY[169,508,6,167]::integer[], ARRAY['Xbox Series X|S','Nintendo Switch 2','PC (Microsoft Windows)','PlayStation 5']::text[], 108000, 180000, '2026-09-15T15:44:09.505Z'::timestamptz)
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
