import { STR, QUOTES, CATS } from "./i18n.js";

/* ---------- state (localStorage only; no accounts, no cross-device sync) ---------- */
const KEY = "darkmind:v1";
const DEF = { uiLang: "fa", videoLang: "both", maxDur: 300, topics: [], favorites: [], later: [], history: [], hidden: [] };
const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEF }; } };
let S = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const t = (k) => STR[S.uiLang][k] ?? STR.en[k] ?? k;
const fa = () => S.uiLang === "fa";

let DATA = { videos: [], updatedAt: null }, META = null, loadErr = false, loaded = false;
const byId = () => new Map(DATA.videos.map((v) => [v.id, v]));

/* ---------- helpers ---------- */
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => new Intl.NumberFormat(fa() ? "fa-IR" : "en-US").format(n);
const compact = (n) => new Intl.NumberFormat(fa() ? "fa-IR" : "en-US", { notation: "compact" }).format(n);
const fmtDur = (s) => { const m = Math.floor(s / 60), r = s % 60; return `${num(m)}:${fa() ? new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2 }).format(r) : String(r).padStart(2, "0")}`; };
const fmtDate = (iso) => iso ? new Intl.DateTimeFormat(fa() ? "fa-IR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";
const fmtDay = (iso) => iso ? new Intl.DateTimeFormat(fa() ? "fa-IR" : "en-US", { dateStyle: "medium" }).format(new Date(iso)) : "";
const norm = (s = "") => s.toLowerCase().replace(/[\u200c\u200f\u200e]/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const toast = (msg) => { const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 1800); };
const langName = (l) => l === "fa" ? t("lang_fa_s") : l === "en" ? t("lang_en_s") : t("lang_unknown");

const I = {
  heart: '<svg class="fillable" viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.8 8 3.6 5 6.7 5c2 0 3.5 1.1 5.3 3 1.8-1.9 3.3-3 5.3-3 3.1 0 4.9 3 3.9 6.1-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  hide: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.2A9.7 9.7 0 0112 5c5 0 8.5 4 9.5 7a13 13 0 01-2.6 4M6.3 6.4A13 13 0 002.5 12c1 3 4.5 7 9.5 7 1.5 0 2.800-.3 4-.9"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/></svg>',
  disc: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  saved: '<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>',
  hist: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.400M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.400 15a1.700 1.700 0 00.3 1.800l.1.100a2 2 0 11-2.800 2.800l-.1-.1a1.700 1.700 0 00-1.800-.3 1.700 1.700 0 00-1 1.500V21a2 2 0 11-4 0v-.1a1.700 1.700 0 00-1.100-1.500 1.700 1.700 0 00-1.800.3l-.1.100a2 2 0 11-2.800-2.800l.1-.1a1.700 1.700 0 00.3-1.800 1.700 1.700 0 00-1.500-1H3a2 2 0 110-4h.1a1.700 1.700 0 001.500-1.100 1.700 1.700 0 00-.3-1.800l-.1-.1a2 2 0 112.800-2.800l.1.100a1.700 1.700 0 001.800.3H9a1.700 1.700 0 001-1.500V3a2 2 0 114 0v.1a1.700 1.700 0 001 1.500 1.700 1.700 0 001.800-.3l.1-.1a2 2 0 112.800 2.800l-.1.100a1.700 1.700 0 00-.3 1.800V9a1.700 1.700 0 001.500 1H21a2 2 0 110 4h-.1a1.700 1.700 0 00-1.500 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
};

/* ---------- selection + ranking ---------- */
const langOk = (v, pref) => pref === "all" || (pref === "both" ? v.lang === "fa" || v.lang === "en" : v.lang === pref);
const playable = (v) => !v.unavailable && v.embeddable !== false;
const base = (pref = S.videoLang) => DATA.videos.filter((v) => playable(v) && !S.hidden.includes(v.id) && v.duration <= S.maxDur && langOk(v, pref));

function score(v, q = "") {
  const ageDays = v.publishedAt ? Math.max(0, (Date.now() - Date.parse(v.publishedAt)) / 864e5) : 90;
  const fresh = Math.exp(-ageDays / 45);
  const dur = v.duration <= 60 ? 1 : v.duration <= 180 ? 0.8 : 0.5;
  const eng = v.views ? Math.min(1, Math.log10(v.views + 1) / 7) : 0.3;
  const topic = S.topics.length ? (v.categories || []).filter((c) => S.topics.includes(c)).length > 0 ? 1 : 0 : 0.5;
  const seen = S.history.some((h) => h.id === v.id) ? -0.6 : 0;
  const langBoost = (S.videoLang === "both" || v.lang === S.videoLang) ? 0.1 : 0;
  let rel = 0;
  if (q) {
    const toks = norm(q).split(" ").filter(Boolean);
    const T = norm(v.title), C = norm(v.channel), D = norm(v.description || ""), K = (v.categories || []).map((c) => norm(STR.fa["cat_" + c] + " " + STR.en["cat_" + c])).join(" ");
    for (const k of toks) rel += (T.includes(k) ? 3 : 0) + (C.includes(k) ? 2 : 0) + (K.includes(k) ? 1.5 : 0) + (D.includes(k) ? 1 : 0);
    rel = rel / (toks.length * 3 || 1);
  }
  return rel * 2 + dur * 0.8 + fresh * 0.8 + eng * 0.4 + topic * 0.5 + seen + langBoost;
}
const ranked = (list, q) => [...list].sort((a, b) => score(b, q) - score(a, q));
// topic diversity: round-robin across primary categories
function diversify(list, n) {
  const buckets = new Map();
  for (const v of list) { const c = (v.categories || ["x"])[0]; if (!buckets.has(c)) buckets.set(c, []); buckets.get(c).push(v); }
  const out = []; let more = true;
  while (out.length < n && more) { more = false; for (const b of buckets.values()) if (b.length && out.length < n) { out.push(b.shift()); more = true; } }
  return out;
}

/* ---------- components ---------- */
const card = (v) => {
  const fav = S.favorites.includes(v.id), later = S.later.includes(v.id);
  return `<article class="card">
  <a class="thumb" href="#/watch/${v.id}" aria-label="${esc(v.title)}"><img src="${esc(v.thumb)}" alt="" loading="lazy" decoding="async" width="320" height="180"><span class="lang-tag">${langName(v.lang)}</span><span class="badge">${fmtDur(v.duration)}</span></a>
  <div class="cbody"><h3 dir="auto"><a href="#/watch/${v.id}">${esc(v.title)}</a></h3><p dir="auto">${esc(v.channel)}</p></div>
  <div class="acts">
   <button class="ic" data-act="fav" data-id="${v.id}" aria-pressed="${fav}" aria-label="${t(fav ? "fav_remove" : "fav_add")}" title="${t(fav ? "fav_remove" : "fav_add")}">${I.heart}</button>
   <button class="ic" data-act="later" data-id="${v.id}" aria-pressed="${later}" aria-label="${t(later ? "later_remove" : "later_add")}" title="${t(later ? "later_remove" : "later_add")}">${I.clock}</button>
   <button class="ic" data-act="hide" data-id="${v.id}" aria-pressed="false" aria-label="${t("hide")}" title="${t("hide")}">${I.hide}</button>
  </div></article>`;
};
const rowOf = (title, list, link) => list.length ? `<section class="block"><div class="sec-h"><h2>${title}</h2>${link ? `<a href="${link}">${t("see_all")}</a>` : ""}</div><div class="row">${list.map(card).join("")}</div></section>` : "";
const emptyAll = () => `<div class="empty"><h2>${t("empty_all_title")}</h2><p>${t("empty_all_body")}</p></div>`;

function staleLine() {
  if (!META) return "";
  const when = META.lastSuccess ? fmtDate(META.lastSuccess) : t("st_never");
  return `<p class="stale">${t("stale")} <bdi>${when}</bdi></p>`;
}

/* ---------- views ---------- */
function home() {
  if (loadErr) return errorView();
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  const q = QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];
  const pool = ranked(base());
  const hero = `<section class="hero"><h1>${t("hero_title")}</h1><p>${t("hero_sub")}</p><span class="rule"></span>
   <form class="searchbar" data-form="search" role="search"><input type="search" name="q" placeholder="${t("search_ph")}" aria-label="${t("search_ph")}" enterkeyhint="search"><button class="btn" type="submit">${t("start")}</button></form></section>
   <div class="quote"><q dir="auto">${esc(fa() ? q.fa : q.en)}</q>${fa() ? `<div class="en" dir="ltr">${esc(q.en)}</div>` : ""}<small>${esc(q.by[S.uiLang])} · ${t("quote_title")}${fa() ? " · " + t("quote_note") : ""}</small></div>`;
  if (!DATA.videos.length) return hero + staleLine() + emptyAll();
  const f = pool[0];
  const featured = f ? `<section class="block"><div class="sec-h"><h2>${t("sec_featured")}</h2></div><a class="feature" href="#/watch/${f.id}"><img src="${esc(f.thumbHigh || f.thumb)}" alt="" decoding="async"><span class="scrim"></span><span class="meta"><h3 dir="auto">${esc(f.title)}</h3><p dir="auto">${esc(f.channel)} · ${fmtDur(f.duration)}</p></span></a></section>` : "";
  const cats = `<section class="block"><div class="sec-h"><h2>${t("sec_cats")}</h2></div><div class="cats">${CATS.map((c) => `<a class="cat" href="#/discover?cat=${c}">${t("cat_" + c)}</a>`).join("")}</div></section>`;
  const rest = pool.filter((v) => v.id !== f?.id);
  const rec = diversify(rest.filter((v) => !S.topics.length || (v.categories || []).some((c) => S.topics.includes(c))), 10);
  const newest = [...base()].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).slice(0, 10);
  const short = ranked(base().filter((v) => v.duration <= 60)).slice(0, 12);
  const fav = ranked(base("fa")).slice(0, 12), en = ranked(base("en")).slice(0, 12);
  return hero + staleLine() + featured + rowOf(t("sec_short"), short, "#/discover?dur=u1") + cats + rowOf(t("sec_rec"), rec) + rowOf(t("sec_new"), newest, "#/discover?sort=added") + rowOf(t("sec_fa"), fav, "#/discover?lang=fa") + rowOf(t("sec_en"), en, "#/discover?lang=en");
}

let DF = null; // discover filters
function parseQS(h) { const i = h.indexOf("?"); return new URLSearchParams(i < 0 ? "" : h.slice(i + 1)); }
function discover(qs) {
  if (loadErr) return errorView();
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  DF = { q: qs.get("q") || "", lang: qs.get("lang") || S.videoLang, dur: qs.get("dur") || "any", cat: qs.get("cat") || "", sort: qs.get("sort") || "rel" };
  const sel = (id, label, opts, val) => `<div><label class="fl" for="${id}">${label}</label><select id="${id}" data-filter="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
  const chip = (k, v, label, on) => `<button class="chip" data-chip="${k}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
  const chips = [chip("dur", "u1", t("dur_u1"), DF.dur === "u1"), chip("dur", "1_3", t("dur_1_3"), DF.dur === "1_3"), chip("lang", "fa", t("lang_fa"), DF.lang === "fa"), chip("lang", "en", t("lang_en"), DF.lang === "en"),
    chip("cat", "philosophy", t("cat_philosophy"), DF.cat === "philosophy"), chip("cat", "dark", t("cat_dark"), DF.cat === "dark"), chip("cat", "discipline", t("cat_discipline"), DF.cat === "discipline"), chip("sort", "new", t("q_fresh"), DF.sort === "new")].join("");
  const body = `<div class="page-h"><h1>${t("nav_discover")}</h1></div>
  <form class="searchbar" data-form="search" role="search" style="padding:0 16px;max-width:1100px;margin:0 auto 10px"><input type="search" name="q" value="${esc(DF.q)}" placeholder="${t("search_ph")}" aria-label="${t("search_ph")}" enterkeyhint="search"><button class="btn" type="submit">${I.disc.replace("<svg", '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"')}</button></form>
  <div class="chips" role="group">${chips}</div>
  <div class="filters"><div class="sel">${sel("lang", t("f_lang"), [["both", t("lang_both")], ["fa", t("lang_fa")], ["en", t("lang_en")], ["all", t("lang_all")]], DF.lang)}${sel("dur", t("f_dur"), [["any", t("dur_any")], ["u1", t("dur_u1")], ["1_3", t("dur_1_3")], ["3_5", t("dur_3_5")]], DF.dur)}</div>
  <div class="sel">${sel("cat", t("f_cat"), [["", t("dur_any")], ...CATS.map((c) => [c, t("cat_" + c)])], DF.cat)}${sel("sort", t("f_sort"), [["rel", t("sort_rel")], ["new", t("sort_new")], ["added", t("sec_recent")], ["pop", t("sort_pop")], ["short", t("sort_short")]], DF.sort)}</div></div>`;
  if (!DATA.videos.length) return body + emptyAll();
  let list = base(DF.lang);
  if (DF.dur === "u1") list = list.filter((v) => v.duration <= 60);
  else if (DF.dur === "1_3") list = list.filter((v) => v.duration > 60 && v.duration <= 180);
  else if (DF.dur === "3_5") list = list.filter((v) => v.duration > 180 && v.duration <= 300);
  if (DF.cat) list = list.filter((v) => (v.categories || []).includes(DF.cat));
  if (DF.q) { const toks = norm(DF.q).split(" ").filter(Boolean); list = list.filter((v) => { const h = norm(`${v.title} ${v.channel} ${v.description || ""} ${(v.categories || []).map((c) => STR.fa["cat_" + c] + " " + STR.en["cat_" + c]).join(" ")}`); return toks.every((k) => h.includes(k)); }); }
  const sorters = { rel: (a, b) => score(b, DF.q) - score(a, DF.q), new: (a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0), added: (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt), pop: (a, b) => (b.views || 0) - (a.views || 0), short: (a, b) => a.duration - b.duration };
  list.sort(sorters[DF.sort] || sorters.rel);
  if (!list.length) return body + `<div class="empty"><h2>${t("empty_filter_title")}</h2><p>${t("empty_filter_body")}</p></div>`;
  return body + `<div class="grid">${list.slice(0, 60).map(card).join("")}</div>`;
}

function watch(id) {
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  const v = byId().get(id);
  if (!v) return `<div class="empty"><h2>${t("unavailable")}</h2><p><a class="btn ghost sm" href="#/">${t("back")}</a></p></div>`;
  const fav = S.favorites.includes(v.id), later = S.later.includes(v.id);
  const rel = ranked(base("all").filter((x) => x.id !== v.id && (x.categories || []).some((c) => (v.categories || []).includes(c)))).slice(0, 10);
  const unavail = v.unavailable ? `<p class="stale bad">${t("unavailable")}</p>` : "";
  return `<div class="player" id="player" data-id="${v.id}"><img src="${esc(v.thumbHigh || v.thumb)}" alt=""><button class="play" data-act="play" aria-label="Play">${`<span>${I.play}</span>`}</button></div>
  <div class="winfo"><h1 dir="auto">${esc(v.title)}</h1>
   <div class="facts"><span dir="auto">${esc(v.channel)}</span><span>${t("detected_lang")}: ${langName(v.lang)}</span><span>${fmtDur(v.duration)}</span>${v.views != null ? `<span>${compact(v.views)} ${t("views")}</span>` : ""}${v.publishedAt ? `<span>${t("published")}: ${fmtDay(v.publishedAt)}</span>` : ""}<span>${t("source")}: ${t("yt")}</span></div>${unavail}
   <div class="btns" style="margin-top:12px">
    <button class="btn ghost sm" data-act="fav" data-id="${v.id}" aria-pressed="${fav}">${fav ? t("fav_remove") : t("fav_add")}</button>
    <button class="btn ghost sm" data-act="later" data-id="${v.id}" aria-pressed="${later}">${later ? t("later_remove") : t("later_add")}</button>
    <a class="btn ghost sm" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${t("open_yt")}</a>
    <button class="btn ghost sm" data-act="share" data-id="${v.id}">${t("share")}</button>
    <button class="btn ghost sm" data-act="hide-watch" data-id="${v.id}">${t("hide")}</button></div>
   ${v.description ? `<p class="desc" dir="auto">${esc(v.description)}</p>` : ""}
   ${v.lang === "en" && fa() ? `<p class="stale" style="margin:12px 0 0;color:var(--muted)">${t("no_subs")}</p>` : ""}
   <p class="stale" style="margin:8px 0 0;color:var(--muted)">${t("embed_fail")}</p></div>
  ${rowOf(t("related"), rel)}`;
}

function saved(tab = "fav") {
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  const map = byId();
  const keys = { fav: S.favorites, later: S.later, hidden: S.hidden };
  const ids = keys[tab] || [];
  const list = ids.map((i) => map.get(i)).filter(Boolean);
  const tabs = ["fav", "later", "hidden"].map((k) => `<button class="chip" data-tab="${k}" aria-pressed="${k === tab}">${t("tab_" + k)}</button>`).join("");
  const emp = { fav: "empty_fav", later: "empty_later", hidden: "empty_hidden" }[tab];
  let body = list.length ? `<div class="grid">${list.map(tab === "hidden" ? (v) => `<article class="card"><div class="thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"></div><div class="cbody"><h3 dir="auto">${esc(v.title)}</h3></div><div class="acts"><button class="btn ghost sm" data-act="unhide" data-id="${v.id}" style="margin:0 8px 8px">${t("unhide")}</button></div></article>` : card).join("")}</div>` : `<div class="empty"><p>${t(emp)}</p></div>`;
  return `<div class="page-h"><h1>${t("nav_favorites")}</h1></div><div class="chips">${tabs}</div>${body}`;
}

function history() {
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  const map = byId();
  const items = S.history.map((h) => ({ h, v: map.get(h.id) })).filter((x) => x.v);
  return `<div class="page-h"><h1>${t("history_title")}</h1>${items.length ? `<button class="btn ghost sm" data-act="clear-history">${t("clear_history")}</button>` : ""}</div>` +
    (items.length ? `<div class="grid">${items.map(({ v }) => card(v)).join("")}</div>` : `<div class="empty"><p>${t("empty_hist")}</p></div>`);
}

function settings() {
  const seg = (k, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="chip" data-set="${k}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join("")}</div>`;
  return `<div class="page-h"><h1>${t("settings_title")}</h1></div>
  <div class="panel"><h2>${t("s_ui_lang")}</h2>${seg("uiLang", [["fa", "فارسی"], ["en", "English"]], S.uiLang)}</div>
  <div class="panel"><h2>${t("s_video_lang")}</h2>${seg("videoLang", [["both", t("lang_both")], ["fa", t("lang_fa")], ["en", t("lang_en")]], S.videoLang)}</div>
  <div class="panel"><h2>${t("s_max")}</h2>${seg("maxDur", [[60, t("min1")], [180, t("min3")], [300, t("min5")], [600, t("min10")], [1200, t("min20")]], S.maxDur)}<p class="note">${t("s_long_note")}</p></div>
  <div class="panel"><h2>${t("s_topics")}</h2><div class="seg">${CATS.map((c) => `<button class="chip" data-topic="${c}" aria-pressed="${S.topics.includes(c)}">${t("cat_" + c)}</button>`).join("")}</div></div>
  <div class="panel"><h2>${t("s_data")}</h2><p class="note" style="margin:0 0 12px">${t("s_data_note")}</p><div class="btns"><button class="btn ghost sm" data-act="export">${t("s_export")}</button><label class="btn ghost sm" style="cursor:pointer">${t("s_import")}<input type="file" accept="application/json" data-act="import" hidden></label><button class="btn ghost sm danger" data-act="reset">${t("s_reset")}</button></div></div>
  <div class="panel"><p class="note" style="margin:0">${t("install_tip")}</p></div>`;
}

function status() {
  if (!loaded) return `<p class="empty">${t("loading")}</p>`;
  const vs = DATA.videos, m = META || {};
  const cnt = (f) => num(vs.filter(f).length);
  const runs = (m.runs || []).slice(0, 8).map((r) => `<div class="log"><b class="${r.ok ? "ok" : r.partial ? "warn" : "bad"}">${r.ok ? t("ok") : r.partial ? t("partial") : t("failed")}</b> <span class="mono">${esc(fmtDate(r.at))}</span>${r.added != null ? `<br>${t("added")}: ${num(r.added)} · ${t("filtered")}: ${num(r.filteredOut)} · ${t("dup")}: ${num(r.duplicatesSkipped)}` : ""}${(r.errors || []).map((e) => `<br><span class="bad mono" dir="ltr">${esc(e)}</span>`).join("")}</div>`).join("");
  return `<div class="page-h"><h1>${t("status_title")}</h1></div>
  <div class="panel"><div class="stats"><div class="stat"><b>${num(vs.length)}</b><span>${t("st_total")}</span></div><div class="stat"><b>${cnt((v) => v.lang === "fa")}</b><span>${t("st_fa")}</span></div><div class="stat"><b>${cnt((v) => v.lang === "en")}</b><span>${t("st_en")}</span></div><div class="stat"><b>${cnt((v) => v.unavailable)}</b><span>${t("st_unavail")}</span></div></div></div>
  <div class="panel"><p>${t("st_last")}: <b class="mono">${m.lastSuccess ? esc(fmtDate(m.lastSuccess)) : t("st_never")}</b></p><p>${t("st_lastrun")}: <b class="mono">${m.lastRun ? esc(fmtDate(m.lastRun)) : t("st_never")}</b></p><p>${t("st_quota")}: <b>${num(m.quotaUnitsLastRun || 0)}</b></p><p class="note">${t("st_note")}</p></div>
  <div class="panel"><h2>${t("st_runs")}</h2>${runs || `<p class="note">${t("st_never")}</p>`}</div>`;
}

const errorView = () => `<div class="empty"><h2>${t("load_error")}</h2><p><button class="btn sm" data-act="reload">${t("retry")}</button></p></div>`;

/* ---------- chrome ---------- */
function chrome(route) {
  document.documentElement.lang = S.uiLang; document.documentElement.dir = fa() ? "rtl" : "ltr";
  document.title = fa() ? "DARK MIND | ویدیوهای انگیزشی کوتاه فارسی و انگلیسی" : "DARK MIND | Short motivational videos in Persian and English";
  document.getElementById("top").innerHTML = `<a class="logo" href="#/" aria-label="DARK MIND">DARK<i></i>MIND</a><button class="chip-lang" data-act="toggle-lang" aria-label="${t("s_ui_lang")}">${fa() ? "English" : "فارسی"}</button>`;
  const items = [["home", "nav_home", I.home, "#/"], ["discover", "nav_discover", I.disc, "#/discover"], ["saved", "nav_favorites", I.saved, "#/saved"], ["history", "nav_history", I.hist, "#/history"], ["settings", "nav_settings", I.gear, "#/settings"]];
  document.getElementById("tabs").innerHTML = items.map(([k, l, ic, h]) => `<a href="${h}" ${route === k ? 'aria-current="page"' : ""}>${ic}<span>${t(l)}</span></a>`).join("");
  document.getElementById("foot").innerHTML = `<nav><a href="#/about">${t("footer_about")}</a><a href="#/privacy">${t("footer_privacy")}</a><a href="#/status">${t("footer_status")}</a></nav><div>© DARK MIND · ${t("source")}: ${t("yt")}</div>`;
}
const textPage = (title, body) => `<div class="page-h"><h1>${title}</h1></div><div class="panel"><p>${body}</p></div>`;

let route = "home";
function render() {
  const h = location.hash || "#/";
  const path = h.replace(/^#/, "").split("?")[0];
  const qs = parseQS(h);
  let html;
  const seg = path.split("/").filter(Boolean);
  if (!seg.length) { route = "home"; html = home(); }
  else if (seg[0] === "discover") { route = "discover"; html = discover(qs); }
  else if (seg[0] === "watch") { route = "discover"; html = watch(seg[1]); }
  else if (seg[0] === "saved") { route = "saved"; html = saved(qs.get("tab") || "fav"); }
  else if (seg[0] === "history") { route = "history"; html = history(); }
  else if (seg[0] === "settings") { route = "settings"; html = settings(); }
  else if (seg[0] === "status") { route = ""; html = status(); }
  else if (seg[0] === "about") { route = ""; html = textPage(t("footer_about"), t("about_text")); }
  else if (seg[0] === "privacy") { route = ""; html = textPage(t("footer_privacy"), t("privacy_text")); }
  else { route = "home"; html = home(); }
  chrome(route);
  const main = document.getElementById("main");
  main.innerHTML = html;
  if (render.last !== h) window.scrollTo(0, 0);
  render.last = h;
  if (seg[0] === "watch" && loaded && byId().has(seg[1])) pushHistory(seg[1]);
}
function pushHistory(id) {
  if (S.history[0]?.id === id) return;
  S.history = [{ id, at: new Date().toISOString() }, ...S.history.filter((h) => h.id !== id)].slice(0, 200); save();
}

/* ---------- events ---------- */
const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [id, ...arr]);
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act],[data-chip],[data-set],[data-topic],[data-tab]");
  if (!el) return;
  const { act, id } = el.dataset;
  if (el.dataset.chip) { const k = el.dataset.chip, v = el.dataset.v; const p = new URLSearchParams(location.hash.split("?")[1] || ""); p.get(k) === v ? p.delete(k) : p.set(k, v); location.hash = "#/discover?" + p.toString(); return; }
  if (el.dataset.tab) { location.hash = "#/saved?tab=" + el.dataset.tab; return; }
  if (el.dataset.set) { S[el.dataset.set] = el.dataset.set === "maxDur" ? +el.dataset.v : el.dataset.v; save(); render(); return; }
  if (el.dataset.topic) { S.topics = toggle(S.topics, el.dataset.topic); save(); render(); return; }
  if (act === "fav") { S.favorites = toggle(S.favorites, id); save(); render(); return; }
  if (act === "later") { S.later = toggle(S.later, id); save(); render(); return; }
  if (act === "hide") { S.hidden = toggle(S.hidden, id); save(); render(); return; }
  if (act === "hide-watch") { S.hidden = [id, ...S.hidden.filter((x) => x !== id)]; save(); history.length > 1 ? history.back() : (location.hash = "#/"); return; }
  if (act === "unhide") { S.hidden = S.hidden.filter((x) => x !== id); save(); render(); return; }
  if (act === "toggle-lang") { S.uiLang = fa() ? "en" : "fa"; save(); render(); return; }
  if (act === "clear-history") { S.history = []; save(); render(); toast(t("cleared")); return; }
  if (act === "reload") { boot(); return; }
  if (act === "play") { const p = document.getElementById("player"); p.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(p.dataset.id)}?autoplay=1&playsinline=1&rel=0&hl=${S.uiLang}" title="video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`; return; }
  if (act === "share") { const url = location.href; if (navigator.share) navigator.share({ url, title: byId().get(id)?.title }).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => toast(t("copied"))); return; }
  if (act === "export") { const b = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "darkmind-backup.json"; a.click(); URL.revokeObjectURL(a.href); return; }
  if (act === "reset") { if (confirm(t("s_reset_ask"))) { S = { ...DEF, uiLang: S.uiLang }; save(); render(); } return; }
});
document.addEventListener("change", (e) => {
  const f = e.target.dataset.filter;
  if (f) { const p = new URLSearchParams(location.hash.split("?")[1] || ""); e.target.value ? p.set(f, e.target.value) : p.delete(f); location.hash = "#/discover?" + p.toString(); return; }
  if (e.target.dataset.act === "import") {
    const file = e.target.files[0]; if (!file) return;
    file.text().then((txt) => { try { const j = JSON.parse(txt); S = { ...DEF, ...Object.fromEntries(Object.entries(j).filter(([k]) => k in DEF)) }; save(); render(); } catch { toast("JSON ✗"); } });
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.dataset.form === "search") { e.preventDefault(); const q = new FormData(e.target).get("q").trim(); const p = new URLSearchParams(location.hash.includes("/discover") ? location.hash.split("?")[1] || "" : ""); q ? p.set("q", q) : p.delete("q"); location.hash = "#/discover?" + p.toString(); }
});
addEventListener("hashchange", render);

/* ---------- boot ---------- */
async function boot() {
  loaded = false; loadErr = false; render();
  try {
    const [v, m] = await Promise.all([fetch("data/videos.json", { cache: "no-cache" }), fetch("data/meta.json", { cache: "no-cache" })]);
    if (!v.ok) throw new Error("videos " + v.status);
    DATA = await v.json(); META = m.ok ? await m.json() : null; loaded = true;
  } catch { loadErr = true; loaded = true; }
  render();
}
boot();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
