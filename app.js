/* Phénix — Mon suivi. Appli de saisie quotidienne des clientes de la méthode Phénix. */
(() => {
  "use strict";

  const API = String(window.PHENIX_API || "").trim();
  const DEMO = !API;
  const ETAPES = ["Observation", "Calibrage", "Maintenance", "Cycle A", "Cycle B", "Pause"];
  const MATIN = ["poids", "pasJour", "sommeil", "forme", "cc"];
  // case d'hier : 1 = fait, 0 = pas fait (seulement si la journée est remplie).
  // « Objectif de pas atteint » (pasOk) n'est plus une case : il se calcule à partir des pas d'hier.
  const CHECKS = ["palOk"];
  const NUM_FIELDS = {
    poids: [30, 250], pasJour: [0, 60000], palier: [800, 5000], taille: [40, 200],
    pas: [0, 60000], kcal: [500, 6000], prot: [0, 400]
  };
  const PROFIL_NUM = {
    depart: [30, 250], maintKcal: [800, 5000], maintPas: [0, 60000], cibleProt: [0, 400],
    age: [15, 99], taille: [100, 230], poidsCible: [30, 250], moyPasS1: [0, 60000],
    moyKcalS1: [500, 6000], objectifPas: [0, 60000]
  };
  const JOURS_ARRIERE = 13; // on peut rattraper jusqu'à 2 semaines
  // Niveaux d'activité selon la moyenne de pas (même grille que le calculateur de dépense calorique)
  const NIVEAUX = [
    { nom: "Sédentaire", pas: "Moins de 6 000 pas", min: 0, facteur: 1.2 },
    { nom: "Activité légère", pas: "6 000 – 10 000 pas", min: 6000, facteur: 1.375 },
    { nom: "Activité modérée", pas: "10 000 – 15 000 pas", min: 10000, facteur: 1.55 },
    { nom: "Activité intense", pas: "15 000 – 20 000 pas", min: 15000, facteur: 1.725 },
    { nom: "Athlète", pas: "Plus de 20 000 pas", min: 20000, facteur: 1.9 }
  ];

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
  const has = (v) => v !== "" && v !== null && v !== undefined;
  const inputVal = (v) => (typeof v === "number" ? fr(v).replace(/\s/g, "") : (v ?? ""));

  /* ---------- identité de la cliente ---------- */
  const params = new URLSearchParams(location.search);
  // Mode consultation (ouvert par Nathan depuis le dashboard) : rien n'est modifiable ni gardé sur l'appareil
  const LECTURE = params.has("lecture");
  let code = (params.get("c") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code && !LECTURE) code = store.get("phenix:last-code") || "";
  if (!code && DEMO) code = "DEMO";
  if (code && !LECTURE) store.set("phenix:last-code", code);
  if (LECTURE) document.body.classList.add("lecture");

  const KEY_DATA = () => `phenix:data:${code}`;
  const KEY_QUEUE = () => `phenix:queue:${code}`;

  /* ---------- état ---------- */
  const cached = code && !LECTURE ? store.get(KEY_DATA()) : null;
  const S = {
    cliente: (cached && cached.cliente) || {},
    entries: (cached && cached.entries) || {},
    queue: (code && !LECTURE && store.get(KEY_QUEUE())) || [],
    tab: "jour",
    day: today(),
    drafts: {},
    touched: {},
    ob: null,        // formulaire de départ en cours
    tools: null,     // valeurs des outils (pré-remplies)
    syncing: false,
    loaded: !!cached,
    error: ""
  };
  let installPrompt = null;

  const persist = () => {
    if (LECTURE) return;
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
      e.pasJour = Math.round(6000 + i * 70 + 1400 * Math.sin(i * 2.3));
      if (i > 8) { e.pasOk = e.pasJour >= 8000 ? 1 : 0; e.palOk = i % 6 === 0 ? 0 : 1; }
      if (paliers[i]) e.palier = paliers[i];
      if (isSunday(d)) {
        Object.assign(e, {
          taille: Math.round((96 - Math.floor(i / 7) * 0.7) * 10) / 10,
          pas: 6200 + Math.floor(i / 7) * 450,
          kcal: 1500 + Math.floor(i / 7) * 120,
          etape: etapeAt(i)
        });
        if (i > 28) e.prot = 105;
      }
      if (i === 41) { MATIN.concat(CHECKS, ["pasOk"]).forEach((k) => delete e[k]); }
      entries[d] = e;
    }
    S.entries = params.has("form") ? {} : entries;
    S.cliente = params.has("form") ? { prenom: "Catherine" } : {
      prenom: "Catherine", depart: 78.4, maintKcal: 2200, maintPas: 8000, cibleProt: 120, objectifPas: 9000,
      sexe: "femme", age: 54, taille: 164, poidsCible: 68, motivation: "Me sentir bien dans mes vêtements et avoir plus d'énergie.",
      formDate: start, moyPasS1: 6240, moyKcalS1: 1480
    };
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
      const cliente = j.cliente || {};
      // date du formulaire toujours au format AAAA-MM-JJ
      if (cliente.formDate && !/^\d{4}-\d{2}-\d{2}$/.test(cliente.formDate)) {
        const d = new Date(cliente.formDate);
        cliente.formDate = Number.isNaN(d.getTime()) ? "" : ymd(d);
      }
      const entries = {};
      (j.entries || []).forEach((e) => { entries[e.date] = clean(e); });
      // ce qui n'est pas encore envoyé garde la priorité
      S.queue.forEach((q) => {
        if (q.kind === "save") entries[q.date] = q.entry;
        if (q.kind === "profil") Object.assign(cliente, q.profil, q.profil.form ? { formDate: S.cliente.formDate || today() } : {});
      });
      S.cliente = cliente;
      S.entries = entries;
      S.loaded = true;
      S.error = "";
      Object.keys(S.drafts).forEach((k) => { if (!S.touched[k]) delete S.drafts[k]; });
      if (!S.touched.__tools) S.tools = null;
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
        if (q.kind === "profil") await apiPost({ action: "profil", code, profil: q.profil });
        S.queue.shift();
        persist();
      }
    } catch (_) { /* on réessaiera plus tard */ }
    S.syncing = false;
    renderSync();
  }

  function enqueue(item) {
    if (DEMO || LECTURE) return;
    if (item.kind === "save") S.queue = S.queue.filter((q) => !(q.kind === "save" && q.date === item.date));
    if (item.kind === "profil") {
      const prev = S.queue.find((q) => q.kind === "profil");
      if (prev) { Object.assign(prev.profil, item.profil); persist(); flush(); return; }
    }
    S.queue.push(item);
    persist();
    flush();
  }

  function saveProfil(p) {
    Object.assign(S.cliente, p);
    if (p.form) { S.cliente.formDate = today(); delete S.cliente.form; }
    persist();
    enqueue({ kind: "profil", profil: { ...p } });
  }

  /* ---------- calculs ---------- */
  const clean = (e) => {
    const out = {};
    ["poids", "pasJour", "sommeil", "forme", "cc", "pasOk", "palOk", "palier", "taille", "pas", "kcal", "prot"].forEach((k) => {
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
  const poidsActuel = () => {
    const s = weightSeries();
    return s.length ? Math.round(s[s.length - 1].avg * 10) / 10 : (has(S.cliente.depart) ? Number(S.cliente.depart) : "");
  };
  const objectifPas = () => Number(S.cliente.objectifPas) || Number(S.cliente.maintPas) || 8000;
  // les cases d'hier apparaissent dès qu'un palier existe (fin de la semaine d'observation)
  const hasPalierBefore = (day) => !!lastBefore("palier", day);
  // Moyenne des pas sur les 7 saisies du matin qui finissent à `jour` (chaque saisie = les pas de la veille).
  // `ceJour` remplace la valeur enregistrée du jour (brouillon en cours).
  function pasMoyen(jour, ceJour) {
    const v = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(jour, -i);
      const p = i === 0 && ceJour !== undefined ? ceJour : (S.entries[d] || {}).pasJour;
      if (typeof p === "number") v.push(p);
    }
    return v.length ? { moy: Math.round(v.reduce((s, x) => s + x, 0) / v.length), n: v.length } : null;
  }

  // Calculateur de dépense calorique : Mifflin-St Jeor × niveau d'activité selon les pas
  function calcDepense(t) {
    const age = toNum(t.age), taille = toNum(t.taille), poids = toNum(t.poids), pas = toNum(t.pas);
    if ([age, taille, poids, pas].some((v) => v === "" || Number.isNaN(v))) return null;
    if (age < 15 || age > 99 || taille < 100 || taille > 230 || poids <= 0 || pas < 0) return null;
    const bmr = 10 * poids + 6.25 * taille - 5 * age + (t.sexe === "homme" ? 5 : -161);
    let niveau = NIVEAUX[0];
    NIVEAUX.forEach((n) => { if (pas >= n.min) niveau = n; });
    return { bmr, niveau, tdee: bmr * niveau.facteur, imc: poids / Math.pow(taille / 100, 2), pas };
  }
  // Calculateur de macros : lipides 1 g/kg, protéines 1,6 g/kg, fibres 15 g / 1 000 kcal, glucides = le reste
  function calcMacros(t) {
    const poids = toNum(t.poids), palier = toNum(t.palier);
    if (!(poids > 0) || !(palier > 0)) return null;
    const lip = poids, prot = poids * 1.6;
    return { palier, lip, prot, glu: (palier - (prot * 4 + lip * 9)) / 4, fib: (palier * 15) / 1000 };
  }
  const imcNote = (imc) => (imc < 18.5 ? "Insuffisance pondérale" : imc < 25 ? "Corpulence normale" : imc < 30 ? "Surpoids" : "Obésité");

  /* ---------- brouillon du jour ---------- */
  function draftFor(day) {
    if (!S.drafts[day]) {
      const saved = S.entries[day] || {};
      const d = {};
      Object.keys(saved).forEach((k) => { d[k] = typeof saved[k] === "number" ? fr(saved[k], 1).replace(/\s/g, "") : saved[k]; });
      CHECKS.forEach((k) => { d[k] = saved[k] === 1; });
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
    const keys = ["poids", "pasJour", "sommeil", "forme", "cc"];
    if (d.changePalier) keys.push("palier");
    if (isSunday(day)) keys.push("taille", "kcal", "prot");
    for (const k of keys) {
      const n = toNum(d[k]);
      if (Number.isNaN(n)) return { error: k };
      if (n === "") continue;
      if (NUM_FIELDS[k] && (n < NUM_FIELDS[k][0] || n > NUM_FIELDS[k][1])) return { error: k };
      e[k] = n;
    }
    if (isSunday(day) && d.etape) e.etape = d.etape;
    // le dimanche, la moyenne de pas de la semaine se calcule toute seule
    if (isSunday(day)) {
      const m = pasMoyen(day, e.pasJour === undefined ? null : e.pasJour);
      if (m) e.pas = m.moy;
    }
    if (hasPalierBefore(day)) {
      // objectif de pas atteint : calculé à partir des pas d'hier
      if (e.pasJour !== undefined) e.pasOk = e.pasJour >= objectifPas() ? 1 : 0;
      // une case non cochée vaut « non » seulement si la journée est remplie ; sinon elle reste vide
      const rempli = MATIN.some((k) => e[k] !== undefined) || CHECKS.some((k) => d[k]);
      CHECKS.forEach((k) => { if (d[k]) e[k] = 1; else if (rempli) e[k] = 0; });
    }
    return { entry: e };
  }
  const sameEntry = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
  function isDirty(day) {
    const n = normalized(draftFor(day), day);
    if (n.error) return true;
    return !sameEntry(n.entry, S.entries[day] || {});
  }
  function saveLabel(day) {
    const e = S.entries[day] || {};
    return !isDirty(day) && MATIN.some((k) => e[k] !== undefined) ? "Enregistré ✓" : "Enregistrer";
  }

  /* ---------- rendu : morceaux réutilisables ---------- */
  function renderHeader() {
    const p = S.cliente.prenom;
    $("#hello").textContent = p ? `Bonjour ${p}` : "Bonjour";
    renderSync();
  }
  function renderSync() {
    const el = $("#sync");
    if (LECTURE) { el.innerHTML = 'Mode consultation<span class="demo-tag">lecture seule</span>'; return; }
    if (DEMO) { el.innerHTML = 'Méthode Phénix<span class="demo-tag">mode démo</span>'; return; }
    if (S.queue.length) {
      el.textContent = navigator.onLine
        ? (S.syncing ? "Envoi en cours…" : `${S.queue.length} envoi(s) en attente`)
        : `Hors connexion · ${S.queue.length} envoi(s) gardé(s) sur le téléphone`;
    } else el.textContent = "Méthode Phénix · tout est enregistré";
  }

  const chips = (field, values, cur, opts = {}) => `
    <div class="chips c${opts.cols || values.length}">
      ${values.map((v, i) => {
        const on = String(cur) === String(v);
        const alerte = on && opts.alerte && opts.alerte.includes(v);
        const label = opts.labels ? opts.labels[i] : v;
        return `<button type="button" class="chip${opts.small ? " small" : ""}${on ? " on" : ""}${alerte ? " alerte" : ""}"
          data-${opts.attr || "set"}="${field}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
      }).join("")}
    </div>`;
  const checkRow = (field, on, text, sub) => `
    <button type="button" class="check${on ? " on" : ""}" data-check="${field}" role="checkbox" aria-checked="${!!on}">
      <span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="txt"><b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    </button>`;
  const numInput = (attr, field, val, unit, placeholder, mode = "decimal") => `
    <div class="num">
      <input data-${attr}="${field}" inputmode="${mode}" autocomplete="off" enterkeyhint="done"
        value="${esc(val ?? "")}" placeholder="${esc(placeholder ?? "")}" aria-label="${field}">
      ${unit ? `<span class="unit">${unit}</span>` : ""}
    </div>`;
  const numField = (field, val, unit, placeholder, mode) => numInput("num", field, val, unit, placeholder, mode);

  /* ---------- écrans ---------- */
  function viewGate() {
    return `
      <section class="gate">
        <img src="icons/icon-192-v2.png" alt="">
        <h1>Ton suivi <em>Phénix</em></h1>
        <p>${S.error ? esc(S.error) : "Ouvre l'appli avec le lien personnel que Nathan t'a envoyé."}</p>
        <div class="card" style="text-align:left">
          <div class="label">Ou saisis ton code</div>
          <div class="num"><input id="gate-code" autocapitalize="characters" placeholder="Ex : K7PM2Q" aria-label="Code"></div>
          <button class="btn2" data-act="gate">Valider</button>
        </div>
      </section>`;
  }

  const viewLoading = () => `<section class="card empty">Chargement de ton suivi…</section>`;

  // Formulaire de départ (semaine 1), affiché à la première ouverture
  function viewOnboarding() {
    if (!S.ob) S.ob = { step: 1, d: { prenom: S.cliente.prenom || "", sexe: "femme" } };
    const d = S.ob.d;
    if (S.ob.step === 1) {
      return `
        <section class="gate" style="padding-top:6px">
          <img src="icons/icon-192-v2.png" alt="" style="width:88px;height:88px">
          <h1>Bienvenue dans <em>Phénix</em></h1>
          <p>Avant de commencer, remplis ton <b>formulaire de départ</b>. Il sert à calculer ton métabolisme de base et à calibrer ton programme dès la semaine 2.</p>
        </section>
        <section class="card">
          <div class="eyebrow">Formulaire de départ · 1/2</div>
          <h2>Tes données personnelles</h2>
          <p class="lead">Réponds du mieux que tu peux : il n'y a pas de bonne ou mauvaise réponse, juste tes données réelles.</p>
          <div class="field">
            <div class="label">Prénom</div>
            <div class="num"><input data-ob="prenom" autocomplete="given-name" value="${esc(d.prenom)}" aria-label="Prénom"></div>
          </div>
          <div class="field">
            <div class="label">Sexe biologique <small>pour le calcul du métabolisme</small></div>
            ${chips("sexe", ["femme", "homme"], d.sexe, { attr: "obset", labels: ["Femme", "Homme"], small: true })}
          </div>
          <div class="field">
            <div class="label">Âge</div>
            ${numInput("ob", "age", d.age, "ans", "Ex : 52", "numeric")}
          </div>
          <div class="field">
            <div class="label">Taille</div>
            ${numInput("ob", "taille", d.taille, "cm", "Ex : 165", "numeric")}
          </div>
          <div class="field">
            <div class="label">Poids actuel <small>le matin, à jeun, après les toilettes</small></div>
            ${numInput("ob", "poids", d.poids, "kg", "Ex : 72,4")}
          </div>
          <button class="save" style="position:static;margin-top:14px" data-act="ob-next">Continuer</button>
        </section>`;
    }
    return `
      <section class="card">
        <div class="eyebrow">Formulaire de départ · 2/2</div>
        <h2>Ton objectif</h2>
        <div class="field">
          <div class="label">Poids cible <small>facultatif</small></div>
          <div class="hint">Si tu ne sais pas encore, laisse vide.</div>
          ${numInput("ob", "poidsCible", d.poidsCible, "kg", "Ex : 65")}
        </div>
        <div class="field">
          <div class="label">Ce que tu veux vraiment changer</div>
          <div class="hint">Au-delà du poids. Ex : avoir plus d'énergie, ne plus culpabiliser après un repas, me sentir bien dans mes vêtements…</div>
          <textarea data-ob="motivation" rows="4" aria-label="Ce que tu veux vraiment changer">${esc(d.motivation || "")}</textarea>
        </div>
        <div class="note">Tes <b>moyennes de pas et de calories</b> se rempliront à la fin de ta semaine d'observation : l'appli te les demandera dans 7 jours.</div>
        <button class="save" style="position:static;margin-top:14px" data-act="ob-finish">Commencer mon suivi</button>
        <button class="btn2" data-act="ob-back">Retour</button>
      </section>`;
  }

  // valeurs proposées dans la carte « fin de semaine 1 » : la moyenne de pas est calculée
  // à partir des pas notés chaque matin pendant la semaine d'observation
  function s1Defauts() {
    const f = S.cliente.formDate;
    const pm = f ? pasMoyen(addDays(f, 7)) : null;
    return {
      moyPasS1: has(S.cliente.moyPasS1) ? inputVal(S.cliente.moyPasS1) : pm ? String(pm.moy) : "",
      moyKcalS1: inputVal(S.cliente.moyKcalS1)
    };
  }

  function pasMoyenTexte(day, d) {
    const v = toNum(d.pasJour);
    const m = pasMoyen(day, v === "" || Number.isNaN(v) ? null : v);
    return m ? `<b style="font-size:20px">${fr(m.moy, 0)} pas</b> par jour · sur ${m.n} jour${m.n > 1 ? "s" : ""} noté${m.n > 1 ? "s" : ""}`
      : "Note tes pas chaque matin : la moyenne se calculera toute seule.";
  }

  function cardSemaine1() {
    const f = S.cliente.formDate;
    if (!f) return "";
    const j = diffDays(today(), f);
    if (j < 7) {
      return `<div class="note" style="margin-bottom:14px"><b>Semaine d'observation · jour ${j + 1}/7.</b>
        Tu ne changes rien : photographie tout ce que tu manges dans SnapCalorie, et note ici chaque matin ton poids et tes pas d'hier.</div>`;
    }
    if (has(S.cliente.moyPasS1) && has(S.cliente.moyKcalS1)) return "";
    const pmS1 = pasMoyen(addDays(f, 7));
    const s1 = Object.assign(s1Defauts(), S.drafts.__s1 || {});
    return `
      <section class="card week">
        <div class="eyebrow">Formulaire de départ · fin de semaine 1</div>
        <h2>Tes moyennes de la semaine d'observation</h2>
        <div class="field">
          <div class="label">Moyenne de pas par jour</div>
          <div class="hint">${pmS1 ? `Calculée à partir de tes pas notés (${pmS1.n} jour${pmS1.n > 1 ? "s" : ""}). Corrige-la si besoin.` : "Appli Santé → Activité → Pas, sur les 7 jours d'observation."}</div>
          ${numInput("s1", "moyPasS1", s1.moyPasS1, "pas", "Ex : 6 240", "numeric")}
        </div>
        <div class="field">
          <div class="label">Moyenne de calories par jour</div>
          <div class="hint">SnapCalorie → Charts → ligne « Daily Average ».</div>
          ${numInput("s1", "moyKcalS1", s1.moyKcalS1, "kcal", "Ex : 1 780", "numeric")}
        </div>
        <button class="save" style="position:static;margin-top:10px" data-act="save-s1">Envoyer mes moyennes</button>
      </section>`;
  }

  function viewJour() {
    const day = S.day;
    const d = draftFor(day);
    const t = today();
    const off = diffDays(t, day);
    const title = off === 0 ? "Aujourd'hui" : off === 1 ? "Hier" : `Il y a ${off} jours`;
    const lastW = lastBefore("poids", day);
    const pal = lastBefore("palier", day); // palier en vigueur hier
    const palDays = pal ? diffDays(day, pal.date) : null;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const showInstall = !LECTURE && !standalone && !store.get("phenix:install-dismissed") && off === 0;

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
          <div class="label">Pas · moyenne de la semaine <small>calculée toute seule</small></div>
          <div class="hint" id="pas-moy" style="margin-bottom:0">${pasMoyenTexte(day, d)}</div>
        </div>
        <div class="field">
          <div class="label">Calories · moyenne de la semaine</div>
          <div class="hint">SnapCalorie → Charts → ligne « Daily Average »</div>
          ${numField("kcal", d.kcal, "kcal", "Ex : 1 750", "numeric")}
        </div>
        <div class="field">
          <div class="label">Protéines · moyenne de la semaine <small>dès le module macros</small></div>
          ${numField("prot", d.prot, "g", has(S.cliente.cibleProt) ? `Cible : ${fr(S.cliente.cibleProt, 0)} g` : "Ex : 110", "numeric")}
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
      ${off === 0 ? cardSemaine1() : ""}
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
          <div class="label">Pas d'hier <small>appli Santé</small></div>
          ${numField("pasJour", d.pasJour, "pas", lastBefore("pasJour", day) ? fr(lastBefore("pasJour", day).value, 0).replace(/\s/g, " ") : "Ex : 8 200", "numeric")}
          ${hasPalierBefore(day) ? `<div class="hint" style="margin:6px 0 0">Objectif : <b>${fr(objectifPas(), 0)} pas minimum</b></div>` : ""}
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

        ${hasPalierBefore(day) ? `
        <div class="field">
          <div class="label">Hier…</div>
          ${checkRow("palOk", d.palOk, "J'ai respecté mon palier calorique", `${fr(pal.value, 0)} kcal · ni beaucoup moins, ni beaucoup plus`)}
        </div>` : ""}

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

  // Graphique des pas : 28 derniers jours (chaque saisie du matin = les pas de la veille)
  function pasCard() {
    const t = today(), obj = objectifPas(), jours = 28;
    const pts = [];
    for (let i = jours; i >= 1; i--) {
      const jourPas = addDays(t, -i);
      const e = S.entries[addDays(jourPas, 1)];
      pts.push({ d: jourPas, v: e && typeof e.pasJour === "number" ? e.pasJour : null });
    }
    const vals = pts.filter((p) => p.v !== null);
    if (!vals.length) return `<section class="card"><h2>Mes pas</h2><p class="lead">Ton graphique apparaîtra dès que tu noteras tes pas d'hier chaque matin.</p></section>`;
    const W = 340, H = 190, P = { l: 38, r: 8, t: 12, b: 24 };
    const max = Math.max(obj * 1.15, ...vals.map((p) => p.v));
    const top = Math.ceil(max / 2000) * 2000;
    const bw = (W - P.l - P.r) / jours;
    const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
    // moyenne glissante sur 7 jours, seulement là où il y a des données
    const moy7 = pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 6), i + 1).filter((q) => q.v !== null);
      return p.v === null || !w.length ? null : w.reduce((s, q) => s + q.v, 0) / w.length;
    });
    let path = "";
    moy7.forEach((m, i) => { if (m !== null) path += `${path && moy7[i - 1] !== null ? "L" : "M"}${(P.l + bw * i + bw / 2).toFixed(1)},${y(m).toFixed(1)}`; });
    const atteints = vals.filter((p) => p.v >= obj).length;
    const m7 = pasMoyen(t);
    const ticks = [0, top / 2, top];
    return `
      <section class="card chart">
        <h2>Mes pas</h2>
        <p class="lead">${m7 ? `Moyenne des 7 derniers jours : <b>${fr(m7.moy, 0)} pas</b>. ` : ""}Objectif atteint ${atteints} jour${atteints > 1 ? "s" : ""} sur ${vals.length}.</p>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Graphique des pas">
          ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EAF2EC"/>
            <text x="${P.l - 5}" y="${y(v) + 4}" font-size="10" fill="#4A5E51" text-anchor="end">${fr(v / 1000)}k</text>`).join("")}
          ${pts.map((p, i) => p.v === null ? "" : `<rect x="${(P.l + bw * i + 1.5).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y(0) - y(p.v)).toFixed(1)}" rx="2.5" fill="${p.v >= obj ? "#82A38B" : "#FF9B85"}"><title>${shortDate(p.d)} : ${fr(p.v, 0)} pas</title></rect>`).join("")}
          <line x1="${P.l}" x2="${W - P.r}" y1="${y(obj)}" y2="${y(obj)}" stroke="#D8483D" stroke-width="1.5" stroke-dasharray="5 4"/>
          <path d="${path}" fill="none" stroke="#18301F" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".8"/>
          <text x="${P.l}" y="${H - 6}" font-size="10" fill="#4A5E51">${shortDate(pts[0].d)}</text>
          <text x="${W - P.r}" y="${H - 6}" font-size="10" fill="#4A5E51" text-anchor="end">hier</text>
        </svg>
        <div class="legend">
          <span><i style="background:#82A38B"></i>Objectif atteint</span>
          <span><i style="background:#FF9B85"></i>En dessous</span>
          <span><i style="background:none;border-top:2px dashed #D8483D;height:0"></i>Objectif ${fr(obj, 0)}</span>
          <span><i style="background:#18301F;opacity:.8"></i>Moyenne 7 j</span>
        </div>
      </section>`;
  }

  function viewProgres() {
    const series = weightSeries();
    const motivation = S.cliente.motivation ? `<section class="card"><div class="eyebrow">Ce que je veux vraiment changer</div>
      <p style="margin:6px 0 0;font:400 20px/1.35 var(--serif);font-style:italic">« ${esc(S.cliente.motivation)} »</p></section>` : "";
    if (!series.length) return `<section class="card empty">Ta courbe apparaîtra après tes premières pesées.<br>Note ton poids chaque matin dans « Ma journée ».</section>${pasCard()}${motivation}`;
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
    const pasOk = last7("pasOk"), palOk = last7("palOk");
    const moy = (a) => (a.length ? fr(a.reduce((s, v) => s + v, 0) / a.length) : "—");
    const pm = pasMoyen(t);
    const pasHebdo = lastBefore("pas", t, true);
    const pas = pm ? { value: pm.moy } : pasHebdo;
    const pal = lastBefore("palier", t, true);
    const tailles = dates().filter((d) => typeof S.entries[d].taille === "number").map((d) => S.entries[d].taille);
    const obj = objectifPas();

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

      ${pasCard()}

      <section class="card">
        <h2>Mes 7 derniers jours</h2>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><b>${ccs.reduce((s, v) => s + v, 0)}<small style="font-size:15px">/21</small></b><span>cohérences cardiaques</span></div>
          <div class="tile"><b>${moy(som)}</b><span>sommeil moyen /5</span></div>
          <div class="tile"><b>${moy(frm)}</b><span>forme moyenne /5</span></div>
        </div>
        ${pasOk.length || palOk.length ? `<div class="tiles" style="margin-top:8px;grid-template-columns:1fr 1fr">
          <div class="tile"><b>${pasOk.filter((v) => v === 1).length}<small style="font-size:15px">/${pasOk.length}</small></b><span>jours objectif de pas atteint</span></div>
          <div class="tile"><b>${palOk.filter((v) => v === 1).length}<small style="font-size:15px">/${palOk.length}</small></b><span>jours palier respecté</span></div>
        </div>` : ""}
        ${pal ? `<div class="note">Palier actuel : <b>${fr(pal.value, 0)} kcal</b>${has(S.cliente.maintKcal) ? ` · maintenance optimisée : ${fr(S.cliente.maintKcal, 0)} kcal` : ""}</div>` : ""}
        ${pas ? `<div class="note">Pas (moyenne ${pm ? "des 7 derniers jours" : "de la dernière semaine"}) : <b>${fr(pas.value, 0)}</b> ${pas.value >= obj ? `✓ objectif de ${fr(obj, 0)} atteint` : `· objectif : ${fr(obj, 0)} minimum`}</div>` : ""}
      </section>

      ${tailles.length ? `<section class="card">
        <h2>Tour de taille</h2>
        <p class="lead" style="margin-top:6px">${tailles.length > 1
          ? `${fr(tailles[0])} cm → <b>${fr(tailles[tailles.length - 1])} cm</b> (${tailles[tailles.length - 1] <= tailles[0] ? "−" : "+"}${fr(Math.abs(tailles[tailles.length - 1] - tailles[0]))} cm)`
          : `Première mesure : <b>${fr(tailles[0])} cm</b>`}</p>
      </section>` : ""}
      ${motivation}`;
  }

  /* ---------- Outils (calculateurs, pré-remplis avec tes données) ---------- */
  function toolsDefaults() {
    const c = S.cliente;
    const pm = pasMoyen(today());
    const pas = pm ? { value: pm.moy } : lastBefore("pas", today(), true);
    const pal = lastBefore("palier", today(), true);
    return {
      sexe: c.sexe || "femme",
      age: inputVal(c.age), taille: inputVal(c.taille),
      poids: inputVal(poidsActuel()),
      pas: inputVal(pas ? pas.value : has(c.moyPasS1) ? c.moyPasS1 : ""),
      palier: inputVal(pal ? pal.value : has(c.maintKcal) ? c.maintKcal : "")
    };
  }

  function tdeeResults() {
    const r = calcDepense(S.tools);
    if (!r) return `<div class="hint" style="margin-top:12px">Remplis âge, taille, poids et moyenne de pas pour voir ta dépense.</div>`;
    const m = toNum(S.cliente.moyKcalS1);
    let cas = "";
    if (m) {
      const tdee = Math.round(r.tdee), diff = m - tdee;
      const txt = Math.abs(diff) <= 200
        ? `<b>Cas 2</b> · tu manges déjà à peu près ton total (${fr(m, 0)} kcal en semaine 1). Mets-toi à ${fr(tdee, 0)} kcal et confirme avec la balance (règle des 72 h).`
        : diff < 0
          ? `<b>Cas 1</b> · tu manges moins que ton total (${fr(m, 0)} kcal en semaine 1). Remonte par paliers de +200 : premier palier à <b>${fr(Math.round(m / 10) * 10 + 200, 0)} kcal</b>, tiens-le 3-4 jours minimum.`
          : `<b>Cas 3</b> · tu manges plus que ton total (${fr(m, 0)} kcal en semaine 1). Descends par paliers de −200 : premier palier à <b>${fr(Math.round(m / 10) * 10 - 200, 0)} kcal</b>, tiens-le 3-4 jours minimum.`;
      cas = `<div class="note" style="margin-top:12px">${txt}</div>`;
    }
    return `
      <div class="result">
        <div class="eyebrow" style="margin-top:14px">Ta maintenance estimée (total théorique)</div>
        <div class="bignum">${fr(r.tdee, 0)} <span>kcal / jour</span></div>
        <div class="hint">Avec <b>${fr(r.pas, 0)} pas</b> par jour en moyenne : niveau <b>${r.niveau.nom.toLowerCase()}</b>. C'est une estimation : seule la balance confirme le vrai total.</div>
      </div>
      <div class="tiles" style="grid-template-columns:1fr 1fr;margin-top:10px">
        <div class="tile"><b>${fr(r.bmr, 0)}</b><span>métabolisme de base (kcal, au repos)</span></div>
        <div class="tile"><b>${fr(r.imc)}</b><span>IMC · ${imcNote(r.imc)}</span></div>
      </div>
      ${cas}
      <ul class="levels">
        ${NIVEAUX.map((n) => `<li class="${n === r.niveau ? "current" : ""}"><span><b>${n.nom}</b>${n === r.niveau ? ' <span class="demo-tag" style="margin:0">toi</span>' : ""}<small>${n.pas}</small></span><span>${fr(r.bmr * n.facteur, 0)} kcal</span></li>`).join("")}
      </ul>`;
  }

  function macroResults() {
    const r = calcMacros(S.tools);
    if (!r) return `<div class="hint" style="margin-top:12px">Remplis ton poids et ton palier pour voir tes macros.</div>`;
    const prot = Math.round(r.prot);
    const deja = Number(S.cliente.cibleProt) === prot;
    return `
      <div class="macros">
        <div class="macro m-prot"><span>Protéines</span><b>${prot} g</b></div>
        <div class="macro m-fib"><span>Fibres</span><b>${Math.round(r.fib)} g</b></div>
        <div class="macro m-lip"><span>Lipides</span><b>${Math.round(r.lip)} g</b></div>
        <div class="macro m-glu"><span>Glucides</span><b>${Math.round(r.glu)} g</b></div>
      </div>
      <div class="hint" style="margin-top:8px">Ordre de priorité : calories, puis protéines, puis fibres, puis lipides et glucides.</div>
      <button class="btn2" data-act="set-prot" data-v="${prot}" ${deja ? "disabled" : ""}>${deja ? `Cible protéines enregistrée : ${prot} g ✓` : `Utiliser ${prot} g comme cible protéines`}</button>`;
  }

  function viewOutils() {
    if (!S.tools) S.tools = toolsDefaults();
    const t = S.tools;
    return `
      <section class="card">
        <div class="eyebrow">Calculateur</div>
        <h2>Ma dépense calorique</h2>
        <p class="lead">Pré-rempli avec ton formulaire de départ et tes dernières saisies. Tu peux modifier les valeurs.</p>
        <div class="field">
          <div class="label">Sexe</div>
          ${chips("sexe", ["femme", "homme"], t.sexe, { attr: "toolset", labels: ["Femme", "Homme"], small: true })}
        </div>
        <div class="kv" style="margin-top:6px">
          <div><div class="label">Âge</div>${numInput("tool", "age", t.age, "ans", "52", "numeric")}</div>
          <div><div class="label">Taille</div>${numInput("tool", "taille", t.taille, "cm", "165", "numeric")}</div>
        </div>
        <div class="kv" style="margin-top:10px">
          <div><div class="label">Poids</div>${numInput("tool", "poids", t.poids, "kg", "70")}</div>
          <div><div class="label">Pas / jour</div>${numInput("tool", "pas", t.pas, "", "8000", "numeric")}</div>
        </div>
        <div id="res-tdee">${tdeeResults()}</div>
      </section>

      <section class="card">
        <div class="eyebrow">Calculateur</div>
        <h2>Mes macros</h2>
        <p class="lead">Ta répartition selon ton poids et ton palier calorique, à reporter dans SnapCalorie.</p>
        <div class="kv">
          <div><div class="label">Poids</div>${numInput("tool", "poids", t.poids, "kg", "70")}</div>
          <div><div class="label">Palier</div>${numInput("tool", "palier", t.palier, "kcal", "1800", "numeric")}</div>
        </div>
        <div id="res-macro">${macroResults()}</div>
      </section>

      <section class="card">
        <div class="eyebrow">Fiche de décision</div>
        <h2>La règle des 72 h</h2>
        <p class="lead">On ne bouge jamais un palier avant 3 jours d'observation.</p>
        <ul class="rules">
          <li class="r-ok"><b>Le poids baisse</b><span>Ne rien faire, laisse tourner.</span></li>
          <li><b>Le poids stagne (3-4 jours)</b><span>Ajuste ton palier de 200 kcal.</span></li>
          <li class="r-up"><b>Il monte 1 seul jour</b><span>Ne pas réagir, observe encore 2 jours.</span></li>
          <li class="r-up2"><b>Il monte 3 jours de suite</b><span>Reviens au palier précédent.</span></li>
        </ul>
        <div class="note">Mange ce que tu veux dans ta limite calorique : il n'y a pas d'aliment interdit, juste un total à respecter.</div>
      </section>`;
  }

  function viewReperes() {
    const c = S.cliente;
    const r = S.drafts.__reperes || (S.drafts.__reperes = {
      depart: inputVal(c.depart), objectifPas: inputVal(c.objectifPas), maintKcal: inputVal(c.maintKcal),
      maintPas: inputVal(c.maintPas), cibleProt: inputVal(c.cibleProt)
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const link = `${location.origin}${location.pathname}?c=${code}`;
    return `
      <section class="card">
        <div class="eyebrow">À mettre à jour quand ça change</div>
        <h2>Mes repères</h2>
        <div class="field">
          <div class="label">Poids de départ <small>formulaire de départ</small></div>
          ${numInput("rep", "depart", r.depart, "kg", "Ex : 78,4")}
        </div>
        <div class="field">
          <div class="label">Mon objectif de pas actuel</div>
          <div class="hint">Monte de 500 à 1 000 pas à la fois, jusqu'à 8 000 minimum.</div>
          ${numInput("rep", "objectifPas", r.objectifPas, "pas", "8 000", "numeric")}
        </div>
        <div class="field">
          <div class="label">Maintenance optimisée</div>
          <div class="kv">
            ${numInput("rep", "maintKcal", r.maintKcal, "kcal", "2 200", "numeric")}
            ${numInput("rep", "maintPas", r.maintPas, "pas", "8 000", "numeric")}
          </div>
        </div>
        <div class="field">
          <div class="label">Cible protéines <small>onglet Outils</small></div>
          ${numInput("rep", "cibleProt", r.cibleProt, "g", "120", "numeric")}
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
          <li><b>Chaque matin</b>, juste après ta pesée (30 s) : poids, pas d'hier, nuit, forme d'hier, cohérences cardiaques d'hier et palier respecté hier. Palier seulement s'il change.</li>
          <li><b>Le dimanche matin</b>, avant l'atelier (2 min) : tour de taille, moyennes de calories et de protéines, étape. La moyenne de pas se calcule toute seule.</li>
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
    if (!S.loaded) { nav.hidden = true; $("#view").innerHTML = viewLoading(); return; }
    if (!S.cliente.formDate && LECTURE) {
      nav.hidden = true;
      $("#view").innerHTML = `<section class="card empty">${esc(S.cliente.prenom || "Cette cliente")} n'a pas encore rempli son formulaire de départ.</section>`;
      return;
    }
    if (!S.cliente.formDate) { nav.hidden = true; $("#view").innerHTML = viewOnboarding(); return; }
    nav.hidden = false;
    const views = { progres: viewProgres, outils: viewOutils, reperes: viewReperes };
    $("#view").innerHTML = (views[S.tab] || viewJour)();
    if (LECTURE) $("#view").querySelectorAll("input, textarea").forEach((i) => { i.disabled = true; });
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  function refreshSaveButton() {
    const b = $('[data-act="save"]');
    if (!b) return;
    b.disabled = !isDirty(S.day);
    b.textContent = saveLabel(S.day);
  }

  /* ---------- actions ---------- */
  const LABELS = { poids: "le poids", palier: "le palier", taille: "le tour de taille", pas: "les pas", kcal: "les calories", prot: "les protéines" };

  function readNums(src, keys) {
    const out = {};
    for (const k of keys) {
      const n = toNum(src[k]);
      if (Number.isNaN(n) || (n !== "" && (n < PROFIL_NUM[k][0] || n > PROFIL_NUM[k][1]))) return { error: k };
      out[k] = n;
    }
    return { out };
  }

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
    const res = readNums(S.drafts.__reperes || {}, ["depart", "objectifPas", "maintKcal", "maintPas", "cibleProt"]);
    if (res.error) { toast("Vérifie tes repères"); return; }
    delete S.drafts.__reperes;
    delete S.touched.__reperes;
    S.tools = null;
    saveProfil(res.out);
    toast("Repères enregistrés ✓");
    render();
  }

  function obNext() {
    const d = S.ob.d;
    const res = readNums({ age: d.age, taille: d.taille, depart: d.poids }, ["age", "taille", "depart"]);
    if (!String(d.prenom || "").trim()) { toast("Indique ton prénom"); return; }
    if (res.error || res.out.age === "" || res.out.taille === "" || res.out.depart === "") {
      toast(res.error === "taille" ? "Taille en cm (ex : 165)" : res.error === "age" ? "Vérifie ton âge" : "Remplis âge, taille et poids");
      return;
    }
    S.ob.step = 2;
    render();
    scrollTo(0, 0);
  }

  function obFinish() {
    const d = S.ob.d;
    const nums = readNums({ age: d.age, taille: d.taille, depart: d.poids, poidsCible: d.poidsCible }, ["age", "taille", "depart", "poidsCible"]);
    if (nums.error) { toast("Vérifie le poids cible"); return; }
    if (!String(d.motivation || "").trim()) { toast("Dis-nous ce que tu veux vraiment changer"); return; }
    const t = today();
    saveProfil({ prenom: String(d.prenom).trim(), sexe: d.sexe, motivation: String(d.motivation).trim(), ...nums.out, form: true });
    // le poids du formulaire est aussi la pesée du jour
    if (!(S.entries[t] && S.entries[t].poids !== undefined)) {
      S.entries[t] = { ...(S.entries[t] || {}), poids: nums.out.depart };
      delete S.drafts[t];
      persist();
      enqueue({ kind: "save", date: t, entry: S.entries[t] });
    }
    S.ob = null;
    S.tab = "jour";
    toast(`Bienvenue ${String(d.prenom).trim()} ✓`);
    render();
    scrollTo(0, 0);
  }

  function saveS1() {
    const res = readNums(Object.assign(s1Defauts(), S.drafts.__s1 || {}), ["moyPasS1", "moyKcalS1"]);
    if (res.error || res.out.moyPasS1 === "" || res.out.moyKcalS1 === "") { toast("Remplis tes deux moyennes"); return; }
    delete S.drafts.__s1;
    S.tools = null;
    saveProfil(res.out);
    toast("Moyennes envoyées à Nathan ✓");
    render();
  }

  document.addEventListener("click", (ev) => {
    const tab = ev.target.closest("[data-tab]");
    if (tab) {
      S.tab = tab.dataset.tab;
      if (S.tab === "outils" && !S.touched.__tools) S.tools = null;
      render(); scrollTo(0, 0); return;
    }

    // en consultation, seuls les onglets et le changement de jour répondent
    if (LECTURE && !ev.target.closest('[data-act="prev"], [data-act="next"]')) return;

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
    const ob = ev.target.closest("[data-obset]");
    if (ob) { S.ob.d[ob.dataset.obset] = ob.dataset.v; render(); return; }
    const ts = ev.target.closest("[data-toolset]");
    if (ts) { S.tools[ts.dataset.toolset] = ts.dataset.v; S.touched.__tools = true; render(); return; }

    const chk = ev.target.closest("[data-check]");
    if (chk) {
      const d = draftFor(S.day);
      d[chk.dataset.check] = !d[chk.dataset.check];
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
    if (a === "save-s1") saveS1();
    if (a === "ob-next") obNext();
    if (a === "ob-back") { S.ob.step = 1; render(); }
    if (a === "ob-finish") obFinish();
    if (a === "set-prot") { saveProfil({ cibleProt: Number(act.dataset.v) }); toast("Cible protéines enregistrée ✓"); $("#res-macro").innerHTML = macroResults(); }
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
    if (el.dataset.num) {
      draftFor(S.day)[el.dataset.num] = el.value;
      S.touched[S.day] = true;
      refreshSaveButton();
      if (el.dataset.num === "pasJour" && $("#pas-moy")) $("#pas-moy").innerHTML = pasMoyenTexte(S.day, draftFor(S.day));
    }
    if (el.dataset.rep) { (S.drafts.__reperes ||= {})[el.dataset.rep] = el.value; S.touched.__reperes = true; }
    if (el.dataset.s1) { (S.drafts.__s1 ||= {})[el.dataset.s1] = el.value; }
    if (el.dataset.ob) { S.ob.d[el.dataset.ob] = el.value; }
    if (el.dataset.tool) {
      const k = el.dataset.tool;
      S.tools[k] = el.value;
      S.touched.__tools = true;
      // le poids apparaît dans les deux calculateurs : on garde les deux champs identiques
      document.querySelectorAll(`[data-tool="${k}"]`).forEach((o) => { if (o !== el) o.value = el.value; });
      $("#res-tdee").innerHTML = tdeeResults();
      $("#res-macro").innerHTML = macroResults();
    }
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
