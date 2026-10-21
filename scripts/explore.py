"""Exploration rapide : faisabilité du pont Combine -> match -> carrière."""
import duckdb

D = "data/nfl-big-data-bowl-2027"
con = duckdb.connect()
for t in ["combine_results", "combine_tracking", "players", "player_career_successes", "games"]:
    con.execute(f"CREATE VIEW {t} AS SELECT * FROM read_csv_auto('{D}/{t}.csv', nullstr='NA')")
con.execute(f"""CREATE VIEW game_tracking AS SELECT * FROM read_csv_auto(
    ['{D}/game_tracking_2023.csv','{D}/game_tracking_2024.csv','{D}/game_tracking_2025.csv'],
    nullstr='NA', union_by_name=true)""")


def q(title, sql):
    print(f"\n== {title}")
    print(con.sql(sql).df().to_string())


q("Tailles", """
SELECT 'players' t, count(*) n FROM players UNION ALL
SELECT 'combine_results', count(*) FROM combine_results UNION ALL
SELECT 'combine_tracking joueurs', count(DISTINCT nfl_id) FROM combine_tracking UNION ALL
SELECT 'career', count(*) FROM player_career_successes UNION ALL
SELECT 'game_tracking joueurs', count(DISTINCT nfl_id) FROM game_tracking""")

q("Recouvrement par draft_year", """
WITH ct AS (SELECT DISTINCT nfl_id FROM combine_tracking),
     gt AS (SELECT DISTINCT nfl_id FROM game_tracking)
SELECT p.draft_year, count(*) players,
  count(cr.nfl_id) combine_res, count(ct.nfl_id) combine_trk, count(gt.nfl_id) game_trk,
  count(CASE WHEN ct.nfl_id IS NOT NULL AND gt.nfl_id IS NOT NULL THEN 1 END) trk_both,
  count(pc.nfl_id) career
FROM players p
LEFT JOIN combine_results cr USING (nfl_id)
LEFT JOIN ct USING (nfl_id) LEFT JOIN gt USING (nfl_id)
LEFT JOIN player_career_successes pc USING (nfl_id)
GROUP BY 1 ORDER BY 1""")

q("Drills Combine", """
SELECT drill_type, drill_name, count(DISTINCT nfl_id) joueurs, count(*) frames
FROM combine_tracking GROUP BY ALL ORDER BY drill_type, joueurs DESC""")

q("Positions", "SELECT nfl_position, count(*) n FROM players GROUP BY 1 ORDER BY 2 DESC")

q("Cibles carrière (distribution)", """
SELECT count(*) n, count_if(pro_bowl_original_ballot>0) pro_bowlers,
  count_if(ap_all_pro_1st_team+ap_all_pro_2nd_team>0) all_pros,
  median(career_games_started) med_starts, max(career_games_started) max_starts
FROM player_career_successes""")

q("Events match", "SELECT event, count(*) n FROM game_tracking WHERE event IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25")

q("Vitesse max match vs 40y (sanity)", """
WITH g AS (SELECT nfl_id, quantile_cont(s, 0.995) vmax FROM game_tracking GROUP BY 1)
SELECT corr(g.vmax, cr.forty) corr_vmax_40, count(*) n
FROM g JOIN combine_results cr USING (nfl_id) WHERE cr.forty IS NOT NULL""")
