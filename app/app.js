/* Combine-to-Field DNA — SPA sans dépendance (routes en hash). */
(() => {
  "use strict";

  const { players: PLAYERS } = window.DNA_DATA;
  const BY_ID = new Map(PLAYERS.map((p) => [p.nfl_id, p]));
  const view = document.getElementById("main");
  const tooltip = document.querySelector(".tooltip");
  const YDS_TO_MPH = 2.0455;

  // ---------- Définitions des métriques ----------
  const METRICS = {
    top_speed: { label: "Vitesse de pointe", unit: "mph", k: YDS_TO_MPH, d: 1, desc: "Vitesse maximale atteinte" },
    burst: { label: "Explosivité (1 s)", unit: "mph", k: YDS_TO_MPH, d: 1, desc: "Vitesse 1 s après le départ / le snap" },
    accel: { label: "Accélération", unit: "yd/s²", k: 1, d: 2, desc: "Accélération de pointe" },
    decel: { label: "Freinage", unit: "yd/s²", k: 1, d: 2, desc: "Décélération de pointe avant un appui" },
    cod: { label: "Vitesse en cut", unit: "mph", k: YDS_TO_MPH, d: 1, desc: "Vitesse conservée lors d'un changement de direction ≥ 45°" },
    agility: { label: "Vivacité", unit: "°/s", k: 1, d: 0, desc: "Vitesse de rotation de pointe en mouvement" },
  };
  const MKEYS = Object.keys(METRICS);

  const PROFILES = {
    gem: { label: "Pépite", desc: "Combine moyen, match au-dessus" },
    safe: { label: "Valeur sûre", desc: "Le match confirme le Combine" },
    bust: { label: "Teste bien, joue moins", desc: "Combine fort, match en dessous" },
    below: { label: "En retrait", desc: "Combine et match sous la médiane" },
  };

  const GROUPS = ["WR", "TE", "OL", "IDL", "EDGE", "CB", "S"];
  const GROUP_LABEL = { WR: "Receveurs", TE: "Tight ends", OL: "Ligne offensive", IDL: "DL intérieur", EDGE: "Edge", CB: "Cornerbacks", S: "Safeties", FLEX: "Autres" };

  // Tri de l'accueil : dir = 1 si plus grand = meilleur
  const SORTS = {
    hidden_score: { label: "Hidden score", dir: 1, fmt: (p) => fmtSigma(p.hidden_score) },
    field_score: { label: "Score match", dir: 1, fmt: (p) => fmtNum(p.field_score, 0) },
    combine_score: { label: "Score Combine", dir: 1, fmt: (p) => fmtNum(p.combine_score, 0) },
    m_top_speed: { label: "Vitesse de pointe (match)", dir: 1, fmt: (p) => fmtMetric("top_speed", p.m_top_speed) },
    m_burst: { label: "Explosivité au snap", dir: 1, fmt: (p) => fmtMetric("burst", p.m_burst) },
    m_cod: { label: "Vitesse en cut (match)", dir: 1, fmt: (p) => fmtMetric("cod", p.m_cod) },
    m_agility: { label: "Vivacité (match)", dir: 1, fmt: (p) => fmtMetric("agility", p.m_agility) },
    forty: { label: "40 yards", dir: -1, fmt: (p) => (p.forty ? `${p.forty.toFixed(2)} s` : "–") },
    draft_overall_pick: { label: "Rang de draft", dir: -1, fmt: (p) => fmtPick(p) },
    career_games_started: { label: "Titularisations NFL", dir: 1, fmt: (p) => fmtNum(p.career_games_started, 0) },
  };

  // ---------- Utilitaires ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const fmtNum = (v, d = 1) => (isNum(v) ? v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const fmtSigma = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${fmtNum(v, 2)} σ` : "–");
  const fmtMetric = (m, v) => (isNum(v) ? `${fmtNum(v * METRICS[m].k, METRICS[m].d)} ${METRICS[m].unit}` : "–");
  const fmtPick = (p) => (p.draft_overall_pick ? `#${p.draft_overall_pick}` : "Non drafté");
  const fmtDraft = (p) => (p.draft_overall_pick ? `${p.draft_year} · R${p.draft_round} · #${p.draft_overall_pick}` : `${p.draft_year} · Non drafté`);
  const fmtHeight = (v) => (isNum(v) ? `${Math.floor(v / 12)}'${fmtNum(v % 12, 1)}"` : "–");
  const ordinal = (v) => (isNum(v) ? `${Math.round(v)}e pct.` : "–");
  const profileBadge = (p) => (p.profile ? `<span class="badge ${p.profile}">${PROFILES[p.profile].label}</span>` : "");
  const playerLink = (p) => `#/player/${p.nfl_id}`;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const searchIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

  function tween(dur, fn) {
    if (reduceMotion) return fn(1);
    const t0 = performance.now();
    const step = (t) => {
      const x = Math.min(1, (t - t0) / dur);
      fn(1 - Math.pow(1 - x, 3)); // easeOutCubic
      if (x < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function showTip(evt, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    tooltip.style.left = `${evt.clientX}px`;
    tooltip.style.top = `${evt.clientY}px`;
  }
  const hideTip = () => (tooltip.hidden = true);

  // Remplit les barres après insertion pour déclencher la transition CSS
  function fillBars(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll(".bar > span[data-w]").forEach((el) => (el.style.width = `${el.dataset.w}%`));
    }));
  }

  // ---------- Composants graphiques ----------
  /** Radar : series = [{ values: [0..100], color, label }] */
  function radar(series, size = 360) {
    const c = size / 2, R = size / 2 - 58, n = MKEYS.length;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [c + Math.cos(a) * r, c + Math.sin(a) * r];
    };
    let rings = "";
    for (const f of [0.25, 0.5, 0.75, 1]) {
      rings += `<polygon class="gridline" fill="none" points="${MKEYS.map((_, i) => pt(i, R * f).join(",")).join(" ")}"/>`;
    }
    const spokes = MKEYS.map((m, i) => {
      const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 26);
      const anchor = Math.abs(lx - c) < 4 ? "middle" : lx > c ? "start" : "end";
      return `<line class="gridline" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>
        <text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" font-size="12" font-weight="600" fill="#0f1b2d">${METRICS[m].label}</text>`;
    }).join("");
    const polys = series.map((s, si) => `<polygon data-series="${si}" fill="${s.color}" fill-opacity=".16" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${MKEYS.map(() => `${c},${c}`).join(" ")}"/>`).join("");
    const svg = `<svg viewBox="-60 0 ${size + 120} ${size}" role="img" aria-label="Radar de l'empreinte biomécanique">${rings}${spokes}${polys}</svg>`;
    const animate = (root) => {
      const els = root.querySelectorAll("polygon[data-series]");
      tween(800, (t) => {
        els.forEach((el) => {
          const vals = series[+el.dataset.series].values;
          el.setAttribute("points", vals.map((v, i) => pt(i, (R * (isNum(v) ? v : 0) * t) / 100).join(",")).join(" "));
        });
      });
    };
    return { svg, animate };
  }

  /** Courbes de vitesse (pas de 0,1 s), en mph */
  function speedChart(lines) {
    const W = 560, H = 260, m = { l: 44, r: 16, t: 14, b: 34 };
    const maxT = Math.max(3, ...lines.map((l) => (l.data.length - 1) / 10));
    const maxV = Math.ceil(Math.max(10, ...lines.flatMap((l) => l.data.map((v) => v * YDS_TO_MPH))) / 5) * 5;
    const x = (t) => m.l + (t / maxT) * (W - m.l - m.r);
    const y = (v) => H - m.b - (v / maxV) * (H - m.t - m.b);
    let axes = "";
    for (let v = 0; v <= maxV; v += 5) axes += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
    for (let t = 0; t <= maxT; t += 1) axes += `<text x="${x(t)}" y="${H - m.b + 18}" text-anchor="middle">${t} s</text>`;
    const paths = lines.filter((l) => l.data.length).map((l) => {
      const d = l.data.map((v, i) => `${i ? "L" : "M"}${x(i / 10).toFixed(1)},${y(v * YDS_TO_MPH).toFixed(1)}`).join("");
      return `<path class="draw" d="${d}" fill="none" stroke="${l.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbes de vitesse"><g class="axis">${axes}<text x="${m.l}" y="${m.t - 2}" font-weight="600">mph</text></g>${paths}</svg>`;
  }
  function animateDraw(root) {
    root.querySelectorAll("path.draw").forEach((p) => p.style.setProperty("--len", p.getTotalLength()));
  }

  // ---------- Recherche de joueur (combobox accessible) ----------
  function mountPicker(host, { placeholder, exclude, onPick }) {
    host.innerHTML = `<div class="picker search">${searchIcon}
      <input class="input" type="search" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="sg" placeholder="${esc(placeholder)}" autocomplete="off">
      <ul class="suggest" id="sg" role="listbox" hidden></ul></div>`;
    const input = host.querySelector("input"), list = host.querySelector("ul");
    let items = [], sel = -1;
    const render = () => {
      const q = norm(input.value.trim());
      items = q ? PLAYERS.filter((p) => p.nfl_id !== exclude && norm(p.display_name).includes(q)).slice(0, 8) : [];
      sel = items.length ? 0 : -1;
      list.hidden = !items.length;
      input.setAttribute("aria-expanded", String(!!items.length));
      list.innerHTML = items.map((p, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span><strong>${esc(p.display_name)}</strong> <span class="muted">${esc(p.nfl_position)} · ${esc(p.college_name)}</span></span><span class="muted">${fmtDraft(p)}</span></li>`).join("");
    };
    const highlight = () => list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (!items.length) return;
      if (e.key === "ArrowDown") { sel = (sel + 1) % items.length; highlight(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = (sel - 1 + items.length) % items.length; highlight(); e.preventDefault(); }
      else if (e.key === "Enter" && sel >= 0) { onPick(items[sel]); }
      else if (e.key === "Escape") { list.hidden = true; }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (li) onPick(items[+li.dataset.i]);
    });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 120));
    return input;
  }

  // ======================================================================
  // Vue : Accueil — Hidden Athlete Finder
  // ======================================================================
  const homeState = { q: "", sort: "hidden_score", group: "ALL", scope: "top" };
  const TOP50 = PLAYERS.filter((p) => p.rank && p.rank <= 50);

  function renderHome() {
    view.innerHTML = `
      <div class="eyebrow">Recruteur</div>
      <h1>Hidden Athlete Finder</h1>
      <p class="lead">Les 50 joueurs dont l'empreinte biomécanique en match dépasse le plus ce que laissaient prévoir leur rang de draft, leur score NGS et leur Combine. Comparaison faite à poste égal.</p>
      <div class="toolbar">
        <div class="search">${searchIcon}<input id="q" class="input" type="search" placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur par nom" value="${esc(homeState.q)}"></div>
        <label class="muted" for="sort">Trier par</label>
        <select id="sort" class="select">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${k === homeState.sort ? "selected" : ""}>${s.label}</option>`).join("")}</select>
        <div class="chips" role="group" aria-label="Périmètre">
          <button class="chip" data-scope="top" aria-pressed="${homeState.scope === "top"}">Top 50</button>
          <button class="chip" data-scope="all" aria-pressed="${homeState.scope === "all"}">Tous les joueurs</button>
        </div>
      </div>
      <div class="toolbar chips" role="group" aria-label="Filtrer par poste">
        ${["ALL", ...GROUPS].map((g) => `<button class="chip" data-group="${g}" aria-pressed="${homeState.group === g}">${g === "ALL" ? "Tous postes" : g}</button>`).join("")}
      </div>
      <div class="list-head" aria-hidden="true">
        <span>#</span><span>Joueur</span><span>Poste</span><span class="hide-sm">Draft</span><span id="metric-head" class="hide-sm"></span><span class="hide-sm">Match</span><span class="hide-sm">Combine</span><span></span>
      </div>
      <div id="list" class="list" aria-live="polite"></div>`;

    const q = view.querySelector("#q");
    q.addEventListener("input", () => { homeState.q = q.value; renderList(); });
    view.querySelector("#sort").addEventListener("change", (e) => { homeState.sort = e.target.value; renderList(); });
    view.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
      homeState.scope = b.dataset.scope;
      view.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderList();
    }));
    view.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
      homeState.group = b.dataset.group;
      view.querySelectorAll("[data-group]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderList();
    }));
    renderList();
  }

  function renderList() {
    const list = view.querySelector("#list");
    const sort = SORTS[homeState.sort];
    const key = homeState.sort;
    const qn = norm(homeState.q.trim());
    view.querySelector("#metric-head").textContent = sort.label;

    const base = homeState.scope === "top" ? TOP50 : PLAYERS;
    let rows = base.filter((p) => (homeState.group === "ALL" || p.group === homeState.group) && (!qn || norm(p.display_name).includes(qn)));
    rows.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (!isNum(va) && !isNum(vb)) return 0;
      if (!isNum(va)) return 1;
      if (!isNum(vb)) return -1;
      return (vb - va) * sort.dir;
    });

    // Barre normalisée sur l'ensemble des joueurs (plus long = meilleur)
    const vals = PLAYERS.map((p) => p[key]).filter(isNum);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pct = (v) => (isNum(v) ? Math.max(4, ((sort.dir > 0 ? v - lo : hi - v) / (hi - lo || 1)) * 100) : 0);

    if (!rows.length) {
      const elsewhere = homeState.scope === "top" && qn && PLAYERS.some((p) => norm(p.display_name).includes(qn));
      list.innerHTML = `<div class="empty card">Aucun joueur ne correspond.${elsewhere ? ` <button class="btn ghost" id="widen">Chercher dans tous les joueurs →</button>` : ""}</div>`;
      list.querySelector("#widen")?.addEventListener("click", () => { homeState.scope = "all"; renderHome(); });
      return;
    }

    list.classList.remove("stagger");
    void list.offsetWidth; // relance l'animation d'entrée
    list.classList.add("stagger");
    list.innerHTML = rows.map((p, i) => `
      <a class="row" href="${playerLink(p)}" style="--i:${Math.min(i, 25)}" aria-label="${esc(p.display_name)}, voir la fiche">
        <span class="rank ${p.rank && p.rank <= 10 ? "top" : ""}">${p.rank ? Math.round(p.rank) : "–"}</span>
        <span><div class="pname">${esc(p.display_name)} ${profileBadge(p)}</div><div class="psub">${esc(p.college_name)}</div></span>
        <span><span class="pos">${esc(p.nfl_position)}</span></span>
        <span class="num hide-sm">${fmtPick(p)}</span>
        <span class="barwrap hide-sm"><span class="bar" style="flex:1"><span data-w="${pct(p[key])}"></span></span><span class="num">${sort.fmt(p)}</span></span>
        <span class="num hide-sm">${fmtNum(p.field_score, 0)}</span>
        <span class="num hide-sm">${fmtNum(p.combine_score, 0)}</span>
        <span class="chev" aria-hidden="true">›</span>
      </a>`).join("");
    fillBars(list);
  }

  // ======================================================================
  // Vue : Fiche joueur
  // ======================================================================
  function renderPlayer(p) {
    const tracked = isNum(p.m_plays);
    view.innerHTML = `
      <a class="btn ghost back" href="#/">‹ Hidden Athlete Finder</a>
      <section class="hero">
        <div>
          <div class="eyebrow">${esc(GROUP_LABEL[p.group] || p.group)}</div>
          <h1>${esc(p.display_name)}</h1>
          <div class="hero-meta"><span class="pos">${esc(p.nfl_position)}</span><span>${esc(p.college_name)}</span><span>Draft ${fmtDraft(p)}</span>${profileBadge(p)}</div>
        </div>
        <div class="actions">
          <a class="btn" href="#/compare/${p.nfl_id}">⇄ Comparer</a>
          <a class="btn primary" href="#/dna/${p.nfl_id}">◎ Empreinte biomécanique</a>
        </div>
      </section>

      <section class="kpis stagger">
        <div class="card kpi" style="--i:0"><div class="label">Hidden score</div><div class="value">${fmtSigma(p.hidden_score)}</div><div class="hint">${p.rank ? `Rang ${Math.round(p.rank)} sur ${PLAYERS.filter((x) => x.rank).length}` : "Pas assez d'actions en match"}</div></div>
        <div class="card kpi" style="--i:1"><div class="label">Score match</div><div class="value">${fmtNum(p.field_score, 0)}<small class="muted">/100</small></div><div class="hint">Percentile au poste</div></div>
        <div class="card kpi" style="--i:2"><div class="label">Score Combine</div><div class="value">${fmtNum(p.combine_score, 0)}<small class="muted">/100</small></div><div class="hint">Percentile au poste</div></div>
        <div class="card kpi" style="--i:3"><div class="label">Titularisations NFL</div><div class="value">${fmtNum(p.career_games_started, 0)}</div><div class="hint">${fmtNum(p.career_games_active, 0)} matchs joués</div></div>
      </section>

      <section class="grid3" style="margin-bottom:18px">
        <div class="card">
          <h2>Empreinte en bref</h2>
          <div class="legend" style="margin-bottom:8px"><span><i style="background:var(--combine)"></i>Combine</span><span><i style="background:var(--match)"></i>Match</span><span>percentile au poste</span></div>
          ${MKEYS.map((m) => `
            <div class="mbar"><span class="name" title="${esc(METRICS[m].desc)}">${METRICS[m].label}</span>
              <span class="barwrap"><span class="bar" style="flex:1"><span class="c" data-w="${p["cp_" + m] ?? 0}"></span></span><span class="num">${fmtNum(p["cp_" + m], 0)}</span></span>
              <span class="barwrap"><span class="bar" style="flex:1"><span data-w="${p["mp_" + m] ?? 0}"></span></span><span class="num">${fmtNum(p["mp_" + m], 0)}</span></span>
            </div>`).join("")}
          ${tracked ? "" : `<p class="note">Aucune action trackée en match pour ce joueur.</p>`}
        </div>
        <div class="card">
          <h2>Bouge comme…</h2>
          ${p.comps.length ? p.comps.map((c) => {
            const o = BY_ID.get(c.id);
            return `<a class="comp" href="${playerLink(o)}"><span><strong>${esc(o.display_name)}</strong><div class="psub">${esc(o.nfl_position)} · ${fmtDraft(o)} · ${fmtNum(o.career_games_started, 0)} titularisations</div></span><span class="sim">${c.sim}% similaire</span></a>`;
          }).join("") : `<p class="muted">Pas de comparable disponible.</p>`}
          <p class="note">Plus proches voisins sur l'empreinte match, au même poste.</p>
        </div>
      </section>

      <section class="grid2">
        <div class="card"><h2>Tests du Combine</h2><table class="stats">
          ${[["Taille", fmtHeight(p.combine_height)], ["Poids", p.combine_weight ? `${p.combine_weight} lb` : "–"], ["40 yards", p.forty ? `${fmtNum(p.forty, 2)} s` : "–"],
             ["Détente verticale", p.vertical ? `${fmtNum(p.vertical, 1)}"` : "–"], ["Saut en longueur", p.broad_jump ? `${p.broad_jump}"` : "–"],
             ["3-cone", p.three_cone ? `${fmtNum(p.three_cone, 2)} s` : "–"], ["Short shuttle", p.short_shuttle ? `${fmtNum(p.short_shuttle, 2)} s` : "–"],
             ["Bench (225 lb)", fmtNum(p.bench_reps, 0)], ["NGS athleticism", fmtNum(p.ngs_athleticism_score, 0)], ["NGS final", fmtNum(p.ngs_final_score, 0)]]
             .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}
        </table></div>
        <div class="card"><h2>Carrière NFL</h2><table class="stats">
          ${[["Matchs joués", fmtNum(p.career_games_active, 0)], ["Titularisations", fmtNum(p.career_games_started, 0)],
             ["Snaps offensifs", fmtNum(p.career_offensive_snaps, 0)], ["Snaps défensifs", fmtNum(p.career_defensive_snaps, 0)],
             ["Pro Bowl", fmtNum(p.pro_bowl_original_ballot, 0)], ["All-Pro (1re / 2e équipe)", `${fmtNum(p.ap_all_pro_1st_team, 0)} / ${fmtNum(p.ap_all_pro_2nd_team, 0)}`],
             ["Actions trackées (données)", fmtNum(p.m_plays, 0)]]
             .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}
        </table></div>
      </section>`;
    fillBars(view);
  }

  // ======================================================================
  // Vue : Empreinte biomécanique
  // ======================================================================
  function renderDNA(p) {
    const gaps = MKEYS.map((m) => ({ m, gap: (p["mp_" + m] ?? NaN) - (p["cp_" + m] ?? NaN) })).filter((g) => isNum(g.gap));
    const best = [...MKEYS].filter((m) => isNum(p["mp_" + m])).sort((a, b) => p["mp_" + b] - p["mp_" + a])[0];
    const up = [...gaps].sort((a, b) => b.gap - a.gap)[0];
    const down = [...gaps].sort((a, b) => a.gap - b.gap)[0];
    const r = radar([
      { values: MKEYS.map((m) => p["cp_" + m]), color: "#6d4ae8" },
      { values: MKEYS.map((m) => p["mp_" + m]), color: "#0e9f86" },
    ]);

    view.innerHTML = `
      <a class="btn ghost back" href="${playerLink(p)}">‹ ${esc(p.display_name)}</a>
      <section class="hero">
        <div><div class="eyebrow">Empreinte biomécanique</div><h1>${esc(p.display_name)}</h1>
          <div class="hero-meta"><span class="pos">${esc(p.nfl_position)}</span><span>Comparé aux ${esc(GROUP_LABEL[p.group] || p.group)}</span>${profileBadge(p)}</div></div>
        <div class="actions"><a class="btn" href="#/compare/${p.nfl_id}">⇄ Comparer</a></div>
      </section>
      <section class="grid2" style="margin-bottom:18px">
        <div class="card chart">
          <h2>Combine vs match</h2>
          <div class="legend"><span><i style="background:var(--combine)"></i>Combine (drills)</span><span><i style="background:var(--match)"></i>Match réel</span></div>
          <div id="radar">${r.svg}</div>
        </div>
        <div class="card">
          <h2>Ce qu'il faut retenir</h2>
          ${best ? `<p><strong>Point fort en match :</strong> ${METRICS[best].label.toLowerCase()} (${ordinal(p["mp_" + best])} de son poste, ${fmtMetric(best, p["m_" + best])}).</p>` : ""}
          ${up && up.gap > 5 ? `<p><strong>Plus fort en match qu'au Combine :</strong> ${METRICS[up.m].label.toLowerCase()}, +${Math.round(up.gap)} points de percentile.</p>` : ""}
          ${down && down.gap < -5 ? `<p><strong>Ne se retrouve pas en match :</strong> ${METRICS[down.m].label.toLowerCase()}, ${Math.round(down.gap)} points de percentile.</p>` : ""}
          <table class="stats" style="margin-top:12px">
            <tr><th></th><td class="muted">Combine</td><td class="muted">Match</td><td class="muted">Écart</td></tr>
            ${MKEYS.map((m) => {
              const g = (p["mp_" + m] ?? NaN) - (p["cp_" + m] ?? NaN);
              const cls = !isNum(g) ? "" : g > 5 ? "plus" : g < -5 ? "minus" : "eq";
              return `<tr><th title="${esc(METRICS[m].desc)}">${METRICS[m].label}</th><td>${fmtMetric(m, p["c_" + m])}</td><td>${fmtMetric(m, p["m_" + m])}</td><td>${isNum(g) ? `<span class="delta ${cls}">${g > 0 ? "+" : ""}${Math.round(g)}</span>` : "–"}</td></tr>`;
            }).join("")}
          </table>
          <p class="note">Écart en points de percentile au poste. Valeurs brutes : tracking à 10 Hz.</p>
        </div>
      </section>
      <section class="card chart">
        <h2>Profil de vitesse au départ</h2>
        <div class="legend"><span><i style="background:var(--combine)"></i>40 yards au Combine (meilleur essai)</span><span><i style="background:var(--match)"></i>Après le snap en match (90e percentile des actions)</span></div>
        <div id="speed">${speedChart([{ data: p.curve_forty, color: "#6d4ae8" }, { data: p.curve_snap, color: "#0e9f86" }])}</div>
        <p class="note">En match, le joueur ne sprinte pas toujours en ligne droite : l'écart entre les deux courbes montre la part de sa vitesse brute qu'il convertit réellement sur le terrain.</p>
      </section>`;
    r.animate(view.querySelector("#radar"));
    animateDraw(view.querySelector("#speed"));
  }

  // ======================================================================
  // Vue : Comparateur
  // ======================================================================
  const CMP_ROWS = [
    { section: "Scores" },
    { label: "Hidden score", get: (p) => p.hidden_score, fmt: fmtSigma, d: 2, unit: "σ", dir: 1 },
    { label: "Score match", get: (p) => p.field_score, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { label: "Score Combine", get: (p) => p.combine_score, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { section: "Empreinte en match" },
    ...MKEYS.map((m) => ({ label: METRICS[m].label, get: (p) => (isNum(p["m_" + m]) ? p["m_" + m] * METRICS[m].k : null), fmt: (v) => fmtNum(v, METRICS[m].d), d: METRICS[m].d, unit: METRICS[m].unit, dir: 1 })),
    { section: "Empreinte au Combine" },
    ...MKEYS.map((m) => ({ label: METRICS[m].label, get: (p) => (isNum(p["c_" + m]) ? p["c_" + m] * METRICS[m].k : null), fmt: (v) => fmtNum(v, METRICS[m].d), d: METRICS[m].d, unit: METRICS[m].unit, dir: 1 })),
    { section: "Tests du Combine" },
    { label: "40 yards", get: (p) => p.forty, fmt: (v) => fmtNum(v, 2), d: 2, unit: "s", dir: -1 },
    { label: "Détente verticale", get: (p) => p.vertical, fmt: (v) => fmtNum(v, 1), d: 1, unit: "in", dir: 1 },
    { label: "Saut en longueur", get: (p) => p.broad_jump, fmt: (v) => fmtNum(v, 0), d: 0, unit: "in", dir: 1 },
    { label: "3-cone", get: (p) => p.three_cone, fmt: (v) => fmtNum(v, 2), d: 2, unit: "s", dir: -1 },
    { label: "Short shuttle", get: (p) => p.short_shuttle, fmt: (v) => fmtNum(v, 2), d: 2, unit: "s", dir: -1 },
    { label: "Bench (225 lb)", get: (p) => p.bench_reps, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { label: "Taille", get: (p) => p.combine_height, fmt: fmtHeight, d: 1, unit: "in", dir: 0 },
    { label: "Poids", get: (p) => p.combine_weight, fmt: (v) => fmtNum(v, 0), d: 0, unit: "lb", dir: 0 },
    { section: "Carrière NFL" },
    { label: "Titularisations", get: (p) => p.career_games_started, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { label: "Matchs joués", get: (p) => p.career_games_active, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { label: "Pro Bowl", get: (p) => p.pro_bowl_original_ballot, fmt: (v) => fmtNum(v, 0), d: 0, unit: "", dir: 1 },
    { label: "Rang de draft", get: (p) => p.draft_overall_pick ?? 262, fmt: (v) => (v >= 262 ? "Non drafté" : `#${v}`), d: 0, unit: "", dir: -1 },
  ];

  function slotHTML(p, side) {
    return `<div><div class="pname" style="font-size:20px">${esc(p.display_name)}</div>
      <div class="psub">${esc(p.nfl_position)} · ${esc(p.college_name)} · ${fmtDraft(p)}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">${profileBadge(p)}
      <a class="btn ghost" href="${playerLink(p)}">Fiche</a>${side === "b" ? `<button class="btn ghost" id="change">Changer</button>` : ""}</div></div>`;
  }

  function deltaCell(row, mine, other) {
    if (!isNum(mine) || !isNum(other)) return `<span class="delta eq">n/d</span>`;
    const diff = mine - other;
    if (Math.abs(diff) < Math.pow(10, -row.d) / 2) return `<span class="delta eq">=</span>`;
    const txt = `${fmtNum(Math.abs(diff), row.d)}${row.unit && row.unit !== "σ" ? " " + row.unit : ""}`;
    if (row.dir === 0) return `<span class="delta eq">${diff > 0 ? "+" : "−"}${txt}</span>`;
    const better = diff * row.dir > 0;
    return `<span class="delta ${better ? "plus" : "minus"}">${better ? "+" : "−"}${txt}</span>`;
  }

  function renderCompare(a, b) {
    view.innerHTML = `
      <a class="btn ghost back" href="${playerLink(a)}">‹ ${esc(a.display_name)}</a>
      <div class="eyebrow">Comparateur</div><h1>Face à face</h1>
      <p class="lead">Chaque ligne indique l'avantage de chaque joueur : <span class="delta plus">+</span> mieux, <span class="delta minus">−</span> moins bien. La taille et le poids restent neutres.</p>
      <section class="vs">
        <div class="card slot">${slotHTML(a, "a")}</div>
        <div class="vs-badge" aria-hidden="true">VS</div>
        <div class="card slot" id="slot-b">${b ? slotHTML(b, "b") : ""}</div>
      </section>
      <div id="cmp-body"></div>`;

    const slotB = view.querySelector("#slot-b");
    const openPicker = () => {
      slotB.innerHTML = `<div class="muted" style="margin-bottom:8px">Choisir un joueur à comparer</div><div id="pk"></div>`;
      mountPicker(slotB.querySelector("#pk"), {
        placeholder: "Rechercher un joueur…",
        exclude: a.nfl_id,
        onPick: (o) => (location.hash = `#/compare/${a.nfl_id}/${o.nfl_id}`),
      }).focus();
    };
    if (!b) {
      openPicker();
      // Suggestions : ses comparables
      view.querySelector("#cmp-body").innerHTML = a.comps.length ? `<div class="card"><h2>Suggestions : ils bougent comme ${esc(a.display_name)}</h2>${a.comps.map((c) => {
        const o = BY_ID.get(c.id);
        return `<a class="comp" href="#/compare/${a.nfl_id}/${o.nfl_id}"><span><strong>${esc(o.display_name)}</strong><div class="psub">${esc(o.nfl_position)} · ${fmtDraft(o)}</div></span><span class="sim">${c.sim}% similaire ›</span></a>`;
      }).join("")}</div>` : "";
      return;
    }
    view.querySelector("#change").addEventListener("click", openPicker);

    let winsA = 0, winsB = 0;
    const body = CMP_ROWS.map((row) => {
      if (row.section) return `<tr class="section"><td colspan="3">${row.section}</td></tr>`;
      const va = row.get(a), vb = row.get(b);
      if (row.dir && isNum(va) && isNum(vb) && va !== vb) (va - vb) * row.dir > 0 ? winsA++ : winsB++;
      return `<tr><td class="l"><span class="val">${isNum(va) ? row.fmt(va) : "–"}</span>${deltaCell(row, va, vb)}</td>
        <td class="mid">${row.label}${row.unit && row.unit !== "σ" ? ` <span class="muted">(${row.unit})</span>` : ""}</td>
        <td class="r">${deltaCell(row, vb, va)}<span class="val">${isNum(vb) ? row.fmt(vb) : "–"}</span></td></tr>`;
    }).join("");

    const r = radar([
      { values: MKEYS.map((m) => a["mp_" + m]), color: "#1f4fd8" },
      { values: MKEYS.map((m) => b["mp_" + m]), color: "#e8590c" },
    ], 340);
    const cmpBody = view.querySelector("#cmp-body");
    cmpBody.innerHTML = `
      <section class="grid3">
        <div class="card"><table class="cmp">
          <thead><tr><th class="l">${esc(a.display_name)}</th><th></th><th class="r">${esc(b.display_name)}</th></tr></thead>
          <tbody>${body}</tbody></table></div>
        <div>
          <div class="card" style="margin-bottom:18px">
            <h2>Bilan</h2>
            <div class="score-line"><strong class="${winsA > winsB ? "win" : ""}">${winsA}</strong><span class="muted">catégories pour ${esc(a.display_name)}</span></div>
            <div class="score-line"><strong class="${winsB > winsA ? "win" : ""}">${winsB}</strong><span class="muted">catégories pour ${esc(b.display_name)}</span></div>
            ${a.group !== b.group ? `<p class="note">Postes différents (${a.group} / ${b.group}) : les percentiles sont calculés chacun dans son poste.</p>` : ""}
          </div>
          <div class="card chart"><h2>Empreintes en match</h2>
            <div class="legend"><span><i style="background:#1f4fd8"></i>${esc(a.display_name)}</span><span><i style="background:#e8590c"></i>${esc(b.display_name)}</span></div>
            <div id="radar">${r.svg}</div><p class="note">Percentiles au poste.</p></div>
        </div>
      </section>`;
    r.animate(cmpBody.querySelector("#radar"));
  }

  // ======================================================================
  // Vue : Combine vs Match (nuage des 4 profils)
  // ======================================================================
  const cvmState = { group: "ALL", metric: "score", profile: null };

  function renderCvM() {
    view.innerHTML = `
      <div class="eyebrow">Combine vs Match</div>
      <h1>Le Combine dit-il la vérité ?</h1>
      <p class="lead">Chaque point est un joueur : en abscisse son percentile au Combine, en ordonnée son percentile en match, à poste égal. Les points au-dessus de la diagonale jouent mieux qu'ils ne testent.</p>
      <div class="toolbar">
        <label class="muted" for="metric">Métrique</label>
        <select id="metric" class="select">
          <option value="score">Score global</option>
          ${MKEYS.map((m) => `<option value="${m}" ${cvmState.metric === m ? "selected" : ""}>${METRICS[m].label}</option>`).join("")}
        </select>
        <div class="chips" role="group" aria-label="Filtrer par poste">
          ${["ALL", ...GROUPS].map((g) => `<button class="chip" data-group="${g}" aria-pressed="${cvmState.group === g}">${g === "ALL" ? "Tous postes" : g}</button>`).join("")}
        </div>
      </div>
      <section class="card chart">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 style="margin:0">Percentile Combine → percentile match</h2><span class="muted" id="corr"></span>
        </div>
        <div id="scatter"></div>
      </section>
      <section class="quad-cards" id="quads"></section>`;

    view.querySelector("#metric").value = cvmState.metric;
    view.querySelector("#metric").addEventListener("change", (e) => { cvmState.metric = e.target.value; updateScatter(); });
    view.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
      cvmState.group = b.dataset.group;
      view.querySelectorAll("[data-group]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      updateScatter();
    }));
    buildScatter();
    updateScatter();
  }

  const SC = { W: 760, H: 520, m: { l: 56, r: 20, t: 20, b: 46 } };
  const sx = (v) => SC.m.l + (v / 100) * (SC.W - SC.m.l - SC.m.r);
  const sy = (v) => SC.H - SC.m.b - (v / 100) * (SC.H - SC.m.t - SC.m.b);
  const COLORS = { gem: "#12854a", safe: "#1f4fd8", bust: "#c53030", below: "#8a96a8" };

  function buildScatter() {
    let g = "";
    for (let v = 0; v <= 100; v += 25) {
      g += `<line class="gridline" x1="${sx(0)}" x2="${sx(100)}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${sx(0) - 10}" y="${sy(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
      g += `<line class="gridline" y1="${sy(0)}" y2="${sy(100)}" x1="${sx(v)}" x2="${sx(v)}"/><text x="${sx(v)}" y="${sy(0) + 18}" text-anchor="middle">${v}</text>`;
    }
    const mid = `<line x1="${sx(50)}" x2="${sx(50)}" y1="${sy(0)}" y2="${sy(100)}" stroke="#9aa7ba" stroke-dasharray="4 4"/><line y1="${sy(50)}" y2="${sy(50)}" x1="${sx(0)}" x2="${sx(100)}" stroke="#9aa7ba" stroke-dasharray="4 4"/>
      <line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(100)}" y2="${sy(100)}" stroke="#c9d2df"/>`;
    const labels = `<text class="quad-label" x="${sx(2)}" y="${sy(97)}" fill="${COLORS.gem}">Pépites</text>
      <text class="quad-label" x="${sx(98)}" y="${sy(97)}" text-anchor="end" fill="${COLORS.safe}">Valeurs sûres</text>
      <text class="quad-label" x="${sx(98)}" y="${sy(3)}" text-anchor="end" fill="${COLORS.bust}">Teste bien, joue moins</text>
      <text class="quad-label" x="${sx(2)}" y="${sy(3)}" fill="${COLORS.below}">En retrait</text>`;
    const axisT = `<text x="${sx(50)}" y="${SC.H - 6}" text-anchor="middle" font-weight="600">Percentile Combine</text>
      <text transform="translate(14 ${sy(50)}) rotate(-90)" text-anchor="middle" font-weight="600">Percentile match</text>`;
    const dots = PLAYERS.map((p) => `<circle class="dot" data-id="${p.nfl_id}" r="5.5" cx="0" cy="0" style="transform:translate(${sx(50)}px,${sy(50)}px);transition:transform .7s var(--ease),opacity .3s" tabindex="-1"/>`).join("");
    const host = view.querySelector("#scatter");
    host.innerHTML = `<svg viewBox="0 0 ${SC.W} ${SC.H}" role="img" aria-label="Nuage de points Combine contre match"><g class="axis">${g}${axisT}</g>${mid}${labels}<g id="dots">${dots}</g></svg>`;

    host.addEventListener("mousemove", (e) => {
      const el = e.target.closest(".dot");
      if (!el) return hideTip();
      const p = BY_ID.get(+el.dataset.id), [cx, cy] = coords(p);
      showTip(e, `<strong>${esc(p.display_name)}</strong> <span class="muted">${esc(p.nfl_position)} · ${fmtPick(p)}</span><br>Combine ${fmtNum(cx, 0)} · Match ${fmtNum(cy, 0)}`);
    });
    host.addEventListener("mouseleave", hideTip);
    host.addEventListener("click", (e) => {
      const el = e.target.closest(".dot");
      if (el) { hideTip(); location.hash = `#/player/${el.dataset.id}`; }
    });
  }

  const coords = (p) => (cvmState.metric === "score" ? [p.combine_score, p.field_score] : [p["cp_" + cvmState.metric], p["mp_" + cvmState.metric]]);
  const quadOf = (x, y) => (y >= 50 ? (x >= 50 ? "safe" : "gem") : x >= 50 ? "bust" : "below");

  function updateScatter() {
    const visible = [], counts = { gem: 0, safe: 0, bust: 0, below: 0 };
    view.querySelectorAll("#dots .dot").forEach((el) => {
      const p = BY_ID.get(+el.dataset.id), [x, y] = coords(p);
      const ok = isNum(x) && isNum(y) && (cvmState.group === "ALL" || p.group === cvmState.group);
      if (ok) {
        const q = quadOf(x, y);
        counts[q]++;
        visible.push([x, y]);
        el.style.transform = `translate(${sx(x)}px,${sy(y)}px)`;
        el.setAttribute("fill", COLORS[q]);
        el.classList.toggle("dim", !!cvmState.profile && cvmState.profile !== q);
        el.style.display = "";
      } else {
        el.style.display = "none";
      }
    });
    // Corrélation de Pearson sur les points visibles
    const n = visible.length;
    const mx = visible.reduce((s, v) => s + v[0], 0) / n, my = visible.reduce((s, v) => s + v[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of visible) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    const rr = sxy / Math.sqrt(sxx * syy);
    view.querySelector("#corr").textContent = n > 2 ? `${n} joueurs · corrélation r = ${fmtNum(rr, 2)}` : "";

    const quads = view.querySelector("#quads");
    quads.innerHTML = ["gem", "safe", "bust", "below"].map((q) => `
      <button class="card quad-card" data-q="${q}" aria-pressed="${cvmState.profile === q}" style="color:${COLORS[q]}">
        <div class="n">${counts[q]}</div><strong>${PROFILES[q].label}</strong><p>${PROFILES[q].desc}</p></button>`).join("");
    quads.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
      cvmState.profile = cvmState.profile === b.dataset.q ? null : b.dataset.q;
      updateScatter();
    }));
  }

  // ======================================================================
  // Routeur avec transitions
  // ======================================================================
  function setTab(name) {
    const tabs = document.querySelectorAll(".tab");
    let active = null;
    tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("active", on); if (on) active = t; t.toggleAttribute("aria-current", on); });
    const ind = document.querySelector(".tab-indicator");
    if (active) { ind.style.left = `${active.offsetLeft + 10}px`; ind.style.width = `${active.offsetWidth - 20}px`; }
  }

  function resolve() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const get = (id) => BY_ID.get(Number(id));
    switch (parts[0]) {
      case "combine-vs-match": return { tab: "cvm", render: renderCvM };
      case "player": { const p = get(parts[1]); if (p) return { tab: "home", render: () => renderPlayer(p) }; break; }
      case "dna": { const p = get(parts[1]); if (p) return { tab: "home", render: () => renderDNA(p) }; break; }
      case "compare": { const a = get(parts[1]); if (a) return { tab: "home", render: () => renderCompare(a, get(parts[2]) || null) }; break; }
    }
    return { tab: "home", render: renderHome };
  }

  let first = true;
  function route() {
    const r = resolve();
    setTab(r.tab);
    hideTip();
    const swap = () => {
      r.render();
      view.classList.remove("leave");
      view.classList.remove("enter");
      void view.offsetWidth;
      view.classList.add("enter");
      window.scrollTo({ top: 0, behavior: first || reduceMotion ? "auto" : "smooth" });
      if (!first) view.focus({ preventScroll: true });
      first = false;
    };
    if (first || reduceMotion) return swap();
    view.classList.remove("enter");
    view.classList.add("leave");
    setTimeout(swap, 170);
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => setTab(document.querySelector(".tab.active")?.dataset.tab));
  route();
})();
