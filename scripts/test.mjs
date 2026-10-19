// Run: node scripts/test.mjs
// Uses a MOCKED YouTube API purely to test logic. These fixtures are never written to data/.
import assert from "node:assert/strict";
import { sync, parseDuration, detectLanguage, fingerprint } from "./sync.mjs";
process.env.SYNC_NO_DELAY = "1";

const cfg = (extra = {}) => ({
  settings: { minDurationSec: 15, maxDurationSec: 300, searchWindowDays: 45, maxQueriesPerRun: 5, resultsPerQuery: 25, maxVideos: 100, recheckAfterDays: 7, ...extra },
  queries: [
    { id: "fa-1", q: "کلیپ انگیزشی کوتاه", lang: "fa", category: "growth", enabled: true },
    { id: "en-1", q: "dark motivation", lang: "en", category: "dark", enabled: true },
    { id: "en-off", q: "disabled", lang: "en", category: "dark", enabled: false },
  ],
});
const vid = (id, o = {}) => ({
  id,
  snippet: { title: o.title || `Title ${id}`, channelTitle: o.channel || "Ch", channelId: "c", publishedAt: "2026-10-01T00:00:00Z", description: o.desc || "", defaultAudioLanguage: o.audio, thumbnails: { medium: { url: "https://i.ytimg.com/x.jpg" } } },
  contentDetails: { duration: o.dur || "PT45S" },
  statistics: { viewCount: "1000" },
  status: { privacyStatus: o.privacy || "public", embeddable: o.embeddable ?? true },
});

function mockFetch(handler) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const r = handler(u.pathname.split("/").pop(), u.searchParams);
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
  };
}
const NOW = "2026-10-19T06:00:00Z";
let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log("ok -", name); };

await t("parseDuration", () => {
  assert.equal(parseDuration("PT45S"), 45); assert.equal(parseDuration("PT1M30S"), 90);
  assert.equal(parseDuration("PT1H"), 3600); assert.equal(parseDuration("P0D"), 0);
});

await t("language detection: metadata first, then script; translated titles are not Persian", () => {
  assert.equal(detectLanguage({ title: "Discipline", defaultAudioLanguage: "en" }).lang, "en");
  assert.equal(detectLanguage({ title: "انضباط شخصی چیه؟" }).lang, "fa");
  assert.equal(detectLanguage({ title: "Dark motivation speech" }).lang, "en");
  assert.equal(detectLanguage({ title: "Motivation (دوبله فارسی)", defaultAudioLanguage: "en" }).lang, "en");
  assert.equal(detectLanguage({ title: "x", defaultAudioLanguage: "fa" }).confidence, "metadata");
});

await t("filters by duration, embeddable, privacy; dedups by id and fingerprint; includes both languages", async () => {
  mockFetch((ep, p) => {
    if (ep === "search") return { body: { items: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id: { videoId: id } })) } };
    return { body: { items: [
      vid("a", { title: "کلیپ انگیزشی خفن", audio: "fa" }),
      vid("b", { title: "Dark Motivation", audio: "en", dur: "PT2M" }),
      vid("c", { dur: "PT10M" }),                 // too long
      vid("d", { dur: "PT5S" }),                  // too short
      vid("e", { embeddable: false }),            // not embeddable
      vid("f", { title: "Dark Motivation", audio: "en", channel: "Ch", dur: "PT2M" }), // near-duplicate of b
    ].filter((v) => p.get("id").split(",").includes(v.id)) } };
  });
  const out = await sync({ key: "k", config: cfg(), store: { videos: [], meta: {} }, now: NOW });
  const ids = out.videos.map((v) => v.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
  assert.deepEqual([...new Set(out.videos.map((v) => v.lang))].sort(), ["en", "fa"]);
  assert.equal(out.entry.queriesRun, 2); // disabled query skipped
  assert.ok(out.entry.duplicatesSkipped >= 1);
  assert.ok(out.meta.lastSuccess === NOW);
});

await t("re-running does not create duplicates and preserves addedAt", async () => {
  const store = { videos: [], meta: {} };
  mockFetch((ep) => ep === "search" ? { body: { items: [{ id: { videoId: "a" } }] } } : { body: { items: [vid("a", { audio: "en" })] } });
  const r1 = await sync({ key: "k", config: cfg(), store, now: "2026-10-18T06:00:00Z" });
  const r2 = await sync({ key: "k", config: cfg(), store: { videos: r1.videos, meta: r1.meta }, now: NOW });
  assert.equal(r2.videos.length, 1);
  assert.equal(r2.videos[0].addedAt, "2026-10-18T06:00:00Z");
  assert.equal(r2.videos[0].lastSeen, NOW);
});

await t("API failure keeps the existing collection and does not mark success", async () => {
  const existing = [{ id: "keep", title: "t", channel: "c", categories: ["dark"], queryIds: ["en-1"], lang: "en", duration: 30, addedAt: "2026-10-01T00:00:00Z", lastSeen: "2026-10-17T00:00:00Z", lastChecked: NOW, unavailable: false }];
  mockFetch(() => ({ status: 500, body: {} }));
  const out = await sync({ key: "k", config: cfg(), store: { videos: existing, meta: { lastSuccess: "2026-10-17T00:00:00Z" } }, now: NOW });
  assert.equal(out.videos.length, 1);
  assert.equal(out.meta.lastSuccess, "2026-10-17T00:00:00Z");
  assert.equal(out.entry.ok, false);
  assert.ok(out.entry.errors.length > 0);
});

await t("quota exceeded stops further searches and keeps data", async () => {
  let searches = 0;
  mockFetch((ep) => { searches++; return { status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } } }; });
  const out = await sync({ key: "k", config: cfg(), store: { videos: [], meta: {} }, now: NOW });
  assert.equal(searches, 1);
  assert.match(out.entry.errors[0], /quota/i);
});

await t("videos that disappeared are flagged unavailable, not deleted", async () => {
  const old = { id: "gone", title: "t", channel: "c", categories: ["dark"], queryIds: [], lang: "en", duration: 30, addedAt: "2026-09-01T00:00:00Z", lastSeen: "2026-09-01T00:00:00Z", lastChecked: "2026-09-01T00:00:00Z", unavailable: false };
  mockFetch((ep, p) => ep === "search" ? { body: { items: [] } } : { body: { items: [] } });
  const out = await sync({ key: "k", config: cfg(), store: { videos: [old], meta: {} }, now: NOW });
  assert.equal(out.videos.length, 1);
  assert.equal(out.videos[0].unavailable, true);
});

await t("query cursor rotates between runs", async () => {
  mockFetch(() => ({ body: { items: [] } }));
  const out = await sync({ key: "k", config: cfg({ maxQueriesPerRun: 1 }), store: { videos: [], meta: { queryCursor: 0 } }, now: NOW });
  assert.equal(out.meta.queryCursor, 1);
});

console.log(`\n${pass} tests passed`);
