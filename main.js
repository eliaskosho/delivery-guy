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

  /* ---- Distribution stats ("Total UPS delivered", "Last payout", "Next payout") ---
     - upsTokenAddress:       UPS stock token on Robinhood Chain (the pair's quote asset)
     - distributorAddress:    the contract that sends UPS to holders (pons holder distributor).
                              null = those tiles read "Distributor not configured".
     - distributionFromBlock: first block of the payout scan (just before the pool went live).
                              null = the scan is capped to the last ~3.5 days, total shown "≈".
     - totalDistributedCall:  optional eth_call { to: '0x…', data: '0x…' } returning the
                              lifetime total as uint256, if the vault ever exposes one.
                              null = summed from every payout round found on-chain.
     - feeEscrowAddress:      pons V2 fee escrow. Its balanceOfToken(distributor, UPS) is
                              the UPS already collected for holders and waiting for the
                              next round. null = that line is simply not shown.
     The payout cadence is never configured: it is measured from real rounds.
  ------------------------------------------------------------------------- */
  upsTokenAddress: '0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2',
  distributorAddress: '0xc96e6a31c0cb9d451afe427648f541eaa37c6d0a',   // creator-fee recipient of the pool: pons holder-distributor proxy
  distributionFromBlock: 55484000,   // block just before the pool went live (2026-09-05 22:39 UTC): the payout scan starts here
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
// Payout cadence is measured from real rounds (measureCadence), never assumed.
const STATS_POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 9_000;
const DEFAULT_SUPPLY = 1_000_000_000;
const GALLERY_DIR = 'assets/gallery/';
const BANNER_CANDIDATES = ['assets/banner.webp', 'assets/banner.jpg', 'assets/banner.png'];
const STORAGE_KEY = 'dg.stats.v2';

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
// The public RPC rate-limits bursts (HTTP 429) and times out heavy log queries.
// Those are retried with a short backoff; anything else fails straight away.
async function rpc(method, params = [], attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const json = await fetchJson(CHAIN.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (json.error) throw new Error(json.error.message || 'RPC error');
      return json.result;
    } catch (err) {
      const msg = String((err && err.message) || err);
      const retryable = i < attempts && /HTTP 429|HTTP 5\d\d|abort|timed out|rate/i.test(msg);
      if (!retryable) throw err;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
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
     - Robinhood Chain RPC         supply, decimals, UPS uiMultiplier (ERC-8056),
       (eth_call, eth_getLogs)     escrow balance, every payout round since launch
     - Blockscout API v2           holders; payout rounds as a bounded fallback
     - DEXScreener public API      price in UPS and USD, market cap, 24 h volume

   Distribution model, as observed on-chain (2026-09-06):
     swap fee → pons hook → pons fee escrow (credited to the distributor)
     → the pons keeper claims it into the distributor → one multi-send
     transaction pays holders in UPS. A payout round is therefore a set
     of ERC-20 Transfer logs from distributorAddress inside one tx.
     The cadence is whatever the keeper actually does: it is measured
     from real rounds, never assumed.
   ------------------------------------------------------------ */
const SEL = {
  totalSupply: '0x18160ddd',
  decimals: '0x313ce567',
  balanceOfToken: '0xf59e38b7',   // balanceOfToken(address,address) — pons fee escrow
  uiMultiplier: '0xa60bf13d',     // uiMultiplier() — ERC-8056, implemented by the UPS stock token
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const LOG_CHUNK_START = 250_000;  // blocks per eth_getLogs call; halved whenever a call fails
const LOG_CHUNK_MIN = 2_000;
const CADENCE_SAMPLE = 8;         // newest payout rounds used to measure the cadence
const DIST_CACHE_KEY = 'dg.dist.v1';

const word = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const toHexBlock = (n) => '0x' + n.toString(16);

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

/* ---- UPS units --------------------------------------------------------------
   Every amount is kept and summed in raw token units (BigInt). The ERC-8056
   uiMultiplier is applied only when a number is displayed. */
let upsUnits = null;
async function readUpsUnits(ups) {
  if (upsUnits) return upsUnits;
  const decimals = Number(hexToBig(await ethCall(ups, SEL.decimals))) || 18;
  let multiplier = 1;
  try {
    const m = bigToNum(hexToBig(await ethCall(ups, SEL.uiMultiplier)), 18);
    if (m > 0 && isFinite(m)) multiplier = m;
  } catch { /* token has no uiMultiplier(): display raw units */ }
  upsUnits = { decimals, multiplier };
  return upsUnits;
}

/* ---- Payout rounds ----------------------------------------------------------
   Cached in localStorage so a page load never repeats the whole backfill:
   only blocks after `scannedTo` are fetched on each refresh. */
function loadDistCache(from, ups) {
  try {
    const j = JSON.parse(localStorage.getItem(DIST_CACHE_KEY) || 'null');
    if (!j || j.distributor !== from.toLowerCase() || j.ups !== ups.toLowerCase() || j.fromBlock !== CONFIG.distributionFromBlock) return null;
    return j;
  } catch { return null; }
}
function saveDistCache(c) {
  try { localStorage.setItem(DIST_CACHE_KEY, JSON.stringify(c)); } catch { /* storage blocked or full */ }
}

// eth_getLogs over [from, to]. A chunk that fails (timeout, rate limit, range cap) is halved and retried.
async function getLogsChunked(filter, from, to) {
  const out = [];
  let chunk = LOG_CHUNK_START;
  let f = from;
  while (f <= to) {
    const t = Math.min(f + chunk - 1, to);
    try {
      out.push(...await rpc('eth_getLogs', [{ ...filter, fromBlock: toHexBlock(f), toBlock: toHexBlock(t) }]));
      f = t + 1;
    } catch (err) {
      if (chunk <= LOG_CHUNK_MIN) throw err;
      chunk = Math.floor(chunk / 2);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return out;
}

// One transaction = one payout round.
function roundsFromLogs(logs) {
  const byTx = new Map();
  for (const l of logs) {
    const r = byTx.get(l.transactionHash) || { tx: l.transactionHash, block: parseInt(l.blockNumber, 16), ts: null, recipients: 0, amountRaw: 0n };
    r.recipients += 1;
    r.amountRaw += hexToBig(l.data);
    byTx.set(l.transactionHash, r);
  }
  return [...byTx.values()];
}

// Fallback when the RPC is unavailable: the newest transfers from Blockscout, a few pages only.
async function readRoundsFromBlockscout(from, ups) {
  const base = `${CHAIN.explorer}/api/v2/addresses/${from}/token-transfers?type=ERC-20&filter=from&token=${ups}`;
  let url = base;
  let pages = 0;
  const items = [];
  while (url && pages < 4) {
    const j = await fetchJson(url);
    items.push(...(Array.isArray(j.items) ? j.items : []));
    pages += 1;
    url = j.next_page_params ? `${base}&${new URLSearchParams(j.next_page_params)}` : null;
  }
  const byTx = new Map();
  for (const it of items) {
    const tx = it.transaction_hash || it.tx_hash;
    if (!tx) continue;
    const r = byTx.get(tx) || { tx, block: Number(it.block_number), ts: Math.floor(new Date(it.timestamp).getTime() / 1000), recipients: 0, amountRaw: 0n };
    r.recipients += 1;
    r.amountRaw += BigInt(it.total?.value || 0);
    byTx.set(tx, r);
  }
  return { rounds: [...byTx.values()], complete: url === null };
}

// Median gap between the newest rounds. null until two rounds exist.
function measureCadence(rounds) {
  const withTs = rounds.filter((r) => r.ts).slice(-CADENCE_SAMPLE);
  if (withTs.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < withTs.length; i++) gaps.push(withTs[i].ts - withTs[i - 1].ts);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length / 2;
  const medianS = gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
  return { medianS, samples: gaps.length, minS: gaps[0], maxS: gaps[gaps.length - 1] };
}

async function readDistributions() {
  const from = CONFIG.distributorAddress;
  const ups = CONFIG.upsTokenAddress;
  if (!isAddress(from) || !isAddress(ups)) return null;

  const units = await readUpsUnits(ups);
  const out = {
    ok: false, source: null, partial: false,
    rounds: 0, totalRaw: '0', totalIsBounded: false, last: null, cadence: null,
    pendingRaw: null, decimals: units.decimals, multiplier: units.multiplier,
  };

  // UPS credited to the distributor in the pons fee escrow, not paid out yet. Optional line.
  if (isAddress(CONFIG.feeEscrowAddress)) {
    try { out.pendingRaw = hexToBig(await ethCall(CONFIG.feeEscrowAddress, SEL.balanceOfToken + word(from) + word(ups))).toString(); }
    catch { /* line is skipped */ }
  }

  const cache = loadDistCache(from, ups) || {
    distributor: from.toLowerCase(), ups: ups.toLowerCase(), fromBlock: CONFIG.distributionFromBlock,
    scannedTo: null, rounds: [],
  };
  let rounds = cache.rounds.map((r) => ({ ...r, amountRaw: BigInt(r.amountRaw) }));

  try {
    const latest = parseInt(await rpc('eth_blockNumber'), 16);
    if (cache.scannedTo == null) {
      // First scan. Without a launch block the scan is capped to the last ~3.5 days and marked "≈".
      if (Number.isInteger(CONFIG.distributionFromBlock)) cache.scannedTo = CONFIG.distributionFromBlock - 1;
      else { cache.scannedTo = Math.max(0, latest - 3_000_000); out.totalIsBounded = true; }
    }
    if (latest > cache.scannedTo) {
      const logs = await getLogsChunked({ address: ups, topics: [TRANSFER_TOPIC, '0x' + word(from)] }, cache.scannedTo + 1, latest);
      const known = new Set(rounds.map((r) => r.tx));
      for (const r of roundsFromLogs(logs)) if (!known.has(r.tx)) rounds.push(r);
      cache.scannedTo = latest;
    }
    rounds.sort((a, b) => a.block - b.block);
    // Block timestamps for the newest rounds only (cadence and "x min ago"). Older rounds keep null.
    // A timestamp that cannot be read now is simply fetched on the next refresh.
    for (const r of rounds.slice(-CADENCE_SAMPLE)) {
      if (r.ts) continue;
      try {
        const b = await rpc('eth_getBlockByNumber', [toHexBlock(r.block), false]);
        r.ts = parseInt(b.timestamp, 16);
      } catch { out.partial = true; }
    }
    saveDistCache({ ...cache, rounds: rounds.map((r) => ({ ...r, amountRaw: r.amountRaw.toString() })) });
    out.ok = true;
    out.source = 'rpc';
  } catch {
    // RPC failed. Cached rounds still count; without a cache Blockscout gives a bounded view.
    out.partial = true;
    if (rounds.length) { out.ok = true; out.source = 'cache'; }
    else {
      try {
        const bs = await readRoundsFromBlockscout(from, ups);
        rounds = bs.rounds.sort((a, b) => a.block - b.block);
        out.ok = true;
        out.source = 'blockscout';
        out.totalIsBounded = !bs.complete;
      } catch { /* nothing available right now */ }
    }
  }
  if (!out.ok) return out;

  out.rounds = rounds.length;
  out.totalRaw = rounds.reduce((s, r) => s + r.amountRaw, 0n).toString();
  const call = CONFIG.totalDistributedCall;
  if (call && isAddress(call.to) && call.data) {
    // The vault exposes an exact lifetime total: prefer it.
    try { out.totalRaw = hexToBig(await ethCall(call.to, call.data)).toString(); out.totalIsBounded = false; } catch { /* keep the sum */ }
  }
  const last = rounds[rounds.length - 1];
  if (last) out.last = { tx: last.tx, block: last.block, ts: last.ts, recipients: last.recipients, amountRaw: last.amountRaw.toString() };
  out.cadence = measureCadence(rounds);
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
  const failed = settled.filter((r) => r.status === 'rejected').length;
  if (failed === settled.length) throw new Error('All stat sources failed');

  const supply = basics?.supply ?? DEFAULT_SUPPLY;
  const priceUps = market && /ups/i.test(market.quoteSymbol || '') ? market.priceInQuote : null;
  // DEXScreener prices are per raw token unit, so this converts raw UPS amounts to USD.
  const usdPerUps = priceUps && market?.priceUsd ? market.priceUsd / priceUps : null;

  return {
    updatedAt: Math.floor(Date.now() / 1000),
    partial: failed > 0 || Boolean(dist && (dist.partial || !dist.ok)),
    holders,
    supply,
    priceUps,
    priceUsd: market?.priceUsd ?? null,
    marketCapUps: priceUps != null ? priceUps * supply : null,
    marketCapUsd: market?.marketCapUsd ?? (market?.priceUsd != null ? market.priceUsd * supply : null),
    volume24hUsd: market?.volume24hUsd ?? null,
    txns24h: market?.txns24h ?? null,
    usdPerUps,
    distribution: dist,   // null = no distributor configured
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

// Raw UPS string → display text (uiMultiplier applied) and USD text.
function upsText(raw, d) { return fmtAmount(bigToNum(BigInt(raw), d.decimals) * d.multiplier, 'UPS'); }
function upsUsd(raw, d, usdPerUps) { return usdPerUps != null ? fmtUsd(bigToNum(BigInt(raw), d.decimals) * usdPerUps) : null; }

function statusText(s, stale) {
  if (stale) return 'Reconnecting';
  const d = s.distribution;
  if (d && !d.ok) return 'Partial data';
  if (d && d.rounds === 0) return s.partial ? 'No payout yet · partial data' : 'No payout yet';
  return s.partial ? 'Delivering · partial data' : 'Delivering';
}

function renderStats(s, { stale = false, unreachable = false, loading = false } = {}) {
  const dot = $('[data-live-dot]');
  const status = $('[data-live-status]');
  const meta = $('[data-live-meta]');

  if (!s) {
    // Pre-launch placeholders; (loading) first fetch still running with nothing cached;
    // (unreachable) every source failed and nothing is cached.
    const note = unreachable ? 'Not available right now' : loading ? 'Reading the chain…' : 'Live after launch';
    ['totalDistributed', 'lastPayout', 'holders', 'price', 'marketCap', 'volume'].forEach((k) => setStat(k, '—', k === 'price' && !unreachable && !loading ? 'in UPS · Live after launch' : note));
    setStat('countdown', '—', unreachable || loading ? note : 'Measured from real payouts');
    if (status) status.textContent = unreachable ? 'Data sources unreachable' : loading ? 'Reading the chain' : 'Live after launch';
    if (dot) dot.className = unreachable ? 'dot is-stale' : 'dot';
    if (meta) {
      meta.textContent = unreachable ? 'Retrying every 30 seconds' : '';
      meta.hidden = !unreachable;
    }
    return;
  }

  const d = s.distribution;
  if (d && d.ok) {
    const pend = d.pendingRaw != null ? ` · ${upsText(d.pendingRaw, d)} collected, waiting for the next round` : '';
    if (d.rounds > 0) {
      const usd = upsUsd(d.totalRaw, d, s.usdPerUps);
      setStat('totalDistributed', `${d.totalIsBounded ? '≈ ' : ''}${upsText(d.totalRaw, d)}`,
        `${usd ? '≈ ' + usd + ' · ' : ''}${fmtInt(d.rounds)} payout round${d.rounds === 1 ? '' : 's'} since launch${pend}`);
    } else {
      setStat('totalDistributed', '0 UPS', `No payout yet${pend}`);
    }
    if (d.last) {
      const usd = upsUsd(d.last.amountRaw, d, s.usdPerUps);
      setStat('lastPayout', upsText(d.last.amountRaw, d),
        `${d.last.ts ? fmtAgo(d.last.ts) + ' · ' : ''}${fmtInt(d.last.recipients)} holders paid${usd ? ' · ≈ ' + usd : ''}`);
    } else {
      setStat('lastPayout', '—', 'No payout yet');
    }
  } else if (d) {
    setStat('totalDistributed', '—', 'Payout data not available right now');
    setStat('lastPayout', '—', 'Payout data not available right now');
  } else {
    setStat('totalDistributed', '—', 'Distributor not configured');
    setStat('lastPayout', '—', 'Distributor not configured');
  }
  renderCountdown(s);

  setStat('holders', fmtInt(s.holders), s.holders != null ? 'On Robinhood Chain' : 'Not available right now');

  if (s.priceUps != null) setStat('price', fmtAmount(s.priceUps, 'UPS'), s.priceUsd != null ? `≈ ${fmtUsd(s.priceUsd)} per $DELIVERY` : 'per $DELIVERY');
  else if (s.priceUsd != null) setStat('price', fmtUsd(s.priceUsd), 'per $DELIVERY (USD)');
  else setStat('price', '—', 'in UPS · not available right now');

  if (s.marketCapUps != null) setStat('marketCap', fmtAmount(s.marketCapUps, 'UPS'), s.marketCapUsd != null ? `≈ ${fmtUsd(s.marketCapUsd)}` : 'Price × supply');
  else if (s.marketCapUsd != null) setStat('marketCap', fmtUsd(s.marketCapUsd), 'USD');
  else setStat('marketCap', '—', 'Not available right now');

  if (s.volume24hUsd != null) setStat('volume', fmtUsd(s.volume24hUsd), s.txns24h != null ? `${fmtInt(s.txns24h)} trades · last 24 h` : 'USD · last 24 h');
  else setStat('volume', '—', 'Not available right now');

  if (status) status.textContent = statusText(s, stale);
  if (dot) dot.className = `dot ${stale ? 'is-stale' : 'is-live'}`;
  if (meta) {
    const t = new Date(s.updatedAt * 1000);
    meta.textContent = `${stale ? 'Showing last known values · ' : ''}Updated ${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    meta.hidden = false;
  }
}

// The countdown rests on the measured cadence only. No cadence, no countdown.
function renderCountdown(s) {
  const d = s?.distribution;
  if (!d || !d.ok) { setStat('countdown', '—', d ? 'Payout data not available right now' : 'Distributor not configured'); return; }
  if (!d.cadence || !d.last?.ts) {
    let why = 'No payout yet · nothing to measure';
    if (d.rounds === 1) why = 'One round so far · no cadence to measure yet';
    else if (d.rounds > 1) why = 'Round times not available right now';
    setStat('countdown', '—', why);
    return;
  }
  const { medianS, samples } = d.cadence;
  const mins = Math.max(1, Math.round(medianS / 60));
  const now = Date.now() / 1000;
  const remaining = d.last.ts + medianS - now;
  const basis = `Estimated from the last ${samples + 1} rounds, ~${mins} min apart`;
  if (remaining > 0) setStat('countdown', fmtClock(remaining), basis);
  else if (now - d.last.ts < 3 * medianS) setStat('countdown', 'Due', `${basis} · last one ${fmtAgo(d.last.ts)}`);
  else setStat('countdown', '—', `No round since ${fmtAgo(d.last.ts).replace(' ago', '')} ago · earlier rounds were ~${mins} min apart`);
}

function startCountdown() {
  clearInterval(live.countdownTimer);
  const tick = () => { if (live.stats) renderCountdown(live.stats); };
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
    else renderStats(null, { unreachable: true });
  }
}

function initLivePanel() {
  if (!isAddress(CONFIG.contractAddress)) { renderStats(null); return; }

  const cached = loadCached();
  if (cached) { live.stats = cached; renderStats(cached, { stale: true }); }
  else renderStats(null, { loading: true });
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
