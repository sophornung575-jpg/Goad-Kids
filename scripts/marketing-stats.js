// scripts/marketing-stats.js — runs in GitHub Actions once a day.
// Reads the post links staff saved in the Marketing tool (marketingDesk/day-YYYY-MM-DD → made[]),
// finds each post on the two Goat Kids Pages, pulls its results from Meta (views/reach, reactions,
// comments, shares) and, if the post was boosted, the ad results from the UNG ad account.
// Writes everything to marketingDesk/postStats, which the Marketing tool shows under each post.
//
// Secrets (GitHub → Settings → Secrets and variables → Actions):
//   META_TOKEN                 System user token (livedeskbot): ads_read, read_insights, pages_read_engagement
//   FIREBASE_SERVICE_ACCOUNT   Service account JSON (already used by the Hosting deploy). Needs Firestore write access.
// Read-only on Meta: this script never posts, spends or changes ads.

const admin = require('firebase-admin');

const GRAPH = 'https://graph.facebook.com/' + (process.env.GRAPH_VERSION || 'v23.0');
const TOKEN = process.env.META_TOKEN;
const AD_ACCOUNT = 'act_150298993775632';               // UNG
const PAGES = [
  { id: '510441822722202', name: 'Goat Kids' },
  { id: '1178775641976170', name: 'Goat Kids 271' }
];
const COL = 'marketingDesk';
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 30);   // posts saved in the last N days keep updating
const TZ_OFFSET_H = 7;                                   // Phnom Penh

// ---------- small helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function dayKeyOf(date){ const d = new Date(date.getTime() + TZ_OFFSET_H * 3600e3); return d.toISOString().slice(0, 10); }
function addDays(key, n){ const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Same hash as the Marketing page uses to look up a link's results.
function linkKey(link){
  let h = 0x811c9dc5; const s = String(link || '').trim();
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'p' + h.toString(36);
}
function normUrl(u){
  try {
    const x = new URL(String(u).trim());
    x.hostname = x.hostname.replace(/^(m|mbasic|web|www)\./, '');
    const keep = ['story_fbid', 'id', 'fbid', 'v'];
    const q = [...x.searchParams].filter(([k]) => keep.includes(k)).map(([k, v]) => k + '=' + v).sort().join('&');
    return (x.hostname + x.pathname.replace(/\/+$/, '') + (q ? '?' + q : '')).toLowerCase();
  } catch (e) { return String(u || '').trim().toLowerCase(); }
}
// Every id-like piece of a link: numeric ids and pfbid tokens.
function idsInUrl(u){
  const out = new Set(); let x;
  try { x = new URL(String(u).trim()); } catch (e) { return out; }
  ['story_fbid', 'fbid', 'v'].forEach(k => { const v = x.searchParams.get(k); if (v) out.add(v.toLowerCase()); });
  x.pathname.split('/').forEach(seg => { if (/^\d{8,}$/.test(seg) || /^pfbid/i.test(seg)) out.add(seg.toLowerCase()); });
  return out;
}

async function graph(path, params = {}, token = TOKEN){
  const url = new URL(path.startsWith('http') ? path : GRAPH + '/' + path.replace(/^\//, ''));
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  for (let attempt = 0; attempt < 3; attempt++){
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const code = j.error && j.error.code;
    if ([4, 17, 32, 613].includes(code) && attempt < 2){ await sleep(5000 * (attempt + 1)); continue; }   // rate limit
    const err = new Error((j.error && j.error.message) || ('HTTP ' + r.status)); err.code = code; throw err;
  }
}
async function graphAll(path, params, token){
  const out = []; let j = await graph(path, params, token);
  for (let pages = 0; j && pages < 20; pages++){
    (j.data || []).forEach(x => out.push(x));
    if (!j.paging || !j.paging.next) break;
    j = await graph(j.paging.next, {}, token);
  }
  return out;
}

// Short "share" links (facebook.com/share/..., fb.watch) only show the real post after a redirect.
async function expandShareLink(link){
  if (!/facebook\.com\/share\/|fb\.watch\//i.test(link)) return link;
  try {
    const r = await fetch(link, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' } });
    if (r.url && !/login|checkpoint/i.test(r.url)) return r.url;
  } catch (e) {}
  return link;
}

// ---------- Firestore ----------
function initFirebase(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  return admin.firestore();
}
async function savedPosts(db){
  const today = dayKeyOf(new Date()), out = [];
  for (let i = 0; i <= LOOKBACK_DAYS; i++){
    const k = addDays(today, -i);
    const s = await db.collection(COL).doc('day-' + k).get();
    if (!s.exists) continue;
    (s.data().made || []).forEach(m => { if (m && m.link) out.push({ day: k, link: String(m.link).trim(), type: m.type || 'post', product: m.product || '', at: Number(m.at) || 0, caption: m.caption || '' }); });
  }
  const seen = new Set();
  return out.filter(p => !seen.has(p.link) && seen.add(p.link));
}

// ---------- Pages: build an index of recent posts so saved links can be matched ----------
async function pageToken(page){
  try { const j = await graph(page.id, { fields: 'access_token' }); if (j.access_token) return j.access_token; } catch (e) {
    console.warn(`  ${page.name}: no Page token (${e.message}) — trying with the system user token.`);
  }
  return TOKEN;
}
async function indexPage(page, sinceUnix){
  const tok = await pageToken(page);
  page.token = tok;
  const items = [];
  try {
    const posts = await graphAll(page.id + '/posts', { fields: 'id,permalink_url,created_time,message', since: String(sinceUnix), limit: '100' }, tok);
    posts.forEach(p => items.push({ postId: p.id, permalink: p.permalink_url, created: p.created_time, message: p.message || '' }));
  } catch (e) { console.warn(`  ${page.name}: could not list posts — ${e.message}`); }
  try {
    const reels = await graphAll(page.id + '/video_reels', { fields: 'id,post_id,permalink_url,created_time,description', since: String(sinceUnix), limit: '100' }, tok);
    reels.forEach(r => items.push({ postId: r.post_id || (page.id + '_' + r.id), videoId: r.id, permalink: r.permalink_url && (r.permalink_url.startsWith('http') ? r.permalink_url : 'https://www.facebook.com' + r.permalink_url), created: r.created_time, message: r.description || '', reel: true }));
  } catch (e) { console.warn(`  ${page.name}: could not list reels — ${e.message}`); }
  console.log(`  ${page.name}: ${items.length} recent posts/reels found.`);
  return items.map(it => Object.assign(it, { page }));
}
function buildIndex(items){
  const byUrl = new Map(), byId = new Map();
  items.forEach(it => {
    if (it.permalink){ byUrl.set(normUrl(it.permalink), it); idsInUrl(it.permalink).forEach(id => byId.set(id, it)); }
    const tail = String(it.postId).split('_').pop(); byId.set(tail.toLowerCase(), it);
    if (it.videoId) byId.set(String(it.videoId).toLowerCase(), it);
  });
  return { byUrl, byId };
}
function matchLink(index, link){
  const hit = index.byUrl.get(normUrl(link)); if (hit) return hit;
  for (const id of idsInUrl(link)){ const h = index.byId.get(id); if (h) return h; }
  return null;
}
// Backup when the link itself can't be read (share links open only for logged-in people):
// 1) the caption written in the Marketing tool appears in the post text, or
// 2) exactly one post/reel was published in the 3 hours before the link was saved.
const squash = t => String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
function matchByCaptionOrTime(items, p, used){
  const free = items.filter(it => !used.has(it.postId));
  const cap = squash(p.caption).slice(0, 40);
  if (cap.length >= 12){
    const hits = free.filter(it => squash(it.message).includes(cap));
    if (hits.length === 1) return { it: hits[0], how: 'caption' };
  }
  if (p.at){
    const near = free.filter(it => { const c = Date.parse(it.created); return c <= p.at + 10 * 60e3 && c >= p.at - 3 * 3600e3; })
      .filter(it => (p.type === 'video') === !!it.reel || !items.some(x => x.reel));
    if (near.length === 1) return { it: near[0], how: 'time' };
  }
  return null;
}

// ---------- results for one post ----------
async function insightValue(objId, edge, metrics, token){
  // Meta keeps renaming these (impressions → views in Nov 2025), so try each name and keep what works.
  for (const m of metrics){
    try {
      const j = await graph(objId + '/' + edge, { metric: m }, token);
      const v = j.data && j.data[0] && j.data[0].values && j.data[0].values[0] && j.data[0].values[0].value;
      if (typeof v === 'number') return { metric: m, value: v };
    } catch (e) { /* metric not available for this post/version — try the next */ }
  }
  return null;
}
async function postResults(it){
  const tok = it.page.token || TOKEN, out = {};
  try {
    const j = await graph(it.postId, { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares' }, tok);
    out.reactions = (j.reactions && j.reactions.summary && j.reactions.summary.total_count) || 0;
    out.comments = (j.comments && j.comments.summary && j.comments.summary.total_count) || 0;
    out.shares = (j.shares && j.shares.count) || 0;
  } catch (e) { out.errEngagement = e.message; }
  const views = await insightValue(it.postId, 'insights', ['post_media_view', 'post_total_media_view'], tok)
    || (it.videoId && await insightValue(it.videoId, 'video_insights', ['blue_reels_play_count', 'fb_reels_total_plays'], tok));
  if (views) out.views = views.value;
  const reach = await insightValue(it.postId, 'insights', ['post_total_media_view_unique', 'post_impressions_unique'], tok)
    || (it.videoId && await insightValue(it.videoId, 'video_insights', ['post_impressions_unique'], tok));
  if (reach) out.reach = reach.value;
  return out;
}

// ---------- ads: which posts were boosted, and their results ----------
async function adResultsByPost(sinceKey){
  const until = dayKeyOf(new Date());
  const rows = await graphAll(AD_ACCOUNT + '/insights', {
    level: 'ad', fields: 'ad_id,spend,reach,impressions', time_range: { since: sinceKey, until }, limit: '500'
  });
  const byAd = new Map(rows.map(r => [r.ad_id, r]));
  const ids = [...byAd.keys()], byPost = new Map();
  for (const adId of ids){
    let a;
    try { a = await graph(adId, { fields: 'creative{effective_object_story_id,object_story_id}' }); } catch (e) { console.warn(`  Ad ${adId}: ${e.message}`); continue; }
    {
      const story = a.creative && (a.creative.effective_object_story_id || a.creative.object_story_id);
      if (!story) continue;
      const r = byAd.get(adId), cur = byPost.get(story) || { adSpend: 0, adReach: 0, adImpressions: 0, ads: 0 };
      cur.adSpend += Number(r.spend) || 0; cur.adReach += Number(r.reach) || 0; cur.adImpressions += Number(r.impressions) || 0; cur.ads++;
      byPost.set(story, cur);
    }
  }
  byPost.forEach(v => { v.adSpend = Math.round(v.adSpend * 100) / 100; });
  console.log(`  Ads: ${rows.length} ad(s) with results, linked to ${byPost.size} post(s).`);
  return byPost;
}

// ---------- main ----------
(async () => {
  if (!TOKEN) throw new Error('META_TOKEN secret is missing.');
  const db = initFirebase();
  // Whole ad account, yesterday (all ads, not only boosted posts) — shown in "Review yesterday's results".
  const yKey = addDays(dayKeyOf(new Date()), -1), daily = {};
  try {
    const j = await graph(AD_ACCOUNT + '/insights', { fields: 'spend,reach,impressions', time_range: { since: yKey, until: yKey } });
    const r = (j.data && j.data[0]) || {};
    daily[yKey] = { adSpend: Math.round((Number(r.spend) || 0) * 100) / 100, adReach: Number(r.reach) || 0, adImpressions: Number(r.impressions) || 0, updatedAt: Date.now() };
    console.log(`  All ads on ${yKey}: $${daily[yKey].adSpend} spend, ${daily[yKey].adReach} reach.`);
  } catch (e) { console.warn('  All ads yesterday: ' + e.message); }
  if (Object.keys(daily).length) await db.collection(COL).doc('postStats').set({ daily }, { merge: true });

  const posts = await savedPosts(db);
  console.log(`Saved post links in the last ${LOOKBACK_DAYS} days: ${posts.length}`);
  if (!posts.length) return;

  const oldestKey = posts.reduce((a, p) => p.day < a ? p.day : a, dayKeyOf(new Date()));
  const sinceKey = addDays(oldestKey, -3);
  const sinceUnix = Math.floor(new Date(sinceKey + 'T00:00:00Z').getTime() / 1000);

  let items = [];
  for (const page of PAGES) items = items.concat(await indexPage(page, sinceUnix));
  const index = buildIndex(items);

  let ads = new Map(), adsErr = '';
  try { ads = await adResultsByPost(sinceKey); } catch (e) { adsErr = e.message; console.warn('  Ads: ' + e.message); }

  const results = {}; let found = 0; const used = new Set();
  for (const p of posts){
    const link = await expandShareLink(p.link);
    let it = matchLink(index, link), how = 'link';
    if (!it){ const m = matchByCaptionOrTime(items, p, used); if (m){ it = m.it; how = m.how; } }
    console.log(`  ${p.day} ${p.link} → ${it ? it.page.name + ' ' + it.postId + ' (by ' + how + ')' : 'NOT FOUND'}`);
    if (it) used.add(it.postId);
    const rec = { link: p.link, day: p.day, updatedAt: Date.now() };
    if (!it){
      rec.status = 'notFound';
      rec.note = 'Post not found on the Goat Kids Pages. Use the post\'s own link (… → Copy link), not a share link.';
    } else {
      found++;
      Object.assign(rec, { status: 'ok', postId: it.postId, page: it.page.name, matchedBy: how }, await postResults(it));
      const ad = ads.get(it.postId);
      if (ad) Object.assign(rec, ad, { boosted: true });
    }
    results[linkKey(p.link)] = rec;
  }

  await db.collection(COL).doc('postStats').set({
    updatedAt: Date.now(), posts: results, lastRun: { checked: posts.length, found, adsErr }
  }, { merge: true });
  console.log(`Done: ${found}/${posts.length} posts matched and saved to ${COL}/postStats.`);
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
