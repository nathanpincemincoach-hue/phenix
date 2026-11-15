/* Phénix — Mon suivi. Appli de saisie quotidienne des clientes de la méthode Phénix. */
(() => {
  "use strict";

  const API = String(window.PHENIX_API || "").trim();
  const DEMO = !API;
  const ETAPES = ["Observation", "Calibrage", "Maintenance", "Cycle A", "Cycle B", "Pause"];
  const MATIN = ["poids", "sommeil", "forme", "cc"];
  const NUM_FIELDS = {
    poids: [30, 250], palier: [800, 5000], taille: [40, 200],
    pas: [0, 60000], kcal: [500, 6000], prot: [0, 400]
  };
  const REP_FIELDS = { depart: [30, 250], maintKcal: [800, 5000], maintPas: [0, 60000], cibleProt: [0, 400] };
  const JOURS_ARRIERE = 13; // on peut rattraper jusqu'à 2 semaines

  /* ---------- petits outils ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* stockage indisponible */ } }
  };
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
  const today = () => ymd(new Date());
  const isSunday = (s) => parse(s).getDay() === 0;
  const fr = (n, dec = 1) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: dec });
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const longDate = (s) => parse(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const shortDate = (s) => parse(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const toNum = (raw) => {
    if (raw === "" || raw === null || raw === undefined) return "";
    const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  /* ---------- identité de la cliente ---------- */
  const params = new URLSearchParams(location.search);
  let code = (params.get("c") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) code = store.get("phenix:last-code") || "";
  if (!code && DEMO) code = "DEMO";
  if (code) store.set("phenix:last-code", code);

  const KEY_DATA = () => `phenix:data:${code}`;
  const KEY_QUEUE = () => `phenix:queue:${code}`;

  /* ---------- état ---------- */
  const cached = code ? store.get(KEY_DATA()) : null;
  const S = {
    cliente: (cached && cached.cliente) || {},
    entries: (cached && cached.entries) || {},
    queue: (code && store.get(KEY_QUEUE())) || [],
    tab: "jour",
    day: today(),
    drafts: {},
    touched: {},
    online: navigator.onLine,
    syncing: false,
    loaded: !!cached,
    error: ""
  };
  let installPrompt = null;

  const persist = () => {
    store.set(KEY_DATA(), { cliente: S.cliente, entries: S.entries });
    store.set(KEY_QUEUE(), S.queue);
  };

  /* ---------- données de démonstration (mode sans backend) ---------- */
  function seedDemo() {
    if (store.get(KEY_DATA())) return;
    const start = addDays(today(), -41);
    const entries = {};
    const paliers = { 8: 1600, 12: 1800, 16: 2000, 21: 2200, 28: 2000, 35: 1800 };
    const etapeAt = (i) => (i < 7 ? "Observation" : i < 21 ? "Calibrage" : i < 28 ? "Maintenance" : "Cycle A");
    for (let i = 0; i <= 41; i++) {
      const d = addDays(start, i);
      const e = {
        poids: Math.round((78.4 - i * 0.055 + 0.35 * Math.sin(i * 1.7) + (i % 9 === 4 ? 0.4 : 0)) * 10) / 10,
        sommeil: [4, 3, 4, 2, 4, 5, 3][i % 7],
        forme: [4, 4, 3, 4, 5, 4, 3][i % 7],
        cc: i < 3 ? 1 : [3, 2, 3, 3, 1, 3, 2][i % 7]
      };
      if (paliers[i]) e.palier = paliers[i];
      if (isSunday(d)) {
        Object.assign(e, {
          taille: 96 - Math.floor(i / 7) * 0.7,
          pas: 6200 + Math.floor(i / 7) * 450,
          kcal: 1500 + Math.floor(i / 7) * 120,
          prot: i > 28 ? 105 : "",
          etape: etapeAt(i)
        });
        e.taille = Math.round(e.taille * 10) / 10;
      }
      if (i === 41) { delete e.poids; delete e.sommeil; delete e.forme; delete e.cc; }
      entries[d] = e;
    }
    S.entries = entries;
    S.cliente = { prenom: "Catherine", depart: 78.4, maintKcal: 2200, maintPas: 8000, cibleProt: 120 };
    S.loaded = true;
    persist();
  }

  /* ---------- échanges avec le Google Sheets (Apps Script) ---------- */
  async function apiGet(q) {
    const res = await fetch(`${API}?${new URLSearchParams(q)}`, { cache: "no-store" });
    const j = await res.json();
    if (!j.ok) throw Object.assign(new Error(j.error || "Erreur"), { server: true });
    return j;
  }
  async function apiPost(body) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    const j = await res.json();
    if (!j.ok) throw Object.assign(new Error(j.error || "Erreur"), { server: true });
    return j;
  }

  async function loadRemote() {
    if (DEMO || !code) return;
    try {
      const j = await apiGet({ action: "load", code });
      S.cliente = j.cliente || {};
      const entries = {};
      (j.entries || []).forEach((e) => { entries[e.date] = clean(e); });
      // les saisies pas encore envoyées gardent la priorité
      S.queue.forEach((q) => { if (q.kind === "save") entries[q.date] = q.entry; });
      S.entries = entries;
      S.loaded = true;
      S.error = "";
      // les brouillons calculés avant l'arrivée des données sont recalculés, sauf ceux déjà modifiés
      Object.keys(S.drafts).forEach((k) => { if (!S.touched[k]) delete S.drafts[k]; });
      persist();
    } catch (err) {
      if (err.server) {
        S.error = err.message;
        if (!S.loaded) { code = ""; store.set("phenix:last-code", null); }
      }
    }
    render();
    flush();
  }

  async function flush() {
    if (DEMO || S.syncing || !S.queue.length || !navigator.onLine) { renderSync(); return; }
    S.syncing = true;
    renderSync();
    try {
      while (S.queue.length) {
        const q = S.queue[0];
        if (q.kind === "save") await apiPost({ action: "save", code, date: q.date, entry: q.entry });
        if (q.kind === "reperes") await apiPost({ action: "reperes", code, reperes: q.reperes });
        S.queue.shift();
        persist();
      }
    } catch (_) { /* on réessaiera plus tard */ }
    S.syncing = false;
    renderSync();
  }

  function enqueue(item) {
    if (DEMO) return;
    if (item.kind === "save") S.queue = S.queue.filter((q) => !(q.kind === "save" && q.date === item.date));
    if (item.kind === "reperes") S.queue = S.queue.filter((q) => q.kind !== "reperes");
    S.queue.push(item);
    persist();
    flush();
  }

  /* ---------- calculs ---------- */
  const clean = (e) => {
    const out = {};
    ["poids", "sommeil", "forme", "cc", "palier", "taille", "pas", "kcal", "prot"].forEach((k) => {
      const n = toNum(e[k]);
      if (n !== "" && !Number.isNaN(n)) out[k] = n;
    });
    if (e.etape && ETAPES.includes(e.etape)) out.etape = e.etape;
    return out;
  };
  const dates = () => Object.keys(S.entries).sort();
  const lastBefore = (field, day, inclusive = false) => {
    const ds = dates().filter((d) => (inclusive ? d <= day : d < day));
    for (let i = ds.length - 1; i >= 0; i--) {
      const v = S.entries[ds[i]][field];
      if (v !== undefined && v !== "") return { date: ds[i], value: v };
    }
    return null;
  };
  function weightSeries() {
    const pts = dates().filter((d) => typeof S.entries[d].poids === "number").map((d) => ({ d, w: S.entries[d].poids }));
    return pts.map((p) => {
      const win = pts.filter((q) => q.d <= p.d && diffDays(p.d, q.d) < 7);
      return { ...p, avg: win.reduce((s, q) => s + q.w, 0) / win.length };
    });
  }

  /* ---------- brouillon du jour ---------- */
  function draftFor(day) {
    if (!S.drafts[day]) {
      const saved = S.entries[day] || {};
      const d = {};
      Object.keys(saved).forEach((k) => { d[k] = typeof saved[k] === "number" ? fr(saved[k], 1).replace(/\s/g, "") : saved[k]; });
      if (isSunday(day) && !d.etape) {
        const prev = lastBefore("etape", day);
        if (prev) d.etape = prev.value;
      }
      d.changePalier = saved.palier !== undefined;
      S.drafts[day] = d;
    }
    return S.drafts[day];
  }
  function normalized(d, day) {
    const e = {};
    const keys = ["poids", "sommeil", "forme", "cc"];
    if (d.changePalier) keys.push("palier");
    if (isSunday(day)) keys.push("taille", "pas", "kcal", "prot");
    for (const k of keys) {
      const n = toNum(d[k]);
      if (Number.isNaN(n)) return { error: k };
      if (n === "") continue;
      if (NUM_FIELDS[k] && (n < NUM_FIELDS[k][0] || n > NUM_FIELDS[k][1])) return { error: k };
      e[k] = n;
    }
    if (isSunday(day) && d.etape) e.etape = d.etape;
    return { entry: e };
  }
  const sameEntry = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
  function isDirty(day) {
    const n = normalized(draftFor(day), day);
    if (n.error) return true;
    return !sameEntry(n.entry, S.entries[day] || {});
  }

  /* ---------- rendu ---------- */
  function renderHeader() {
    const p = S.cliente.prenom;
    $("#hello").textContent = p ? `Bonjour ${p}` : "Bonjour";
    renderSync();
  }
  function renderSync() {
    const el = $("#sync");
    if (DEMO) { el.innerHTML = 'Méthode Phénix<span class="demo-tag">mode démo</span>'; return; }
    if (S.queue.length) {
      el.textContent = navigator.onLine
        ? (S.syncing ? "Envoi en cours…" : `${S.queue.length} saisie(s) en attente d'envoi`)
        : `Hors connexion · ${S.queue.length} saisie(s) gardée(s) sur le téléphone`;
    } else el.textContent = "Méthode Phénix · tout est enregistré";
  }

  const chips = (field, values, cur, opts = {}) => `
    <div class="chips c${opts.cols || values.length}">
      ${values.map((v) => {
        const on = String(cur) === String(v);
        const alerte = on && opts.alerte && opts.alerte.includes(v);
        return `<button type="button" class="chip${opts.small ? " small" : ""}${on ? " on" : ""}${alerte ? " alerte" : ""}"
          data-set="${field}" data-v="${esc(v)}" aria-pressed="${on}">${esc(v)}</button>`;
      }).join("")}
    </div>`;
  const numField = (field, val, unit, placeholder, mode = "decimal") => `
    <div class="num">
      <input data-num="${field}" inputmode="${mode}" autocomplete="off" enterkeyhint="done"
        value="${esc(val ?? "")}" placeholder="${esc(placeholder ?? "")}" aria-label="${field}">
      <span class="unit">${unit}</span>
    </div>`;

  function viewGate() {
    return `
      <section class="gate">
        <img src="icons/icon-192.png" alt="">
        <h1>Ton suivi <em>Phénix</em></h1>
        <p>${S.error ? esc(S.error) : "Ouvre l'appli avec le lien personnel que Nathan t'a envoyé."}</p>
        <div class="card" style="text-align:left">
          <div class="label">Ou saisis ton code</div>
          <div class="num"><input id="gate-code" autocapitalize="characters" placeholder="Ex : K7PM2Q" aria-label="Code"></div>
          <button class="btn2" data-act="gate">Valider</button>
        </div>
      </section>`;
  }

  function viewJour() {
    const day = S.day;
    const d = draftFor(day);
    const t = today();
    const off = diffDays(t, day);
    const title = off === 0 ? "Aujourd'hui" : off === 1 ? "Hier" : `Il y a ${off} jours`;
    const lastW = lastBefore("poids", day);
    const pal = lastBefore("palier", day);
    const palDays = pal ? diffDays(day, pal.date) : null;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const showInstall = !standalone && !store.get("phenix:install-dismissed") && off === 0;

    let palNote = "";
    if (d.changePalier && pal && palDays < 3) {
      palNote = `<div class="note warn">Ton dernier changement de palier date d'il y a ${palDays} jour${palDays > 1 ? "s" : ""}.
        <b>Règle des 72 h :</b> attends au moins 3 jours d'observation avant de bouger.</div>`;
    }

    const week = isSunday(day) ? `
      <section class="card week">
        <div class="eyebrow">Dimanche · avant l'atelier</div>
        <h2>Bilan de la semaine</h2>
        <div class="field">
          <div class="label">Tour de taille <small>au nombril, à jeun</small></div>
          ${numField("taille", d.taille, "cm", lastBefore("taille", day) ? fr(lastBefore("taille", day).value) : "Ex : 94")}
        </div>
        <div class="field">
          <div class="label">Pas · moyenne de la semaine</div>
          <div class="hint">Appli Santé → Pas → vue Semaine</div>
          ${numField("pas", d.pas, "pas", "Ex : 8 200", "numeric")}
        </div>
        <div class="field">
          <div class="label">Calories · moyenne de la semaine</div>
          <div class="hint">SnapCalorie → Charts → ligne « Daily Average »</div>
          ${numField("kcal", d.kcal, "kcal", "Ex : 1 750", "numeric")}
        </div>
        <div class="field">
          <div class="label">Protéines · moyenne de la semaine <small>dès le module macros</small></div>
          ${numField("prot", d.prot, "g", S.cliente.cibleProt ? `Cible : ${fr(S.cliente.cibleProt, 0)} g` : "Ex : 110", "numeric")}
        </div>
        <div class="field">
          <div class="label">Mon étape</div>
          ${chips("etape", ETAPES, d.etape, { cols: 3, small: true })}
        </div>
      </section>` : `
      <div class="note" style="margin-bottom:14px">Le <b>bilan de la semaine</b> (tour de taille, moyennes, étape) se remplit le dimanche matin, avant l'atelier.</div>`;

    return `
      ${showInstall ? `<div class="note" style="margin:0 0 14px;display:flex;gap:10px;align-items:center;justify-content:space-between">
        <span>📲 Installe l'appli sur ton écran d'accueil.</span>
        <button class="btn2" style="width:auto;height:40px;margin:0;padding:0 14px;white-space:nowrap" data-act="go-install">Comment ?</button></div>` : ""}
      <div class="daybar">
        <button data-act="prev" aria-label="Jour précédent" ${off >= JOURS_ARRIERE ? "disabled" : ""}>‹</button>
        <div class="daylabel"><b>${title}</b><span>${longDate(day)}</span></div>
        <button data-act="next" aria-label="Jour suivant" ${off <= 0 ? "disabled" : ""}>›</button>
      </div>

      <section class="card">
        <div class="eyebrow">Le matin, juste après la pesée</div>
        <h2>Ma journée</h2>

        <div class="field">
          <div class="label">Poids <small>à jeun, après les toilettes</small></div>
          ${numField("poids", d.poids, "kg", lastW ? fr(lastW.value) : "Ex : 72,4")}
        </div>

        <div class="field">
          <div class="label">Sommeil de la nuit</div>
          ${chips("sommeil", [1, 2, 3, 4, 5], d.sommeil)}
          <div class="scale"><span>1 · très mauvaise</span><span>5 · excellente</span></div>
        </div>

        <div class="field">
          <div class="label">Ma forme d'hier</div>
          ${chips("forme", [1, 2, 3, 4, 5], d.forme, { alerte: [1, 2] })}
          <div class="scale"><span>1 · épuisée</span><span>5 · pleine forme</span></div>
          <div class="hint" style="margin-top:8px">1 ou 2 = au moins un signe de fatigue : pensées obsédantes sur la nourriture, fatigue malgré une bonne nuit, irritabilité, baisse de forme.</div>
        </div>

        <div class="field">
          <div class="label">Cohérence cardiaque d'hier <small>séances de 5 min</small></div>
          ${chips("cc", [0, 1, 2, 3], d.cc)}
        </div>

        <div class="field">
          <div class="switch">
            <div>
              <div class="label">J'ai changé de palier aujourd'hui</div>
              <div class="hint" style="margin:0">${pal ? `Palier actuel : <b>${fr(pal.value, 0)} kcal</b> depuis ${palDays === 0 ? "aujourd'hui" : palDays + " j"}` : "Pas encore de palier noté"}</div>
            </div>
            <button type="button" data-act="toggle-palier" aria-pressed="${!!d.changePalier}" aria-label="Changement de palier"></button>
          </div>
          ${d.changePalier ? numField("palier", d.palier, "kcal", pal ? `Ex : ${fr(pal.value + 200, 0)}` : "Ex : 1 800", "numeric") : ""}
          ${palNote}
        </div>
      </section>

      ${week}

      <button class="save" data-act="save" ${isDirty(day) ? "" : "disabled"}>${saveLabel(day)}</button>`;
  }

  function chartSvg(series, depart) {
    const W = 340, H = 200, P = { l: 34, r: 10, t: 12, b: 26 };
    const ws = series.map((p) => p.w).concat(depart ? [depart] : []);
    let lo = Math.min(...ws), hi = Math.max(...ws);
    if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
    lo = Math.floor(lo * 2) / 2 - 0.5; hi = Math.ceil(hi * 2) / 2 + 0.5;
    const d0 = series[0].d, span = Math.max(1, diffDays(series[series.length - 1].d, d0));
    const x = (d) => P.l + (diffDays(d, d0) / span) * (W - P.l - P.r);
    const y = (w) => P.t + (1 - (w - lo) / (hi - lo)) * (H - P.t - P.b);
    const avgPath = series.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
    const ticks = [lo + 0.5, (lo + hi) / 2, hi - 0.5];
    return `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe du poids">
        ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#EAF2EC" stroke-width="1"/>
          <text x="${P.l - 6}" y="${y(t) + 4}" font-size="10.5" fill="#4A5E51" text-anchor="end">${fr(t)}</text>`).join("")}
        ${depart ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(depart)}" y2="${y(depart)}" stroke="#82A38B" stroke-width="1.5" stroke-dasharray="4 4"/>` : ""}
        ${series.map((p) => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="2.6" fill="#82A38B" opacity=".55"/>`).join("")}
        <path d="${avgPath}" fill="none" stroke="#EE6055" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="${P.l}" y="${H - 6}" font-size="10.5" fill="#4A5E51">${shortDate(d0)}</text>
        <text x="${W - P.r}" y="${H - 6}" font-size="10.5" fill="#4A5E51" text-anchor="end">${shortDate(series[series.length - 1].d)}</text>
      </svg>`;
  }

  function viewProgres() {
    const series = weightSeries();
    if (!series.length) return `<section class="card empty">Ta courbe apparaîtra après tes premières pesées.<br>Note ton poids chaque matin dans « Ma journée ».</section>`;
    const depart = Number(S.cliente.depart) || series[0].w;
    const last = series[series.length - 1];
    const lossKg = depart - last.avg;
    const pct = (lossKg / depart) * 100;
    const goal = depart * 0.9;
    const fill = Math.max(0, Math.min(100, (pct / 10) * 100));
    const big = lossKg >= 0.05 ? `−${fr(lossKg)} <em>kg</em>` : lossKg <= -0.05 ? `+${fr(-lossKg)} <em>kg</em>` : `0 <em>kg</em>`;

    const t = today();
    const last7 = (k) => { const v = []; for (let i = 0; i < 7; i++) { const e = S.entries[addDays(t, -i)]; if (e && typeof e[k] === "number") v.push(e[k]); } return v; };
    const ccs = last7("cc"), som = last7("sommeil"), frm = last7("forme");
    const moy = (a) => (a.length ? fr(a.reduce((s, v) => s + v, 0) / a.length) : "—");
    const pas = lastBefore("pas", t, true);
    const pal = lastBefore("palier", t, true);
    const tailles = dates().filter((d) => typeof S.entries[d].taille === "number").map((d) => S.entries[d].taille);

    return `
      <section class="card hero">
        <div class="eyebrow">Depuis ton départ</div>
        <div class="big">${big}</div>
        <div class="sub">${pct >= 0 ? "−" : "+"}${fr(Math.abs(pct))} % · moyenne de tes 7 dernières pesées</div>
        <div class="bar" aria-hidden="true"><i style="width:${fill}%"></i></div>
        <div class="bar-legend"><span>Départ ${fr(depart)} kg</span><span>Objectif −10 % : ${fr(goal)} kg</span></div>
      </section>

      <section class="card chart">
        <h2>Mon poids</h2>
        <p class="lead">Les points bougent avec l'eau, c'est normal. La courbe, elle, montre la vraie tendance.</p>
        ${chartSvg(series, depart)}
        <div class="legend"><span><i style="background:#EE6055"></i>Moyenne sur 7 jours</span><span><i style="background:#82A38B;opacity:.6"></i>Pesées</span><span><i style="background:none;border-top:2px dashed #82A38B;height:0"></i>Départ</span></div>
      </section>

      <section class="card">
        <h2>Mes 7 derniers jours</h2>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><b>${ccs.reduce((s, v) => s + v, 0)}<small style="font-size:15px">/21</small></b><span>cohérences cardiaques</span></div>
          <div class="tile"><b>${moy(som)}</b><span>sommeil moyen /5</span></div>
          <div class="tile"><b>${moy(frm)}</b><span>forme moyenne /5</span></div>
        </div>
        ${pal ? `<div class="note">Palier actuel : <b>${fr(pal.value, 0)} kcal</b>${S.cliente.maintKcal ? ` · maintenance optimisée : ${fr(S.cliente.maintKcal, 0)} kcal` : ""}</div>` : ""}
        ${pas ? `<div class="note">Pas (dernière moyenne) : <b>${fr(pas.value, 0)}</b> ${pas.value >= 8000 ? "✓ objectif de 8 000 atteint" : "· objectif : 8 000 minimum"}</div>` : ""}
      </section>

      ${tailles.length ? `<section class="card">
        <h2>Tour de taille</h2>
        <p class="lead" style="margin-top:6px">${tailles.length > 1
          ? `${fr(tailles[0])} cm → <b>${fr(tailles[tailles.length - 1])} cm</b> (${tailles[tailles.length - 1] <= tailles[0] ? "−" : "+"}${fr(Math.abs(tailles[tailles.length - 1] - tailles[0]))} cm)`
          : `Première mesure : <b>${fr(tailles[0])} cm</b>`}</p>
      </section>` : ""}`;
  }

  function viewReperes() {
    const c = S.cliente;
    const r = S.drafts.__reperes || (S.drafts.__reperes = {
      depart: c.depart ? fr(c.depart).replace(/\s/g, "") : "", maintKcal: c.maintKcal ?? "", maintPas: c.maintPas ?? "", cibleProt: c.cibleProt ?? ""
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const link = `${location.origin}${location.pathname}?c=${code}`;
    return `
      <section class="card">
        <div class="eyebrow">À remplir une fois</div>
        <h2>Mes repères</h2>
        <div class="field">
          <div class="label">Poids de départ <small>formulaire de départ</small></div>
          <div class="num"><input data-rep="depart" inputmode="decimal" value="${esc(r.depart)}" placeholder="Ex : 78,4" aria-label="Poids de départ"><span class="unit">kg</span></div>
        </div>
        <div class="field">
          <div class="label">Maintenance optimisée</div>
          <div class="kv">
            <div class="num"><input data-rep="maintKcal" inputmode="numeric" value="${esc(r.maintKcal)}" placeholder="2 200" aria-label="Maintenance kcal"><span class="unit">kcal</span></div>
            <div class="num"><input data-rep="maintPas" inputmode="numeric" value="${esc(r.maintPas)}" placeholder="8 000" aria-label="Maintenance pas"><span class="unit">pas</span></div>
          </div>
        </div>
        <div class="field">
          <div class="label">Cible protéines <small>calculateur de macros</small></div>
          <div class="num"><input data-rep="cibleProt" inputmode="numeric" value="${esc(r.cibleProt)}" placeholder="120" aria-label="Cible protéines"><span class="unit">g</span></div>
        </div>
        <button class="btn2" data-act="save-reperes">Enregistrer mes repères</button>
      </section>

      <section class="card" id="install">
        <h2>Installer l'appli</h2>
        <p class="lead">Pour l'ouvrir en un geste, comme une vraie appli.</p>
        ${installPrompt ? `<button class="save" style="position:static" data-act="install">Installer Phénix</button>` : ""}
        ${isIOS ? `<ol class="steps">
            <li>Ouvre ce lien dans <b>Safari</b>.</li>
            <li>Touche le bouton <b>Partager</b> (carré avec une flèche).</li>
            <li>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li></ol>`
          : `<ol class="steps">
            <li>Ouvre ce lien dans <b>Chrome</b>.</li>
            <li>Touche le menu <b>⋮</b> en haut à droite.</li>
            <li>Choisis <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</li></ol>`}
      </section>

      <section class="card">
        <h2>Mon rituel</h2>
        <ol class="steps">
          <li><b>Chaque matin</b>, juste après ta pesée (30 s) : poids, nuit, forme d'hier, cohérences cardiaques d'hier. Palier seulement s'il change.</li>
          <li><b>Le dimanche matin</b>, avant l'atelier (2 min) : tour de taille, moyennes de la semaine et étape.</li>
          <li>Rien à noter ? Laisse vide.</li>
        </ol>
      </section>

      <section class="card">
        <h2>Mon lien personnel</h2>
        <p class="lead">Garde-le pour toi : il ouvre ton suivi.</p>
        <div class="code">${esc(link)}</div>
      </section>`;
  }

  function render() {
    renderHeader();
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
    const nav = $("#tabs");
    if (!code) { nav.hidden = true; $("#view").innerHTML = viewGate(); return; }
    nav.hidden = false;
    const html = S.tab === "progres" ? viewProgres() : S.tab === "reperes" ? viewReperes() : viewJour();
    $("#view").innerHTML = html;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function refreshSaveButton() {
    const b = $('[data-act="save"]');
    if (!b) return;
    b.disabled = !isDirty(S.day);
    b.textContent = saveLabel(S.day);
  }
  function saveLabel(day) {
    const e = S.entries[day] || {};
    return !isDirty(day) && MATIN.some((k) => e[k] !== undefined) ? "Enregistré ✓" : "Enregistrer";
  }

  /* ---------- actions ---------- */
  const LABELS = { poids: "le poids", palier: "le palier", taille: "le tour de taille", pas: "les pas", kcal: "les calories", prot: "les protéines" };

  function saveDay() {
    const day = S.day;
    const n = normalized(draftFor(day), day);
    if (n.error) { toast(`Vérifie ${LABELS[n.error] || "la saisie"}`); return; }
    S.entries[day] = n.entry;
    if (!Object.keys(n.entry).length) delete S.entries[day];
    delete S.drafts[day];
    delete S.touched[day];
    persist();
    enqueue({ kind: "save", date: day, entry: n.entry });
    const complet = MATIN.every((k) => n.entry[k] !== undefined);
    toast(complet ? "Bravo, ta journée est notée ✓" : "Enregistré ✓");
    render();
  }

  function saveReperes() {
    const r = S.drafts.__reperes || {};
    const out = {};
    for (const k of Object.keys(REP_FIELDS)) {
      const n = toNum(r[k]);
      if (Number.isNaN(n) || (n !== "" && (n < REP_FIELDS[k][0] || n > REP_FIELDS[k][1]))) { toast("Vérifie tes repères"); return; }
      out[k] = n;
    }
    Object.assign(S.cliente, out);
    delete S.drafts.__reperes;
    delete S.touched.__reperes;
    persist();
    enqueue({ kind: "reperes", reperes: out });
    toast("Repères enregistrés ✓");
    render();
  }

  document.addEventListener("click", async (ev) => {
    const tab = ev.target.closest("[data-tab]");
    if (tab) { S.tab = tab.dataset.tab; render(); scrollTo(0, 0); return; }

    const chip = ev.target.closest("[data-set]");
    if (chip) {
      const d = draftFor(S.day);
      const f = chip.dataset.set;
      const v = f === "etape" ? chip.dataset.v : Number(chip.dataset.v);
      d[f] = String(d[f]) === String(v) ? "" : v;
      S.touched[S.day] = true;
      render();
      return;
    }

    const act = ev.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "prev") { S.day = addDays(S.day, -1); render(); }
    if (a === "next") { S.day = addDays(S.day, 1); render(); }
    if (a === "save") saveDay();
    if (a === "save-reperes") saveReperes();
    if (a === "toggle-palier") { const d = draftFor(S.day); d.changePalier = !d.changePalier; S.touched[S.day] = true; render(); }
    if (a === "go-install") { store.set("phenix:install-dismissed", true); S.tab = "reperes"; render(); setTimeout(() => $("#install")?.scrollIntoView({ behavior: "smooth" }), 50); }
    if (a === "install" && installPrompt) { installPrompt.prompt(); installPrompt = null; }
    if (a === "gate") {
      const v = ($("#gate-code").value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (v) location.href = `${location.pathname}?c=${v}`;
    }
  });

  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.dataset.num) { draftFor(S.day)[el.dataset.num] = el.value; S.touched[S.day] = true; refreshSaveButton(); }
    if (el.dataset.rep) { (S.drafts.__reperes ||= {})[el.dataset.rep] = el.value; S.touched.__reperes = true; }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur();
  });

  window.addEventListener("online", () => { renderSync(); flush(); });
  window.addEventListener("offline", renderSync);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (S.tab === "reperes") render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (S.day > today()) S.day = today();
      flush();
    }
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  /* ---------- démarrage ---------- */
  if (DEMO && code) seedDemo();
  render();
  loadRemote();
})();
