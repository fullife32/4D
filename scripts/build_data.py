"""Construit les empreintes biomécaniques Combine & match et exporte app/data.js.

Métriques (mêmes définitions des deux côtés, unités yards/s) :
  top_speed : vitesse de pointe
  burst     : vitesse 1,0 s après le départ (40 yards) / après le snap (match)
  accel     : accélération de pointe (quantile haut de `a`)
  decel     : décélération de pointe, dérivée de s sur 0,3 s
  cod       : vitesse conservée pendant un changement de direction (>= 45° en 0,3 s)
  agility   : vitesse angulaire de pointe (°/s) en mouvement
"""
import json
import math
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "nfl-big-data-bowl-2027"
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / "app" / "data.js"

METRICS = ["top_speed", "burst", "accel", "decel", "cod", "agility"]
MIN_PLAYS = 150  # nb minimum d'actions trackées pour être classé
Z_CAP = 2.5      # plafond des z-scores par métrique
K_PLAYS = 300    # lissage match : à 300 actions, le score garde 50 % de son écart à la moyenne
K_METRICS = 1    # lissage Combine : 6 métriques -> 86 %, 2 métriques -> 67 %
HIDDEN_CAP = 2.5 # plafond doux du hidden score (en σ)
COMBINE_WEIGHT = 0.5  # part de l'effet Combine conservée dans le score attendu

con = duckdb.connect()
con.execute("SET preserve_insertion_order=false")


def csv(name):
    return f"read_csv_auto('{D / name}.csv', nullstr='NA')"


# --- 1. Cache parquet du tracking match (lecture CSV de 2 Go une seule fois) ---
gt_parquet = CACHE / "game_tracking.parquet"
if not gt_parquet.exists():
    files = [str(D / f"game_tracking_{y}.csv") for y in (2023, 2024, 2025)]
    print("Conversion tracking match -> parquet…")
    con.execute(f"""COPY (SELECT game_id, play_id, nfl_id, time::TIMESTAMP AS time,
                         s, a, dir, event
                  FROM read_csv_auto({files}, nullstr='NA', union_by_name=true))
                  TO '{gt_parquet}' (FORMAT parquet)""")

# Expressions communes : variation d'angle sur 3 frames et décélération
TURN = "abs(((dir - lag(dir,3) OVER w) + 540) % 360 - 180)"
DECEL = "-(s - lag(s,3) OVER w) / 0.3"

# --- 2. Empreinte Combine ---
print("Empreinte Combine…")
con.execute(f"""CREATE TABLE ct AS
  SELECT nfl_id, drill_type, drill_name, attempt, time::TIMESTAMP AS time, s, a, dir
  FROM {csv('combine_tracking')} WHERE entity_type='PLAYER'""")

combine = con.sql(f"""
WITH f AS (  -- 40 yards : frames numérotées depuis le départ (s >= 0.5)
  SELECT *, row_number() OVER (PARTITION BY nfl_id, attempt ORDER BY time) - 1 AS k
  FROM ct WHERE drill_type='FORTY_YARD_DASH' AND s >= 0.5
),
forty AS (
  SELECT nfl_id,
    max(least(s, 12)) top_speed,
    max(CASE WHEN k=10 THEN s END) burst,
    quantile_cont(least(a, 15), 0.95) accel
  FROM f GROUP BY 1
),
ag AS (  -- drills d'agilité / position
  SELECT nfl_id, s, {TURN} turn, {DECEL} decel, lag(s,3) OVER w s_prev
  FROM ct WHERE drill_type <> 'FORTY_YARD_DASH'
  WINDOW w AS (PARTITION BY nfl_id, drill_name, attempt ORDER BY time)
),
agg AS (
  SELECT nfl_id,
    quantile_cont(least(decel, 15), 0.98) FILTER (WHERE decel IS NOT NULL) decel,
    quantile_cont(s, 0.9) FILTER (WHERE turn >= 45 AND s_prev > 1) cod,
    quantile_cont(turn / 0.3, 0.95) FILTER (WHERE s > 1.5) agility
  FROM ag GROUP BY 1
)
SELECT * FROM forty FULL JOIN agg USING (nfl_id)
""").df()

curve_forty = con.sql("""
WITH f AS (
  SELECT nfl_id, attempt, s,
    row_number() OVER (PARTITION BY nfl_id, attempt ORDER BY time) - 1 AS k
  FROM ct WHERE drill_type='FORTY_YARD_DASH' AND s >= 0.5
),
best AS (SELECT nfl_id, arg_max(attempt, s) attempt FROM f GROUP BY 1)
SELECT f.nfl_id, f.k, f.s FROM f JOIN best USING (nfl_id, attempt) WHERE k <= 40 ORDER BY 1, 2
""").df()

# --- 3. Empreinte match ---
print("Empreinte match… (quelques minutes)")
con.execute(f"CREATE VIEW gt AS SELECT * FROM '{gt_parquet}'")
match = con.sql(f"""
WITH g AS (
  SELECT nfl_id, s, a, event, {TURN} turn, {DECEL} decel, lag(s,3) OVER w s_prev
  FROM gt WINDOW w AS (PARTITION BY game_id, play_id, nfl_id ORDER BY time)
)
SELECT nfl_id,
  quantile_cont(least(s, 12.5), 0.995) top_speed,
  quantile_cont(least(a, 15), 0.99) accel,
  quantile_cont(least(decel, 15), 0.99) FILTER (WHERE decel IS NOT NULL) decel,
  quantile_cont(s, 0.9) FILTER (WHERE turn >= 45 AND s_prev > 1) cod,
  quantile_cont(turn / 0.3, 0.95) FILTER (WHERE s > 1.5) agility
FROM g GROUP BY 1
""").df()

# Courbe vitesse après le snap (k = 0..30 frames), p90 par frame, + burst à 1 s
snap_curve = con.sql("""
WITH snap AS (
  SELECT game_id, play_id, nfl_id, min(time) t0 FROM gt WHERE event='ball_snap' GROUP BY ALL
),
w AS (
  SELECT g.nfl_id, g.game_id, g.play_id,
    CAST(round(epoch(g.time - snap.t0) * 10) AS INT) k, g.s
  FROM gt g JOIN snap USING (game_id, play_id, nfl_id)
  WHERE g.time >= snap.t0 AND g.time <= snap.t0 + INTERVAL 3 SECOND
)
SELECT nfl_id, k, quantile_cont(s, 0.9) s, count(DISTINCT (game_id, play_id)) plays
FROM w GROUP BY 1, 2 ORDER BY 1, 2
""").df()
burst = snap_curve[snap_curve.k == 10].set_index("nfl_id")
match = match.set_index("nfl_id")
match["burst"] = burst["s"]
match["plays"] = snap_curve.groupby("nfl_id")["plays"].max()
match = match.reset_index()

# --- 4. Tables de référence ---
players = con.sql(f"SELECT * FROM {csv('players')}").df()
results = con.sql(f"SELECT * FROM {csv('combine_results')}").df()
career = con.sql(f"SELECT * FROM {csv('player_career_successes')}").df()

df = (players.merge(results.drop(columns=["draft_year"]), on="nfl_id", how="left")
      .merge(career, on="nfl_id", how="left")
      .merge(combine.add_prefix("c_").rename(columns={"c_nfl_id": "nfl_id"}), on="nfl_id", how="left")
      .merge(match.add_prefix("m_").rename(columns={"m_nfl_id": "nfl_id"}), on="nfl_id", how="left"))
# Groupes de comparaison par rôle réel (un edge ne se compare pas à un DT)
GROUPS = {"WR": "WR", "TE": "TE", "T": "OL", "G": "OL", "C": "OL", "DT": "IDL", "NT": "IDL",
          "DE": "EDGE", "OLB": "EDGE", "ILB": "LB", "MLB": "LB", "CB": "CB", "DB": "CB",
          "SS": "S", "FS": "S", "RB": "RB", "FB": "RB"}
df["group"] = df["nfl_position"].map(GROUPS).fillna("OTHER")
df.loc[df["group"].isin(["LB", "RB", "OTHER"]), "group"] = "FLEX"  # trop peu de joueurs

# --- 5. Scores : z-scores par groupe de poste ---
def zscore(col):
    g = df.groupby("group")[col]
    return (df[col] - g.transform("mean")) / g.transform("std")


for side in ("c", "m"):
    for m in METRICS:
        # z-score plafonné à ±Z_CAP : une seule métrique aberrante ne fait pas la note
        df[f"{side}z_{m}"] = zscore(f"{side}_{m}").clip(-Z_CAP, Z_CAP)
        # percentile intra-poste (0–100) pour le radar
        df[f"{side}p_{m}"] = df.groupby("group")[f"{side}_{m}"].rank(pct=True) * 100
    df[f"{side}_score_unshrunk"] = df[[f"{side}z_{m}" for m in METRICS]].mean(axis=1)

# Lissage (shrinkage) : moins on a de données, plus le score est ramené vers la moyenne du poste
#  - match : fiabilité = actions / (actions + K_PLAYS)
#  - Combine : fiabilité = nb de métriques mesurées / (nb + K_METRICS)
df["m_reliability"] = df["m_plays"] / (df["m_plays"] + K_PLAYS)
df["c_reliability"] = df[[f"cz_{m}" for m in METRICS]].notna().sum(axis=1)
df["c_reliability"] = df["c_reliability"] / (df["c_reliability"] + K_METRICS)
df["m_score_raw"] = df["m_score_unshrunk"] * df["m_reliability"]
df["c_score_raw"] = df["c_score_unshrunk"] * df["c_reliability"]

df["combine_score"] = df.groupby("group")["c_score_raw"].rank(pct=True) * 100
df["field_score"] = df.groupby("group")["m_score_raw"].rank(pct=True) * 100

# Hidden score : résidu du field score vs ce que prédisent draft + NGS + Combine
df["pick"] = df["draft_overall_pick"].fillna(262)
df["undrafted"] = df["draft_overall_pick"].isna().astype(float)
df["ngs_filled"] = df["ngs_final_score"].fillna(df.groupby("group")["ngs_final_score"].transform("mean"))
df["ngs_filled"] = df["ngs_filled"].fillna(df["ngs_final_score"].mean())
fit = df[df["m_score_raw"].notna() & df["c_score_raw"].notna() & (df["m_plays"] >= MIN_PLAYS)].copy()
X = np.column_stack([np.ones(len(fit)), np.log(fit["pick"]), fit["undrafted"],
                     fit["ngs_filled"], fit["c_score_raw"]])
beta, *_ = np.linalg.lstsq(X, fit["m_score_raw"].to_numpy(), rcond=None)
print("Coefficients :", dict(zip(["const", "log_pick", "undrafted", "ngs", "combine"], beta.round(3))))
# Un mauvais Combine ne doit pas "offrir" des points : on ne retient qu'une partie
# de son effet dans l'attendu (COMBINE_WEIGHT), le reste du modèle est inchangé.
beta_exp = beta.copy()
beta_exp[4] *= COMBINE_WEIGHT
resid = fit["m_score_raw"].to_numpy() - X @ beta_exp
resid -= resid.mean()
fit["resid"] = resid
fit["hidden_z"] = fit["resid"] / fit.groupby("group")["resid"].transform("std")
# Compression douce des extrêmes : ~linéaire autour de 0, plafonne vers ±HIDDEN_CAP
fit["hidden_score"] = HIDDEN_CAP * np.tanh(fit["hidden_z"] / HIDDEN_CAP)
df = df.merge(fit[["nfl_id", "hidden_score"]], on="nfl_id", how="left")
print(f"Modèle attendu : R² = {1 - resid.var() / fit['m_score_raw'].var():.2f} sur {len(fit)} joueurs")


def profile(r):
    if pd.isna(r.combine_score) or pd.isna(r.field_score):
        return None
    if r.field_score >= 50:
        return "safe" if r.combine_score >= 50 else "gem"
    return "bust" if r.combine_score >= 50 else "below"


df["profile"] = df.apply(profile, axis=1)
df["rank"] = df["hidden_score"].rank(ascending=False, method="first")

# Comparables : 3 plus proches voisins (même groupe) sur l'empreinte match
mz = [f"mz_{m}" for m in METRICS]
comps = {}
for _, grp in df[df[mz].notna().all(axis=1)].groupby("group"):
    M = grp[mz].to_numpy()
    ids = grp["nfl_id"].to_numpy()
    dist = np.sqrt(((M[:, None, :] - M[None, :, :]) ** 2).sum(-1))
    for i, pid in enumerate(ids):
        order = [j for j in np.argsort(dist[i]) if j != i][:3]
        comps[int(pid)] = [{"id": int(ids[j]), "sim": round(float(100 / (1 + dist[i, j])), 0)} for j in order]


# --- 6. Export ---
def clean(v):
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) else round(float(v), 3)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


keep = ["nfl_id", "display_name", "draft_year", "nfl_position", "group", "college_name",
        "draft_round", "draft_overall_pick", "combine_height", "combine_weight", "forty",
        "vertical", "broad_jump", "three_cone", "short_shuttle", "bench_reps",
        "ngs_athleticism_score", "ngs_final_score", "career_games_active", "career_games_started",
        "career_offensive_snaps", "career_defensive_snaps", "pro_bowl_original_ballot",
        "ap_all_pro_1st_team", "ap_all_pro_2nd_team", "m_plays", "combine_score", "field_score",
        "hidden_score", "profile", "rank"]
keep += [f"{s}_{m}" for s in ("c", "m") for m in METRICS]
keep += [f"{s}p_{m}" for s in ("c", "m") for m in METRICS]

fc = curve_forty.groupby("nfl_id")["s"].apply(lambda x: [round(v, 2) for v in x]).to_dict()
sc = snap_curve.groupby("nfl_id")["s"].apply(lambda x: [round(v, 2) for v in x]).to_dict()

out = []
for r in df[keep].to_dict("records"):
    rec = {k: clean(v) for k, v in r.items()}
    pid = rec["nfl_id"]
    rec["curve_forty"] = fc.get(pid, [])
    rec["curve_snap"] = sc.get(pid, [])
    rec["comps"] = comps.get(pid, [])
    out.append(rec)

OUT.parent.mkdir(exist_ok=True)
OUT.write_text("window.DNA_DATA = " + json.dumps({"metrics": METRICS, "players": out},
                                                  ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"{len(out)} joueurs exportés -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} Mo)")
print(df.sort_values("rank").head(10)[["display_name", "group", "draft_overall_pick", "hidden_score",
                                       "field_score", "combine_score", "m_plays"]].to_string())
