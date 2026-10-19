// DARK MIND — daily discovery job. Zero dependencies (Node 18+).
// Uses ONLY the official YouTube Data API v3. Never touches video files.
// Quota: search.list = 100 units, videos.list = 1 unit per call (up to 50 ids). Default free quota = 10,000/day.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://www.googleapis.com/youtube/v3";

export const parseDuration = (iso = "") => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};

const count = (s, re) => (s.match(re) || []).length;
// Language: trusts API metadata first; falls back to script analysis of title+description.
export const detectLanguage = (snippet = {}) => {
  const audio = (snippet.defaultAudioLanguage || "").toLowerCase();
  const meta = (snippet.defaultLanguage || "").toLowerCase();
  const text = `${snippet.title || ""} ${(snippet.description || "").slice(0, 300)}`;
  const arabicScript = count(text, /[\u0600-\u06FF]/g);
  const persianOnly = count(text, /[پچژگ]/g);
  const latin = count(text, /[A-Za-z]/g);
  const total = arabicScript + latin || 1;
  if (audio.startsWith("fa")) return { lang: "fa", confidence: "metadata" };
  if (audio.startsWith("en")) return { lang: "en", confidence: "metadata" };
  if (arabicScript / total > 0.5) {
    if (persianOnly > 0 || meta.startsWith("fa")) return { lang: "fa", confidence: "text" };
    if (!meta.startsWith("ar")) return { lang: "fa", confidence: "text" };
    return { lang: "other", confidence: "text" };
  }
  if (meta.startsWith("fa")) return { lang: "fa", confidence: "metadata" };
  if (latin / total > 0.85 && (meta.startsWith("en") || meta === "")) return { lang: "en", confidence: "text" };
  return { lang: "unknown", confidence: "none" };
};

const norm = (s) => (s || "").toLowerCase().replace(/[\u200c\u200f\u200e]/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const fingerprint = (v) => `${norm(v.title)}|${norm(v.channel)}`;

export class QuotaError extends Error {}

async function api(endpoint, params, key, stats, { retries = 3 } = {}) {
  const url = `${API}/${endpoint}?${new URLSearchParams({ ...params, key })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) { stats.units += endpoint === "search" ? 100 : 1; return res.json(); }
      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason || "";
      if (res.status === 403 && /quota/i.test(reason)) throw new QuotaError("YouTube API daily quota exceeded");
      if (res.status >= 500 || res.status === 429) throw new Error(`Temporary API error ${res.status}`);
      throw Object.assign(new Error(`API ${res.status}: ${body?.error?.message || reason}`), { fatal: true });
    } catch (e) {
      if (e instanceof QuotaError || e.fatal || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, (process.env.SYNC_NO_DELAY ? 0 : 1500) * attempt));
    }
  }
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function toRecord(item, query, now) {
  const { snippet = {}, contentDetails = {}, statistics = {}, status = {} } = item;
  const duration = parseDuration(contentDetails.duration);
  const { lang, confidence } = detectLanguage(snippet);
  const th = snippet.thumbnails || {};
  return {
    id: item.id,
    title: snippet.title || "",
    channel: snippet.channelTitle || "",
    channelId: snippet.channelId || "",
    thumb: (th.medium || th.high || th.default || {}).url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    thumbHigh: (th.maxres || th.standard || th.high || th.medium || {}).url || "",
    duration,
    publishedAt: snippet.publishedAt || null,
    description: (snippet.description || "").slice(0, 400),
    lang, langConfidence: confidence,
    views: statistics.viewCount !== undefined ? +statistics.viewCount : null,
    likes: statistics.likeCount !== undefined ? +statistics.likeCount : null,
    embeddable: status.embeddable !== false,
    categories: [query.category],
    queryIds: [query.id],
    url: `https://www.youtube.com/watch?v=${item.id}`,
    source: "youtube",
    addedAt: now, lastSeen: now, lastChecked: now, unavailable: false,
  };
}

export function qualifies(rec, item, settings) {
  if (item.status && (item.status.privacyStatus && item.status.privacyStatus !== "public")) return false;
  if (!rec.embeddable) return false;
  if (rec.duration < settings.minDurationSec || rec.duration > settings.maxDurationSec) return false;
  if (rec.lang === "other") return false;
  return true;
}

export async function sync({ key, config, store, now = new Date().toISOString() }) {
  const stats = { units: 0 };
  const s = config.settings;
  const queries = config.queries.filter((q) => q.enabled);
  const meta = store.meta;
  const errors = [];
  const byId = new Map(store.videos.map((v) => [v.id, v]));
  const prints = new Map(store.videos.map((v) => [fingerprint(v), v.id]));
  let added = 0, merged = 0, dropped = 0, skippedDup = 0, rechecked = 0, markedUnavailable = 0;

  // rotate through queries so each run stays within quota
  const n = Math.min(s.maxQueriesPerRun, queries.length);
  const start = queries.length ? (meta.queryCursor || 0) % queries.length : 0;
  const batch = Array.from({ length: n }, (_, i) => queries[(start + i) % queries.length]);
  const after = new Date(Date.parse(now) - s.searchWindowDays * 864e5).toISOString();

  let quotaHit = false;
  for (const q of batch) {
    if (quotaHit) break;
    try {
      const search = await api("search", {
        part: "snippet", type: "video", q: q.q, maxResults: s.resultsPerQuery,
        videoDuration: "short", videoEmbeddable: "true", safeSearch: "moderate",
        relevanceLanguage: q.lang, order: "relevance", publishedAfter: after,
      }, key, stats);
      const ids = [...new Set((search.items || []).map((i) => i.id?.videoId).filter(Boolean))];
      for (const group of chunk(ids, 50)) {
        const det = await api("videos", { part: "snippet,contentDetails,statistics,status", id: group.join(",") }, key, stats);
        for (const item of det.items || []) {
          const rec = toRecord(item, q, now);
          if (!qualifies(rec, item, s)) { dropped++; continue; }
          const existing = byId.get(rec.id);
          if (existing) {
            existing.lastSeen = now; existing.lastChecked = now; existing.unavailable = false;
            existing.views = rec.views ?? existing.views; existing.likes = rec.likes ?? existing.likes;
            existing.categories = [...new Set([...existing.categories, ...rec.categories])];
            existing.queryIds = [...new Set([...existing.queryIds, q.id])];
            merged++; continue;
          }
          const fp = fingerprint(rec);
          if (prints.has(fp)) { skippedDup++; continue; }
          byId.set(rec.id, rec); prints.set(fp, rec.id); added++;
        }
      }
    } catch (e) {
      errors.push(`${q.id} "${q.q}": ${e.message}`);
      if (e instanceof QuotaError) quotaHit = true;
    }
  }

  // availability re-check of older records (1 unit per 50 videos)
  try {
    const cutoff = Date.parse(now) - s.recheckAfterDays * 864e5;
    const stale = [...byId.values()].filter((v) => !v.lastChecked || Date.parse(v.lastChecked) < cutoff).slice(0, 200);
    for (const group of chunk(stale.map((v) => v.id), 50)) {
      const det = await api("videos", { part: "status,statistics", id: group.join(",") }, key, stats);
      const alive = new Map((det.items || []).map((i) => [i.id, i]));
      for (const id of group) {
        const v = byId.get(id), item = alive.get(id);
        rechecked++;
        const ok = item && item.status?.privacyStatus === "public" && item.status?.embeddable !== false;
        if (!ok && !v.unavailable) markedUnavailable++;
        v.unavailable = !ok; v.lastChecked = now;
        if (item?.statistics?.viewCount !== undefined) v.views = +item.statistics.viewCount;
      }
    }
  } catch (e) { errors.push(`recheck: ${e.message}`); }

  const all = [...byId.values()]
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen) || Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .slice(0, s.maxVideos);

  const gotAnyData = stats.units > 0;
  const cleanRun = errors.length === 0;
  const entry = { at: now, ok: cleanRun, partial: !cleanRun && gotAnyData, added, merged, filteredOut: dropped, duplicatesSkipped: skippedDup, rechecked, markedUnavailable, queriesRun: batch.length, quotaUnits: stats.units, errors: errors.slice(0, 5) };
  return {
    videos: all,
    meta: {
      ...meta,
      lastRun: now,
      lastSuccess: cleanRun ? now : meta.lastSuccess,
      queryCursor: (start + n) % Math.max(queries.length, 1),
      quotaUnitsLastRun: stats.units,
      runs: [entry, ...(meta.runs || [])].slice(0, 30),
    },
    entry,
  };
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(v, null, 1));

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  const config = readJson("config/queries.json");
  const meta = readJson("data/meta.json", { runs: [] });
  const videos = readJson("data/videos.json", { videos: [] }).videos;
  const now = new Date().toISOString();
  if (!key) {
    meta.lastRun = now;
    meta.runs = [{ at: now, ok: false, errors: ["YOUTUBE_API_KEY is not set"] }, ...(meta.runs || [])].slice(0, 30);
    writeJson("data/meta.json", meta);
    console.error("YOUTUBE_API_KEY is not set. Existing data left untouched.");
    process.exit(1);
  }
  const out = await sync({ key, config, store: { videos, meta }, now });
  writeJson("data/videos.json", { videos: out.videos, updatedAt: now });
  writeJson("data/meta.json", out.meta);
  console.log(JSON.stringify(out.entry, null, 2));
  // Exit non-zero only if nothing worked at all, so the workflow flags real outages.
  if (!out.entry.ok && !out.entry.partial) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
