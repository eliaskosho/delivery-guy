/* ============================================================
   Delivery Guy — main.js
   Plain JS, no dependencies. Everything that changes at launch
   lives in CONFIG below. Nothing else needs to be edited.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   1. CONFIG — launch data. This is the only block you edit.
   ------------------------------------------------------------
   - null = unknown. The site handles it: missing links are
     removed (never a dead "#"), stats show "—" with a reason.
   - As soon as a value is set, the matching UI switches on.
   ------------------------------------------------------------ */
const CONFIG = {
  contractAddress: "2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump",
  buyUrl:      "https://pump.fun/coin/2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump",
  dexscreener: "https://dexscreener.com/solana/2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump",
  solscan:     "https://solscan.io/token/2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump",
  telegram:    "https://t.me/deliveryguyonsol",
  x:           "https://x.com/DeliveryGuy_SOL",

  /* ---- Optional listings. null = the chip is removed, never a dead link. ---- */
  dextools: null,
  coinmarketcap: null,
  coingecko: null,

  /* ---- Holder count (optional) ------------------------------------------
     Solana's public RPC cannot give a total holder count: getTokenLargestAccounts
     returns the top accounts only. A total needs an indexer (Helius, Birdeye,
     Solscan Pro), and every one of them wants an API key.

     This site is static: it has no server and no build step, so anything put
     here is readable by anyone who opens the page. Do NOT paste a private key
     into this file. Point it at your own proxy instead — a small function that
     holds the key server-side (see .env.example) and answers with JSON.

     The URL may contain {mint}, which is replaced with contractAddress.
     The response is searched for the first of: holders, holderCount,
     holder_count, total, result — as a number or inside `data`.

     Default: '/api/holders', the serverless proxy in api/holders.js. It keeps
     the key in Vercel's environment variables and answers {"holders": n}.
     With no key configured it answers 501, and the tile removes itself.

     null = the Holders tile is removed from the panel without even asking.
  ------------------------------------------------------------------------ */
  holdersApiUrl: '/api/holders',
};

/* ------------------------------------------------------------
   2. Constants (facts about the chain and project, not launch data)
   ------------------------------------------------------------ */
const CHAIN = {
  name: 'Solana',
  explorer: 'https://solscan.io',
};
const PUMP_FUN = 'https://pump.fun';
const TRADE_FEE_PCT = 0.3;        // pump.fun's fee on every trade, in percent
const STATS_POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 9_000;
const GALLERY_DIR = 'assets/gallery/';
const BANNER_CANDIDATES = ['assets/banner.webp', 'assets/banner.jpg', 'assets/banner.png'];
const STORAGE_KEY = 'dg.stats.v3';

/* ------------------------------------------------------------
   3. Small helpers
   ------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Solana mint address: base58 (no 0, O, I or l), 32–44 characters.
const isMint = (a) => typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
// 44 characters do not fit in a chip: "2RbedkHKGC…zpump"  →  "2Rbe…zpump".
const shortMint = (a) => `${a.slice(0, 4)}…${a.slice(-5)}`;

const num = (v) => (v == null || !isFinite(Number(v)) ? 0 : Number(v));

function fmtCompact(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fmtAmount(n, unit = '') {
  if (n == null || !isFinite(n)) return '—';
  let s;
  if (n === 0) s = '0';
  else if (Math.abs(n) < 0.0001) s = n.toLocaleString('en-US', { maximumSignificantDigits: 3 });   // 0.00000131, never 1.31e-6
  else if (Math.abs(n) < 1) s = n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  else if (Math.abs(n) < 10_000) s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  else s = fmtCompact(n);
  return unit ? `${s} ${unit}` : s;
}
function fmtInt(n) { return (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US'); }
function fmtUsd(n) {
  if (n == null || !isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1000) return '$' + fmtCompact(n, 2);
  if (abs >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs === 0) return '$0';
  return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4 });   // sub-cent prices keep their digits
}
function fmtAgo(tsSec) {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}
function fmtStamp(tsSec) {
  const t = new Date(tsSec * 1000);
  const sameDay = new Date().toDateString() === t.toDateString();
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${t.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('[data-toast]');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('toast--error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older mobile browsers / non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/* ------------------------------------------------------------
   4. Launch-state UI: contract address, buy buttons, links
   ------------------------------------------------------------ */
function resolvedBuyUrl() {
  if (CONFIG.buyUrl) return CONFIG.buyUrl;
  if (isMint(CONFIG.contractAddress)) return `${PUMP_FUN}/coin/${CONFIG.contractAddress}`;
  return null;
}

function initContractAddress() {
  const ca = isMint(CONFIG.contractAddress) ? CONFIG.contractAddress : null;

  $$('[data-ca-text]').forEach((el) => {
    if (!ca) { el.textContent = 'CA revealed at launch'; return; }
    // Short in the topbar chip, full everywhere else. Copy always takes the full address.
    el.textContent = el.dataset.caText === 'short' ? shortMint(ca) : ca;
  });

  $$('[data-copy-ca]').forEach((btn) => {
    if (!ca) {
      btn.disabled = true;
      btn.title = 'Contract address is revealed at launch';
      btn.setAttribute('aria-disabled', 'true');
      return;
    }
    btn.disabled = false;
    btn.addEventListener('click', async () => {
      const ok = await copyText(ca);   // the whole 44-character mint, never the shortened form
      toast(ok ? 'Contract address copied' : 'Could not copy. Long-press the address instead.', !ok);
      if (ok) { btn.classList.add('is-copied'); setTimeout(() => btn.classList.remove('is-copied'), 1400); }
    });
  });

  $$('[data-explorer-link]').forEach((a) => {
    if (ca) { a.href = CONFIG.solscan || `${CHAIN.explorer}/token/${ca}`; a.hidden = false; }
    else if (a.dataset.explorerFallback) { a.href = a.dataset.explorerFallback; a.hidden = false; }
    else { a.hidden = true; }
  });
}

function initBuyButtons() {
  const url = resolvedBuyUrl();
  $$('[data-buy-link]').forEach((a) => { if (url) a.href = url; });   // plain links (footer): keep their fallback when unknown
  $$('[data-buy]').forEach((a) => {
    if (url) {
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.classList.remove('is-disabled'); a.removeAttribute('aria-disabled');
      return;
    }
    a.classList.add('is-disabled');
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('role', 'button');
    a.removeAttribute('href');
    a.tabIndex = -1;
  });
}

function initListingLinks() {
  const box = $('[data-listing-links]');
  let any = false;
  $$('[data-link]').forEach((a) => {
    const url = CONFIG[a.dataset.link];
    if (url) { a.href = url; any = true; } else { a.remove(); }   // hidden entirely, never a dead "#"
  });
  if (isMint(CONFIG.contractAddress)) any = true;   // the Solscan chip is shown in that case
  if (box) box.hidden = !any;
}

function initSocialLinks() {
  const map = [['https://t.me/', CONFIG.telegram], ['https://x.com/', CONFIG.x], ['https://twitter.com/', CONFIG.x]];
  $$('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    for (const [prefix, url] of map) if (url && href.startsWith(prefix)) a.href = url;
  });
}

/* ------------------------------------------------------------
   5. Generic copy buttons (the mint address in the buy steps)
   ------------------------------------------------------------ */
function initCopyButtons() {
  $$('[data-copy]').forEach((btn) => {
    const value = btn.dataset.copy === 'ca' ? CONFIG.contractAddress : btn.dataset.copy;
    if (btn.dataset.copy === 'ca') {
      const slot = $('[data-ca-inline]', btn);
      if (slot && isMint(value)) slot.textContent = value;
    }
    btn.addEventListener('click', async () => {
      const ok = await copyText(value);
      toast(ok ? 'Copied' : 'Could not copy', !ok);
      if (ok) { btn.classList.add('is-copied'); setTimeout(() => btn.classList.remove('is-copied'), 1400); }
    });
  });
}

/* ------------------------------------------------------------
   6. Live panel — data layer
   ------------------------------------------------------------
   fetchStats() returns a plain object; nulls mean "unknown".
   Each source is independent: if one fails the others still render.

   Sources:
     - DEXScreener public API   price, market cap, 24 h volume, 24 h trades.
                                CORS-open, no key, no rate-limit headaches.
     - CONFIG.holdersApiUrl     holder count, only if one is configured.

   Why nothing else: Solana's public RPC rate-limits hard and cannot count
   holders, and pump.fun's own API sits behind Cloudflare with no CORS
   headers, so a browser cannot read it. Anything this page shows has to
   come from an endpoint a browser can actually reach.

   The cashback split itself is not read here. How pump.fun's Trader Cashback
   is accounted for on-chain is not publicly documented, so the panel shows
   only what can be verified: the market. No payout tiles, no countdown.
   ------------------------------------------------------------ */

// Deepest pool wins. On the bonding curve DEXScreener reports no liquidity
// at all, so 24 h volume breaks the tie until a graduated pool exists.
function pickPair(pairs) {
  const onSolana = pairs.filter((p) => String(p.chainId || '').toLowerCase() === 'solana');
  const list = onSolana.length ? onSolana : pairs;
  return list.slice().sort((a, b) =>
    (num(b.liquidity?.usd) - num(a.liquidity?.usd)) ||
    (num(b.volume?.h24) - num(a.volume?.h24))
  )[0] || null;
}

// The two DEXScreener token endpoints answer in different shapes: the newer one
// returns a bare array of pairs, the older one an object with a `pairs` array
// (null before the first trade). Both are normalised to an array here.
const MARKET_ENDPOINTS = [
  (mint) => `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
  (mint) => `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
];
function pairsOf(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.pairs)) return j.pairs;
  return [];
}

async function readMarket(mint) {
  // The token endpoint, not the pair endpoint: the address is the mint, and a
  // mint has no pair address of its own.
  let pairs = [];
  let lastErr = null;
  for (const build of MARKET_ENDPOINTS) {
    try {
      pairs = pairsOf(await fetchJson(build(mint)));
      lastErr = null;
      if (pairs.length) break;
    } catch (err) { lastErr = err; }
  }
  if (lastErr && !pairs.length) throw lastErr;   // every endpoint failed: keep the cached values
  const best = pickPair(pairs);
  if (!best) return { listed: false };
  const tx = best.txns?.h24;
  return {
    listed: true,
    priceUsd: best.priceUsd != null ? Number(best.priceUsd) : null,
    priceSol: best.priceNative != null ? Number(best.priceNative) : null,
    quoteSymbol: best.quoteToken?.symbol || null,
    marketCapUsd: best.marketCap ?? best.fdv ?? null,
    liquidityUsd: best.liquidity?.usd ?? null,
    volume24hUsd: best.volume?.h24 != null ? Number(best.volume.h24) : null,
    buys24h: tx?.buys != null ? Number(tx.buys) : null,
    sells24h: tx?.sells != null ? Number(tx.sells) : null,
    change24h: best.priceChange?.h24 != null ? Number(best.priceChange.h24) : null,
    dexId: best.dexId || null,
  };
}

// Digs a holder count out of whatever shape the configured endpoint answers with.
function pickHolderCount(j) {
  const keys = ['holders', 'holderCount', 'holder_count', 'total', 'result'];
  const seen = [j, j?.data, j?.result, j?.data?.data];
  for (const obj of seen) {
    if (obj == null) continue;
    if (typeof obj === 'number' && isFinite(obj)) return obj;
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    }
  }
  return null;
}
// Three outcomes, and they are not the same thing:
//   { count: n }      a real number
//   { off: true }     no key configured, or no such function deployed -> drop the tile
//   throws            a transient failure -> keep whatever was last known
async function readHolders(mint) {
  const url = CONFIG.holdersApiUrl.replace('{mint}', encodeURIComponent(mint));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try { res = await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
  // 501 = the proxy is there but has no API key. 404 = no proxy deployed at all.
  if (res.status === 501 || res.status === 404) return { off: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const n = pickHolderCount(await res.json());
  return n == null ? { off: true } : { count: n };
}

async function fetchStats() {
  const mint = CONFIG.contractAddress;
  const jobs = [readMarket(mint)];
  if (CONFIG.holdersApiUrl) jobs.push(readHolders(mint));

  const settled = await Promise.allSettled(jobs);
  // Decide the holder tile first, so it is pulled even during a market outage
  // rather than sitting there as a dead card.
  const h = settled[1]?.status === 'fulfilled' ? settled[1].value : null;
  if (h && h.off) removeHoldersTile();

  // The market read IS the panel. If it fails, throw so the caller keeps the
  // last known values instead of overwriting them with a screen full of dashes.
  // A holder-count failure is survivable and only costs that one tile.
  if (settled[0].status === 'rejected') throw settled[0].reason;

  const market = settled[0].value;
  const failed = settled.filter((r) => r.status === 'rejected').length;

  return {
    updatedAt: Math.floor(Date.now() / 1000),
    partial: failed > 0,
    listed: market ? market.listed !== false : null,
    holders: h && h.count != null ? h.count : null,
    holdersOff: Boolean(h && h.off),
    priceUsd: market?.priceUsd ?? null,
    priceSol: market?.priceSol ?? null,
    quoteSymbol: market?.quoteSymbol ?? null,
    marketCapUsd: market?.marketCapUsd ?? null,
    liquidityUsd: market?.liquidityUsd ?? null,
    volume24hUsd: market?.volume24hUsd ?? null,
    buys24h: market?.buys24h ?? null,
    sells24h: market?.sells24h ?? null,
    change24h: market?.change24h ?? null,
    dexId: market?.dexId ?? null,
  };
}

/* ------------------------------------------------------------
   7. Live panel — rendering and caching
   ------------------------------------------------------------ */
const STAT_KEYS = ['price', 'marketCap', 'volume', 'trades', 'holders'];
const live = { stats: null, timer: null };

function setStat(key, value, note) {
  const v = $(`[data-stat="${key}"]`);
  const n = $(`[data-stat-note="${key}"]`);
  if (v && value !== undefined) v.textContent = value;
  if (n && note !== undefined) n.textContent = note;
}

function loadCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.contract === CONFIG.contractAddress ? j.stats : null;
  } catch { return null; }
}
function saveCached(stats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ contract: CONFIG.contractAddress, stats })); } catch { /* storage blocked or full */ }
}

function statusText(s, stale) {
  if (stale) return 'Reconnecting';
  if (s.listed === false) return 'Waiting for the first trade';
  return s.partial ? 'Trading · partial data' : 'Trading';
}

function renderStats(s, { stale = false, unreachable = false, loading = false } = {}) {
  const dot = $('[data-live-dot]');
  const status = $('[data-live-status]');
  const meta = $('[data-live-meta]');

  // No stats at all: either the first fetch is still running (loading) or
  // every source failed with nothing cached (unreachable). Never a spinner.
  if (!s) {
    const note = unreachable ? 'Not available right now' : 'Reading the chart…';
    STAT_KEYS.forEach((k) => setStat(k, '—', note));
    if (status) status.textContent = unreachable ? 'Data source unreachable' : 'Reading the chart';
    if (dot) dot.className = unreachable ? 'dot is-stale' : 'dot';
    if (meta) {
      meta.textContent = unreachable ? 'Retrying every 30 seconds' : '';
      meta.hidden = !unreachable;
    }
    return;
  }

  // Listed but a field is missing, or not trading yet: both read as a reason, never blank.
  const idle = s.listed === false ? 'Once trading starts' : 'Not available right now';

  if (s.priceUsd != null) {
    const bits = [];
    if (s.change24h != null) bits.push(`${s.change24h > 0 ? '+' : ''}${s.change24h.toFixed(1)}% in 24 h`);
    if (s.priceSol != null) bits.push(`${fmtAmount(s.priceSol)} ${s.quoteSymbol || 'SOL'}`);
    setStat('price', fmtUsd(s.priceUsd), bits.length ? bits.join(' · ') : 'per $DELIVERY');
    const note = $('[data-stat-note="price"]');
    if (note) note.className = `stat__note${s.change24h == null ? '' : s.change24h > 0 ? ' is-up' : s.change24h < 0 ? ' is-down' : ''}`;
  } else setStat('price', '—', idle);

  if (s.marketCapUsd != null) setStat('marketCap', fmtUsd(s.marketCapUsd), s.liquidityUsd != null ? `${fmtUsd(s.liquidityUsd)} liquidity` : 'Price × supply');
  else setStat('marketCap', '—', idle);

  if (s.volume24hUsd != null) setStat('volume', fmtUsd(s.volume24hUsd), 'Traded in the last 24 h');
  else setStat('volume', '—', idle);

  if (s.buys24h != null || s.sells24h != null) {
    const buys = num(s.buys24h), sells = num(s.sells24h);
    setStat('trades', fmtInt(buys + sells), `${fmtInt(buys)} buys · ${fmtInt(sells)} sells · last 24 h`);
  } else setStat('trades', '—', idle);

  // A holder count needs a keyed indexer behind the proxy. If none is configured
  // the tile is pulled rather than left showing a dash forever.
  if (s.holdersOff) removeHoldersTile();
  else if (CONFIG.holdersApiUrl) {
    if (s.holders != null) setStat('holders', fmtInt(s.holders), 'Wallets holding $DELIVERY');
    else setStat('holders', '—', idle);
  }

  if (status) status.textContent = statusText(s, stale);
  if (dot) dot.className = `dot ${stale ? 'is-stale' : s.listed === false ? '' : 'is-live'}`;
  if (meta) {
    meta.textContent = `${stale ? 'Showing last known values · ' : ''}Updated ${fmtStamp(s.updatedAt)}`;
    meta.hidden = false;
  }
}

async function refreshStats() {
  try {
    const s = await fetchStats();
    live.stats = s;
    saveCached(s);
    renderStats(s);
  } catch {
    // A failed call never blanks the panel: last known values stay up, stamped.
    const cached = live.stats || loadCached();
    if (cached) { live.stats = cached; renderStats(cached, { stale: true }); }
    else renderStats(null, { unreachable: true });
  }
}

function removeHoldersTile() {
  const tile = $('[data-stat="holders"]')?.closest('.stat');
  if (tile) tile.remove();
}

function initLivePanel() {
  // No holder source configured at all: drop the tile before the first paint.
  if (!CONFIG.holdersApiUrl) removeHoldersTile();

  if (!isMint(CONFIG.contractAddress)) { renderStats(null, { unreachable: true }); return; }

  const cached = loadCached();
  if (cached) { live.stats = cached; renderStats(cached, { stale: true }); }
  else renderStats(null, { loading: true });
  refreshStats();

  const schedule = () => {
    clearInterval(live.timer);
    if (!document.hidden) live.timer = setInterval(refreshStats, STATS_POLL_MS);
  };
  schedule();
  document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) refreshStats(); });
}

/* ------------------------------------------------------------
   8. Gallery — reads assets/gallery/ without a build step
   ------------------------------------------------------------
   Static hosts can't list a folder, so the loader does this:
     1. If assets/gallery/manifest.json exists (a JSON array of
        filenames), use it. Handy if you want a custom order.
     2. Otherwise probe meme-01, meme-02, … (webp/jpg/jpeg/png),
        six at a time, and stop after a whole batch is missing.
   Add or remove files freely; the code never changes.
   ------------------------------------------------------------ */
const GALLERY_EXTS = ['webp', 'jpg', 'jpeg', 'png'];
const GALLERY_BATCH = 6;
const GALLERY_MAX = 300;

function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
async function exists(url) {
  // HEAD is cheap on http(s); fall back to an Image probe on file:// or if HEAD is blocked.
  if (location.protocol.startsWith('http')) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return false;
      // Some hosts answer every unknown path with the HTML page (SPA fallback); treat that as "missing".
      const type = res.headers.get('content-type') || '';
      return !type.startsWith('text/html');
    } catch { /* fall through */ }
  }
  return probeImage(url);
}
async function findImage(base) {
  for (const ext of GALLERY_EXTS) {
    const url = `${base}.${ext}`;
    if (await exists(url)) return url;
  }
  return null;
}

async function discoverGallery() {
  // 1. Manifest
  if (location.protocol.startsWith('http')) {
    try {
      const res = await fetch(`${GALLERY_DIR}manifest.json`, { cache: 'no-store' });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) return list.map((f) => (f.startsWith('http') || f.includes('/') ? f : GALLERY_DIR + f));
      }
    } catch { /* no manifest, fine */ }
  }

  // 2. Sequential probing
  const found = [];
  for (let start = 1; start <= GALLERY_MAX; start += GALLERY_BATCH) {
    const batch = [];
    for (let i = start; i < start + GALLERY_BATCH; i++) batch.push(findImage(`${GALLERY_DIR}meme-${String(i).padStart(2, '0')}`));
    const results = await Promise.all(batch);
    const hits = results.filter(Boolean);
    found.push(...hits);
    if (!hits.length) break;
  }
  return found;
}

const lightbox = { urls: [], index: 0, lastFocus: null };

function openLightbox(i) {
  const lb = $('[data-lightbox]');
  if (!lb || !lightbox.urls.length) return;
  lightbox.index = (i + lightbox.urls.length) % lightbox.urls.length;
  const img = $('[data-lb-img]', lb);
  img.src = lightbox.urls[lightbox.index];
  img.alt = `Meme ${lightbox.index + 1}`;
  $('[data-lb-caption]', lb).textContent = `${lightbox.index + 1} / ${lightbox.urls.length}`;
  if (lb.hidden) {
    lightbox.lastFocus = document.activeElement;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    $('[data-lb-close]', lb).focus();
  }
  // Preload neighbours
  [1, -1].forEach((d) => { const n = new Image(); n.src = lightbox.urls[(lightbox.index + d + lightbox.urls.length) % lightbox.urls.length]; });
}
function closeLightbox() {
  const lb = $('[data-lightbox]');
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  document.body.style.overflow = '';
  if (lightbox.lastFocus && lightbox.lastFocus.focus) lightbox.lastFocus.focus();
}
function initLightbox() {
  const lb = $('[data-lightbox]');
  if (!lb) return;
  $('[data-lb-close]', lb).addEventListener('click', closeLightbox);
  $('[data-lb-prev]', lb).addEventListener('click', () => openLightbox(lightbox.index - 1));
  $('[data-lb-next]', lb).addEventListener('click', () => openLightbox(lightbox.index + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') openLightbox(lightbox.index - 1);
    else if (e.key === 'ArrowRight') openLightbox(lightbox.index + 1);
  });
  // Swipe
  let x0 = null;
  lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) openLightbox(lightbox.index + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

async function initGallery() {
  const grid = $('[data-gallery]');
  const empty = $('[data-gallery-empty]');
  if (!grid) return;

  const urls = await discoverGallery();
  lightbox.urls = urls;

  if (!urls.length) { grid.hidden = true; if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;

  const frag = document.createDocumentFragment();
  urls.forEach((url, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'masonry__item';
    btn.setAttribute('aria-label', `Open meme ${i + 1} of ${urls.length}`);
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Delivery Guy meme ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    if (img.complete && img.naturalWidth) img.classList.add('is-loaded');
    btn.appendChild(img);
    btn.addEventListener('click', () => openLightbox(i));
    frag.appendChild(btn);
  });
  grid.appendChild(frag);
}

async function initBanner() {
  const fig = $('[data-banner]');
  if (!fig) return;
  for (const url of BANNER_CANDIDATES) {
    if (await exists(url)) { $('img', fig).src = url; fig.hidden = false; return; }
  }
}

/* ------------------------------------------------------------
   9. Scroll reveal + misc
   ------------------------------------------------------------ */
function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window)) { document.documentElement.classList.add('no-io'); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  els.forEach((el) => io.observe(el));
  // Anything already in view still shows even if the observer is slow to fire
  setTimeout(() => $$('.reveal:not(.is-visible)').forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-visible'); }), 400);
}

function initMisc() {
  const y = $('[data-year]');
  if (y) y.textContent = String(new Date().getFullYear());
  $$('[data-fee-pct]').forEach((el) => { el.textContent = `${TRADE_FEE_PCT}%`; });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initContractAddress();
  initBuyButtons();
  initListingLinks();
  initSocialLinks();
  initCopyButtons();
  initLivePanel();
  initLightbox();
  initGallery();
  initBanner();
  initReveal();
  initMisc();
});
