# Delivery Guy — deliveryguyups.com

Marketing site for **Delivery Guy ($DELIVERY)** on **Solana**, launched on **pump.fun**.
Plain HTML, CSS and vanilla JS. No framework, no build step, no npm.

```
index.html          the whole page
styles.css          styles (dark base, green accent #06e076)
main.js             CONFIG + all behaviour (live panel, gallery, copy buttons)
assets/
  logo.webp         square mascot logo (topbar, footer)
  mascot.webp       cut-out mascot (hero)
  og.jpg            1200×630 social preview
  favicon-*.png, apple-touch-icon.png
  banner.webp       wide banner above the gallery — optional, see below
  gallery/          memes shown on the site (read automatically, meme-01.webp ...)
tools/
  optimize-images.py  resizes + converts memes to WebP and names them meme-NN.webp
.env.example        only needed if you wire up the optional holder count
```

---

## 1. CONFIG (launch data)

Open `main.js`. The first thing in the file is the `CONFIG` block. It is the only thing you edit; every other file reads from it.

| Key | Current value | What it switches on |
|---|---|---|
| `contractAddress` | `2Rbedk…Lzpump` | CA in topbar + hero, copy buttons, Solscan link, live panel |
| `buyUrl` | pump.fun coin page | Every "Buy" button. If `null`, derived as `https://pump.fun/coin/<contractAddress>` |
| `dexscreener` | token page on DEXScreener | Hero button, chip under the live panel, footer link |
| `solscan` | Solscan token page | All "Solscan" links. `null` = derived from `contractAddress` |
| `telegram`, `x` | community links | Every Telegram / X link on the page |
| `dextools`, `coinmarketcap`, `coingecko` | `null` until listed | Chips under the live panel. `null` = removed from the page, never a dead link |
| `holdersApiUrl` | `/api/holders` | The Holders tile, via the serverless proxy. `null` = the tile is removed outright. See section 2 |

The contract address is a Solana **mint address**: base58, 32–44 characters, no `0`, `O`, `I` or `l`. It is validated against that, shortened as `2Rbe…zpump` in the topbar chip, and shown in full in the hero. Copy buttons always copy the full 44 characters, never the shortened form.

### Where the live numbers come from

| Stat | Source |
|---|---|
| Price, 24 h change, market cap, liquidity | DEXScreener token endpoint |
| 24 h volume, 24 h trades (buys + sells) | same call |
| Holders | the proxy in `api/holders.js` — see section 2 |

Two endpoints are tried in order, because they are not interchangeable:

1. `https://api.dexscreener.com/tokens/v1/solana/<mint>` — answers with a **bare array** of pairs.
2. `https://api.dexscreener.com/latest/dex/tokens/<mint>` — answers with an **object** holding a `pairs` array, which is `null` before the first trade.

Both shapes are normalised to an array, and the second is only used if the first fails or comes back empty. No API key, and the published limit is around 300 requests a minute, so polling every 30 seconds is nowhere near it.

**Always pick by liquidity, never take the first element.** This token proves why: the old endpoint returns two pairs, the graduated PumpSwap pool and the abandoned bonding curve. The curve pair reports no liquidity at all and a price change in the hundreds of percent. The site sorts by USD liquidity and breaks ties on 24 h volume, which picks the real pool and also picks correctly while a coin is still on the curve, where DEXScreener reports no liquidity figure for anything.

**Note it is the `tokens` endpoint, not `pairs`.** The address above is the mint, and a mint has no pair address until something trades.

If a refresh fails, the last known values stay on screen with a timestamp and a *Showing last known values* note. There is no spinner that can hang, and no tile ever goes blank without saying why.

### What the panel deliberately does not show

There is **no cashback total, no last payout and no countdown**, and this was checked rather than assumed. pump.fun's own coin record exposes exactly one cashback-related field, the boolean `is_cashback_enabled`. No amount, no running total, no payout history — and that is true even for coins where cashback *is* switched on, so there is nothing to read even in principle. Rather than leave dead cards in the panel, those tiles are not there. Do not add a timer for a payout whose cadence you cannot prove, and do not derive a cashback figure from volume.

---

## 2. Holder count — `api/holders.js`

Solana's public RPC cannot give a holder total. `getTokenLargestAccounts` returns the top accounts only, and `getProgramAccounts` over the token program is disabled on public endpoints and would be far too large for a browser anyway. A real total needs an indexer, and every indexer wants an API key.

**The site is static, so a key in `main.js` would be public** and anyone could burn the quota. `api/holders.js` is a single Vercel serverless function that keeps the key server-side. The browser only ever calls `/api/holders`. That one function does not make this an app; the rest of the site is still plain files.

**To switch the Holders tile on**, set one of these in Vercel under *Settings → Environment Variables*, for Production and Preview, then redeploy:

| Variable | Provider | Cost of a lookup |
|---|---|---|
| `BIRDEYE_API_KEY` | Birdeye | one call, exact count (recommended) |
| `SOLSCAN_API_KEY` | Solscan Pro | one call, exact count |
| `HELIUS_API_KEY` | Helius | pages through token accounts, several calls |

They are tried in that order and the first that answers wins. `.env.example` holds the names only, never a value.

Behaviour, by design:

- **No key set** → the function answers `501 not_configured` and the front end **removes the Holders tile**. No dead card, no empty field.
- **Key set** → `{ "holders": n }`, cached in the function for 60 seconds plus a CDN `s-maxage`, so polling every 30 s costs the provider roughly one call a minute.
- **Provider down** → the last good value is served marked `stale`; with nothing cached it returns 502 and the tile keeps whatever it last showed.
- **Too many holders to count exactly** (the Helius path only) → it **fails rather than returning a floor**, because a partial count shown as a total is a wrong number.

$DELIVERY is an SPL **Token-2022** mint (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), not classic SPL Token. The Helius path uses `getTokenAccounts`, which covers both, and skips zero balances so closed accounts do not inflate the count.

`holdersApiUrl` may contain `{mint}`, which is replaced with `contractAddress`. The response is searched for the first of `holders`, `holderCount`, `holder_count`, `total` or `result`, at the top level or inside `data`, so any proxy shape works.

---

## 3. Gallery: adding and removing memes

The gallery reads `assets/gallery/` automatically. Static hosts cannot list a folder, so the loader looks for files named:

```
assets/gallery/meme-01.webp
assets/gallery/meme-02.webp
assets/gallery/meme-03.webp
...
```

`.webp`, `.jpg`, `.jpeg` and `.png` all work. Numbering can have gaps of up to five. Remove a file and it simply disappears; add `meme-15.webp` and it shows up. No code changes.

**Optional custom order:** create `assets/gallery/manifest.json` with a JSON array of filenames, e.g. `["meme-05.webp", "meme-01.webp"]`. If that file exists, it wins over the probing.

**Optimizing new memes** (recommended, keeps the page fast):

```bash
python -m pip install pillow            # once
python tools/optimize-images.py path/to/new-memes --out assets/gallery
```

It converts to WebP (max 1080 px), skips duplicates, and continues the numbering from the highest existing `meme-NN`.

### Banner

`assets/banner.webp` is the wide strip above the gallery, currently the 1280×426 Wall Street banner. Swap the file to change it; `.jpg` and `.png` also work. If the file is missing the strip hides itself and the page is still correct, so nothing in the code needs touching either way.

### Image note

The mascot art and the memes carry the real UPS shield and the "Pump.fun" wordmark, drawn into the artwork itself. That is the project owner's own artwork and their call to publish. The footer states plainly that the project is not affiliated with, endorsed by or sponsored by pump.fun, Solana or UPS.

No third-party logo is used as site furniture: `pump.fun` is written as text everywhere in the interface, and every icon in the SVG sprite is hand-drawn.

If you ever swap in mark-free versions: memes go in `assets/gallery/`, the banner is `assets/banner.webp`, and the brand files are `assets/logo.webp`, `assets/mascot.webp`, the favicons and `assets/og.jpg`.

---

## 4. Deploy

No build step. The folder is served as-is.

**How it is hosted today:** `www.deliveryguyups.com` runs on **Vercel**, wired to this GitHub repo. The bare domain redirects to `www`, which is why the canonical URL, `og:url` and the sitemap all use `https://www.deliveryguyups.com/`.

Vercel builds production from the repo's production branch (`main`), so **a push to `main` goes live**. Pushing any other branch gives a preview deployment on its own URL and leaves the live site alone — that is the safe way to look at a change first.

Settings that matter, if the project is ever recreated: Framework preset **Other**, build command empty, output directory `./` (root).

From a terminal: `npx vercel` for a preview, `npx vercel --prod` to publish.

**Test locally**

```bash
python -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly from disk works too, except the gallery manifest lookup (probing still works).

---

## 5. Facts baked into the site

| | |
|---|---|
| Chain | Solana |
| Launchpad | pump.fun, `https://pump.fun` |
| Mint | `2RbedkHKGCfJ7NyeQBGWSParreAzSeAn6D8GHqLzpump` |
| Explorer | `https://solscan.io` |
| Wallets named in the buy steps | Phantom, Solflare |
| Paired asset | SOL |
| Supply | 1,000,000,000, fixed |
| Fee | 0.3% on every trade, charged by pump.fun |
| Pool | PumpSwap `JDAY2ptw6QikC4PHvsbL4VBGnFKRCc2XpKj2NcQjpZAS` — graduated off the bonding curve |
| Token program | SPL Token-2022, 6 decimals |
| Where the fee goes | **Trader Cashback** — back to the wallets trading the token, not to the creator. Chosen once before launch and irreversible |
| Telegram | `https://t.me/deliveryguyonsol` |
| X | `https://x.com/DeliveryGuy_SOL` |

Solana needs no network to be added to a wallet, so there is no "Add network" button and no chain-id, RPC or EVM code anywhere in this repo.

To change any copy, edit `index.html` directly.

### Trader Cashback: pump.fun reports it as OFF for this token

Checked on 2026-09-11, after launch. pump.fun's own coin record for this mint
returns `is_cashback_enabled: false`.

The field is meaningful, not a stub: of 40 live coins sampled from the same API
on the same day, one returned `true` and 39 returned `false`. Ours is in the
second group.

**The copy on this site says the 0.3% fee goes back to traders as cashback.**
That claim rests on the switch being on. Until either pump.fun reports it as on
for this mint, or the mechanism is confirmed some other way, the claim and the
API disagree, and the API is the one that can be checked. This is flagged, not
silently rewritten, because what the site should say instead is the owner's
call. Do not wire any cashback number into the panel on the strength of the copy.

### Trader Cashback, stated carefully

The site says exactly this and no more: pump.fun charges 0.3% on every trade; the creator chooses once, before launch and irreversibly, between keeping that fee and sending it to traders as cashback; this token sends it to traders; and the reward follows **trading**, so a wallet that buys and sits still earns nothing from it.

**This is not a hold-to-earn token.** Any copy implying that a holder receives a share of fees for holding is wrong and must not be reintroduced.

The payout schedule, the asset it arrives in, and where a trader sees or claims it are pump.fun's to define and are not documented publicly. The site therefore does not state any of them, and points people at pump.fun instead. Do not invent a number here.

## 6. House rules the copy follows

- No "APY", no "passive income", no "guaranteed", no price predictions. Mechanics only.
- The only percentage on the page is the real 0.3% trade fee.
- `pump.fun` in lowercase, always as text, never as a logo. No implied partnership.
- Risk text in the footer: experimental token, cashback depends on other people trading, the token can lose all its value, do your own research.
- No private key or seed phrase input anywhere. Ever.
