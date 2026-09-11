/* ============================================================
   GET /api/holders  ->  { "holders": 1234, "source": "birdeye" }

   Why this exists: Solana's public RPC cannot give a holder total
   (getTokenLargestAccounts returns the top accounts only), so a real
   number needs an indexer, and every indexer wants an API key. The site
   is static, so a key in main.js would be readable by anyone who opened
   the page and anyone could burn the quota. This function keeps the key
   server-side and is the only thing the browser talks to.

   Configure ONE of these in Vercel -> Settings -> Environment Variables:
     BIRDEYE_API_KEY   single call, exact count       (recommended)
     SOLSCAN_API_KEY   single call, exact count
     HELIUS_API_KEY    paginated count, more calls
   See .env.example. Nothing is read from a file in the repo.

   With no key set it answers 501 { error: "not_configured" } and the
   front end removes the Holders tile rather than showing a dead card.
   It never guesses and never returns a partial count as if it were a
   total: if it cannot get an exact number, it says so.
   ============================================================ */
'use strict';

const DEFAULT_MINT = '2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump';
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;   // base58, no 0 O I l
const CACHE_MS = 60_000;
const TIMEOUT_MS = 8_000;
const HELIUS_PAGE = 1_000;
const HELIUS_MAX_PAGES = 40;                        // 40k holders, then we stop rather than guess

const cache = new Map();                            // mint -> { value, at }

async function getJson(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const asCount = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/* ---- providers: each returns an exact integer, or throws ---- */

async function fromBirdeye(mint, key) {
  const j = await getJson(
    `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
    { headers: { 'X-API-KEY': key, 'x-chain': 'solana', accept: 'application/json' } },
  );
  const n = asCount(j?.data?.holder ?? j?.data?.holders);
  if (n == null) throw new Error('birdeye: no holder field in response');
  return n;
}

async function fromSolscan(mint, key) {
  const j = await getJson(
    `https://pro-api.solscan.io/v2.0/token/meta?address=${mint}`,
    { headers: { token: key, accept: 'application/json' } },
  );
  const n = asCount(j?.data?.holder ?? j?.data?.holder_count);
  if (n == null) throw new Error('solscan: no holder field in response');
  return n;
}

// Helius has no holder-count field, so the accounts are counted. $DELIVERY is an
// SPL Token-2022 mint; getTokenAccounts covers both programs, and zero balances
// are skipped so closed accounts do not inflate the number.
async function fromHelius(mint, key) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  let cursor;
  let total = 0;
  for (let page = 0; page < HELIUS_MAX_PAGES; page++) {
    const body = {
      jsonrpc: '2.0',
      id: 'holders',
      method: 'getTokenAccounts',
      params: { mint, limit: HELIUS_PAGE, options: { showZeroBalance: false }, ...(cursor ? { cursor } : {}) },
    };
    const j = await getJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (j.error) throw new Error(`helius: ${j.error.message || 'RPC error'}`);
    const accounts = j.result?.token_accounts || [];
    total += accounts.filter((a) => Number(a.amount) > 0).length;
    cursor = j.result?.cursor;
    if (!cursor || accounts.length < HELIUS_PAGE) return total;
  }
  // Past the cap the number would be a floor, not a total. Refuse it.
  throw new Error('helius: more holders than the page cap allows counting');
}

module.exports = async function handler(req, res) {
  const raw = (req.query && req.query.mint) || DEFAULT_MINT;
  const mint = String(raw);
  if (!MINT_RE.test(mint)) {
    res.status(400).json({ error: 'bad_mint' });
    return;
  }

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ ...hit.value, cached: true });
    return;
  }

  const providers = [
    ['birdeye', process.env.BIRDEYE_API_KEY, fromBirdeye],
    ['solscan', process.env.SOLSCAN_API_KEY, fromSolscan],
    ['helius', process.env.HELIUS_API_KEY, fromHelius],
  ].filter(([, key]) => Boolean(key));

  if (!providers.length) {
    // No key anywhere. Say so plainly; the front end drops the tile.
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.status(501).json({
      error: 'not_configured',
      hint: 'Set BIRDEYE_API_KEY, SOLSCAN_API_KEY or HELIUS_API_KEY in the Vercel project environment variables.',
    });
    return;
  }

  const failures = [];
  for (const [name, key, fn] of providers) {
    try {
      const holders = await fn(mint, key);
      const value = { holders, source: name, updatedAt: new Date().toISOString() };
      cache.set(mint, { value, at: Date.now() });
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.status(200).json(value);
      return;
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  // Every configured provider failed. Serve the last good value if we still have
  // one, clearly marked stale, rather than dropping a number that was fine a
  // minute ago. Otherwise fail honestly.
  if (hit) {
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    res.status(200).json({ ...hit.value, stale: true });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ error: 'upstream_failed', detail: failures });
};
