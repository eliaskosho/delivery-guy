/* ============================================================
   Delivery Guy — main.js
   Plain JS, no dependencies. Everything that changes at launch
   lives in CONFIG below. Nothing else needs to be edited.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   1. CONFIG — launch data. This is the only block you edit.
   ------------------------------------------------------------
   - null = unknown. The site handles it: buy buttons show
     "Launching soon", the CA reads "CA revealed at launch",
     missing links are removed (never a dead "#"), stats show "—".
   - As soon as a value is set, the matching UI switches on.
   ------------------------------------------------------------ */
const CONFIG = {
  // $DELIVERY token contract on Robinhood Chain. Turns on: CA display + copy,
  // explorer link, and the live panel (holders, supply, price, market cap, volume).
  contractAddress: '0x9A881D5cC0A1Ff529AeF0F0A79D6BeEFF6e90989',

  // pons trade page. If null while contractAddress is set, it is derived as
  // https://www.ponsfamily.com/launchpad/<contractAddress>
  buyUrl: 'https://www.ponsfamily.com/launchpad/0x9A881D5cC0A1Ff529AeF0F0A79D6BeEFF6e90989',

  // Chart / listing links. null = hidden entirely, never a dead link.
  // The DEXScreener URL also tells the live panel which pair to read
  // price, market cap and 24 h volume from.
  dexscreener: 'https://dexscreener.com/robinhood/0x21c17bf5ad43fd9e47c40f4a2f8eb1300c77def7f69e43c56c0559cb4f2de2c1',
  dextools: null,
  coinmarketcap: null,
  coingecko: null,

  // Explorer page for the token. null = derived from the chain explorer + contractAddress.
  explorer: 'https://robinhoodchain.blockscout.com/token/0x9A881D5cC0A1Ff529AeF0F0A79D6BeEFF6e90989',

  // Socials. Every Telegram / X link on the page follows these.
  telegram: 'https://t.me/deliveryguytg',
  x: 'https://x.com/DeliveryGuyRHoo',

  /* ---- Distribution stats ("Total UPS delivered", "Last payout") --------
     - upsTokenAddress:      UPS stock token on Robinhood Chain (the pair's quote asset)
     - distributorAddress:   the contract that sends UPS to holders (pons token vault).
                             null = those two tiles read "Waiting for first payout".
     - totalDistributedCall: optional eth_call { to: '0x…', data: '0x…' } returning the
                             lifetime total as uint256. null = summed from recent
                             transfers read from Blockscout, shown with "≈".
     - feeEscrowAddress:     pons V2 fee escrow. Its balanceOfToken(distributor, UPS) is
                             the UPS already collected for holders and waiting for the
                             next payout. null = that line is simply not shown.
  ------------------------------------------------------------------------- */
  upsTokenAddress: '0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2',
  distributorAddress: '0xc96e6a31c0cb9d451afe427648f541eaa37c6d0a',   // creator-fee recipient of the pool: pons holder-distributor proxy
  totalDistributedCall: null,
  feeEscrowAddress: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
};

/* ------------------------------------------------------------
   2. Constants (facts about the chain and project, not launch data)
   ------------------------------------------------------------ */
const CHAIN = {
  id: 4663,
  idHex: '0x1237',
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};
const PONS_LAUNCHPAD = 'https://www.ponsfamily.com/launchpad';
const DISTRIBUTION_INTERVAL_S = 5 * 60;   // payouts every 5 minutes
const STATS_POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 9_000;
const DEFAULT_SUPPLY = 1_000_000_000;
const GALLERY_DIR = 'assets/gallery/';
const BANNER_CANDIDATES = ['assets/banner.webp', 'assets/banner.jpg', 'assets/banner.png'];
const STORAGE_KEY = 'dg.stats.v1';

/* ------------------------------------------------------------
   3. Small helpers
   ------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
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
async function rpc(method, params = []) {
  const json = await fetchJson(CHAIN.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}
const ethCall = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const hexToBig = (hex) => (hex && hex !== '0x') ? BigInt(hex) : 0n;
const bigToNum = (big, decimals) => Number(big) / 10 ** decimals;

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
  if (isAddress(CONFIG.contractAddress)) return `${PONS_LAUNCHPAD}/${CONFIG.contractAddress}`;
  return null;
}

function initContractAddress() {
  const ca = isAddress(CONFIG.contractAddress) ? CONFIG.contractAddress : null;

  $$('[data-ca-text]').forEach((el) => {
    if (!ca) { el.textContent = 'CA revealed at launch'; return; }
    el.textContent = el.dataset.caText === 'short' ? shortAddr(ca) : ca;
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
      const ok = await copyText(ca);
      toast(ok ? 'Contract address copied' : 'Could not copy. Long-press the address instead.', !ok);
      if (ok) { btn.classList.add('is-copied'); setTimeout(() => btn.classList.remove('is-copied'), 1400); }
    });
  });

  $$('[data-explorer-link]').forEach((a) => {
    if (ca) { a.href = CONFIG.explorer || `${CHAIN.explorer}/token/${ca}`; a.hidden = false; }
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
    a.textContent = 'Launching soon';
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
  if (isAddress(CONFIG.contractAddress)) any = true;   // explorer chip is shown in that case
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
   5. Generic copy buttons (chain id, RPC, explorer)
   ------------------------------------------------------------ */
function initCopyButtons() {
  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy);
      toast(ok ? 'Copied' : 'Could not copy', !ok);
      if (ok) { btn.classList.add('is-copied'); setTimeout(() => btn.classList.remove('is-copied'), 1400); }
    });
  });
}

/* ------------------------------------------------------------
   6. Add Robinhood Chain to the wallet (EIP-3085)
   ------------------------------------------------------------ */
function initAddNetwork() {
  $$('[data-add-network]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eth = window.ethereum;
      if (!eth || typeof eth.request !== 'function') {
        toast('No wallet detected. Open this page inside your wallet app, or add the network manually below.', true);
        return;
      }
      try {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN.idHex,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: [CHAIN.rpc],
            blockExplorerUrls: [CHAIN.explorer],
          }],
        });
        toast('Robinhood Chain added to your wallet');
      } catch (err) {
        if (err && (err.code === 4001 || /rejected|denied/i.test(err.message || ''))) toast('Request cancelled');
        else toast('Wallet refused the request. Add the network manually below.', true);
      }
    });
  });
}

/* ------------------------------------------------------------
   7. Live panel — data layer
   ------------------------------------------------------------
   fetchStats() returns a plain object; nulls mean "unknown".
   Each source is independent: if one fails the others still render.
   Sources:
     - Robinhood Chain RPC (eth_call)           supply, decimals, optional totalDistributed
     - Blockscout API v2 (same explorer)        holders, recent UPS transfers from the vault
     - DEXScreener public API (CORS enabled)    price in UPS/USD, market cap, 24 h volume
   ------------------------------------------------------------ */
const SEL = { totalSupply: '0x18160ddd', decimals: '0x313ce567', balanceOfToken: '0xf59e38b7' /* balanceOfToken(address,address) */ };

async function readTokenBasics(token) {
  const [supplyHex, decHex] = await Promise.all([ethCall(token, SEL.totalSupply), ethCall(token, SEL.decimals)]);
  const decimals = Number(hexToBig(decHex)) || 18;
  return { decimals, supply: bigToNum(hexToBig(supplyHex), decimals) };
}

async function readHolders(token) {
  // The token endpoint carries the indexed holder count. The light "counters" endpoint
  // lags behind on fresh tokens, so it is only the fallback.
  try {
    const j = await fetchJson(`${CHAIN.explorer}/api/v2/tokens/${token}`);
    const h = j.holders_count ?? j.holders;
    if (h != null) return Number(h);
  } catch { /* fall through */ }
  const c = await fetchJson(`${CHAIN.explorer}/api/v2/tokens/${token}/counters`);
  return c.token_holders_count != null ? Number(c.token_holders_count) : null;
}

// "https://dexscreener.com/<chain>/<pair>" → { chain, pair }, or null.
function dexPairRef(url) {
  const m = typeof url === 'string' ? url.match(/dexscreener\.com\/([a-z0-9-]+)\/(0x[0-9a-f]{40,64})/i) : null;
  return m ? { chain: m[1].toLowerCase(), pair: m[2] } : null;
}
function pickPair(pairs) {
  if (!pairs.length) return null;
  // Prefer the UPS-quoted pair; otherwise the deepest one.
  const ups = pairs.find((p) => /ups/i.test(p.quoteToken?.symbol || ''));
  return ups || pairs.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

async function readMarket(token) {
  let pairs = [];
  const ref = dexPairRef(CONFIG.dexscreener);
  if (ref) {
    try {
      const j = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${ref.chain}/${ref.pair}`);
      pairs = Array.isArray(j.pairs) ? j.pairs : (j.pair ? [j.pair] : []);
    } catch { /* fall back to the token endpoint */ }
  }
  if (!pairs.length) {
    const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    pairs = Array.isArray(j.pairs) ? j.pairs : [];
  }
  const best = pickPair(pairs);
  if (!best) return null;
  const tx = best.txns?.h24;
  return {
    priceInQuote: best.priceNative != null ? Number(best.priceNative) : null,
    quoteSymbol: best.quoteToken?.symbol || null,
    priceUsd: best.priceUsd != null ? Number(best.priceUsd) : null,
    marketCapUsd: best.marketCap ?? best.fdv ?? null,
    volume24hUsd: best.volume?.h24 != null ? Number(best.volume.h24) : null,
    txns24h: tx ? Number(tx.buys || 0) + Number(tx.sells || 0) : null,
  };
}

async function readDistributions() {
  const { distributorAddress: from, upsTokenAddress: ups, totalDistributedCall: call } = CONFIG;
  if (!isAddress(from) || !isAddress(ups)) return null;

  const upsDecimals = Number(hexToBig(await ethCall(ups, SEL.decimals))) || 18;
  const out = { total: null, totalIsApprox: false, last: null, pending: null };

  // Lifetime total: exact if the vault exposes a view, otherwise a bounded sum of recent transfers.
  if (call && isAddress(call.to) && call.data) {
    try { out.total = bigToNum(hexToBig(await ethCall(call.to, call.data)), upsDecimals); } catch { /* fall through */ }
  }

  // UPS credited to the distributor in the pons fee escrow but not paid out yet.
  if (isAddress(CONFIG.feeEscrowAddress)) {
    try {
      const word = (a) => a.slice(2).toLowerCase().padStart(64, '0');
      out.pending = bigToNum(hexToBig(await ethCall(CONFIG.feeEscrowAddress, SEL.balanceOfToken + word(from) + word(ups))), upsDecimals);
    } catch { /* optional line, skip on failure */ }
  }

  // Recent outgoing UPS transfers from the vault, newest first.
  const base = `${CHAIN.explorer}/api/v2/addresses/${from}/token-transfers?type=ERC-20&filter=from&token=${ups}`;
  let url = base, pages = 0, sum = 0, items = [];
  const MAX_PAGES = out.total == null ? 6 : 1;
  while (url && pages < MAX_PAGES) {
    const j = await fetchJson(url);
    const batch = Array.isArray(j.items) ? j.items : [];
    items = items.concat(batch);
    for (const it of batch) sum += Number(it.total?.value || 0) / 10 ** Number(it.total?.decimals ?? upsDecimals);
    pages++;
    url = j.next_page_params ? `${base}&${new URLSearchParams(j.next_page_params)}` : null;
  }
  if (out.total == null && items.length) { out.total = sum; out.totalIsApprox = Boolean(url); }

  // A payout round = every transfer sharing the newest block.
  if (items.length) {
    const newestBlock = items[0].block_number ?? items[0].block;
    const round = items.filter((it) => (it.block_number ?? it.block) === newestBlock);
    const amount = round.reduce((s, it) => s + Number(it.total?.value || 0) / 10 ** Number(it.total?.decimals ?? upsDecimals), 0);
    out.last = { amount, time: Math.floor(new Date(items[0].timestamp).getTime() / 1000), recipients: round.length };
  }
  return out;
}

async function fetchStats() {
  const token = CONFIG.contractAddress;
  const settled = await Promise.allSettled([
    readTokenBasics(token),
    readHolders(token),
    readMarket(token),
    readDistributions(),
  ]);
  const [basics, holders, market, dist] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  const errors = settled.filter((r) => r.status === 'rejected').length;
  if (errors === settled.length) throw new Error('All stat sources failed');

  const supply = basics?.supply ?? DEFAULT_SUPPLY;
  const priceUps = market && /ups/i.test(market.quoteSymbol || '') ? market.priceInQuote : null;

  return {
    updatedAt: Math.floor(Date.now() / 1000),
    partial: errors > 0,
    holders,
    supply,
    priceUps,
    priceUsd: market?.priceUsd ?? null,
    marketCapUps: priceUps != null ? priceUps * supply : null,
    marketCapUsd: market?.marketCapUsd ?? (market?.priceUsd != null ? market.priceUsd * supply : null),
    volume24hUsd: market?.volume24hUsd ?? null,
    txns24h: market?.txns24h ?? null,
    totalDistributed: dist?.total ?? null,
    totalIsApprox: dist?.totalIsApprox ?? false,
    lastPayout: dist?.last ?? null,
    pendingFees: dist?.pending ?? null,
  };
}

/* ------------------------------------------------------------
   8. Live panel — rendering, caching, countdown
   ------------------------------------------------------------ */
const live = { stats: null, timer: null, countdownTimer: null };

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ contract: CONFIG.contractAddress, stats })); } catch { /* ignore */ }
}

function renderStats(s, { stale = false } = {}) {
  const dot = $('[data-live-dot]');
  const status = $('[data-live-status]');
  const meta = $('[data-live-meta]');

  if (!s) {
    // Pre-launch placeholders
    ['totalDistributed', 'lastPayout', 'holders', 'price', 'marketCap', 'volume'].forEach((k) => setStat(k, '—', k === 'price' ? 'in UPS · Live after launch' : 'Live after launch'));
    setStat('countdown', '—', 'Every 5 minutes');
    if (status) status.textContent = 'Live after launch';
    if (dot) dot.className = 'dot';
    if (meta) meta.hidden = true;
    return;
  }

  const pendingNote = s.pendingFees != null ? ` · ${fmtAmount(s.pendingFees, 'UPS')} collected, waiting for the next payout` : '';
  setStat('totalDistributed',
    s.totalDistributed != null ? `${s.totalIsApprox ? '≈ ' : ''}${fmtAmount(s.totalDistributed, 'UPS')}` : '—',
    (s.totalDistributed != null ? (s.totalIsApprox ? 'Sum of recent payouts, read from Blockscout' : 'Lifetime, read on-chain') : 'Waiting for first payout') + pendingNote);

  if (s.lastPayout) {
    setStat('lastPayout', fmtAmount(s.lastPayout.amount, 'UPS'),
      `${fmtAgo(s.lastPayout.time)} · ${fmtInt(s.lastPayout.recipients)} holders`);
  } else setStat('lastPayout', '—', 'Waiting for first payout');

  setStat('holders', fmtInt(s.holders), s.holders != null ? 'On Robinhood Chain' : 'Not available right now');

  if (s.priceUps != null) setStat('price', fmtAmount(s.priceUps, 'UPS'), s.priceUsd != null ? `≈ ${fmtUsd(s.priceUsd)} per $DELIVERY` : 'per $DELIVERY');
  else if (s.priceUsd != null) setStat('price', fmtUsd(s.priceUsd), 'per $DELIVERY (USD)');
  else setStat('price', '—', 'in UPS · not available yet');

  if (s.marketCapUps != null) setStat('marketCap', fmtAmount(s.marketCapUps, 'UPS'), s.marketCapUsd != null ? `≈ ${fmtUsd(s.marketCapUsd)}` : 'Price × supply');
  else if (s.marketCapUsd != null) setStat('marketCap', fmtUsd(s.marketCapUsd), 'USD');
  else setStat('marketCap', '—', 'Not available yet');

  if (s.volume24hUsd != null) setStat('volume', fmtUsd(s.volume24hUsd), s.txns24h != null ? `${fmtInt(s.txns24h)} trades · last 24 h` : 'USD · last 24 h');
  else setStat('volume', '—', 'Not available yet');

  if (status) status.textContent = stale ? 'Reconnecting' : (s.partial ? 'Delivering (partial data)' : 'Delivering');
  if (dot) dot.className = `dot ${stale ? 'is-stale' : 'is-live'}`;
  if (meta) {
    const t = new Date(s.updatedAt * 1000);
    meta.textContent = `${stale ? 'Showing last known values · ' : ''}Updated ${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    meta.hidden = false;
  }
}

function nextPayoutAt(s) {
  // Anchor to the last payout if we know it, otherwise to 5-minute wall-clock marks.
  const now = Date.now() / 1000;
  if (s?.lastPayout?.time) {
    let next = s.lastPayout.time + DISTRIBUTION_INTERVAL_S;
    while (next < now) next += DISTRIBUTION_INTERVAL_S;
    return next;
  }
  return Math.ceil(now / DISTRIBUTION_INTERVAL_S) * DISTRIBUTION_INTERVAL_S;
}
function startCountdown() {
  clearInterval(live.countdownTimer);
  const tick = () => {
    if (!live.stats) return;
    const remaining = nextPayoutAt(live.stats) - Date.now() / 1000;
    setStat('countdown', fmtClock(remaining), live.stats.lastPayout ? 'Since last payout' : 'Estimated · every 5 minutes');
  };
  tick();
  live.countdownTimer = setInterval(tick, 1000);
}

async function refreshStats() {
  try {
    const s = await fetchStats();
    live.stats = s;
    saveCached(s);
    renderStats(s);
  } catch {
    const cached = loadCached();
    if (cached) { live.stats = cached; renderStats(cached, { stale: true }); }
    else renderStats(null);
  }
}

function initLivePanel() {
  if (!isAddress(CONFIG.contractAddress)) { renderStats(null); return; }

  const cached = loadCached();
  if (cached) { live.stats = cached; renderStats(cached, { stale: true }); }
  startCountdown();
  refreshStats();

  const schedule = () => {
    clearInterval(live.timer);
    if (!document.hidden) live.timer = setInterval(refreshStats, STATS_POLL_MS);
  };
  schedule();
  document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) refreshStats(); });
}

/* ------------------------------------------------------------
   9. Gallery — reads assets/gallery/ without a build step
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
   10. Scroll reveal + misc
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
  initAddNetwork();
  initLivePanel();
  initLightbox();
  initGallery();
  initBanner();
  initReveal();
  initMisc();
});
