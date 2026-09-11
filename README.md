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
| `holdersApiUrl` | `null` | The Holders tile. `null` = the tile is removed from the panel. See section 2 |

The contract address is a Solana **mint address**: base58, 32–44 characters, no `0`, `O`, `I` or `l`. It is validated against that, shortened as `2Rbe…zpump` in the topbar chip, and shown in full in the hero. Copy buttons always copy the full 44 characters, never the shortened form.

### Where the live numbers come from

| Stat | Source |
|---|---|
| Price, market cap, liquidity | DEXScreener, `GET /latest/dex/tokens/<mint>` |
| 24 h volume, 24 h trades (buys + sells) | same call |
| Holders | only if `holdersApiUrl` is set — see section 2 |

The response is an array of pairs. The site picks the deepest one by USD liquidity and breaks ties on 24 h volume, because while the token is still on the bonding curve DEXScreener reports no liquidity figure at all. Before the first trade the API answers `"pairs": null`, and the panel says *Waiting for the first trade* rather than showing an error.

**Note it is the `tokens` endpoint, not `pairs`.** The address above is the mint, and a mint has no pair address until something trades.

If a refresh fails, the last known values stay on screen with a timestamp and a *Showing last known values* note. There is no spinner that can hang, and no tile ever goes blank without saying why.

### What the panel deliberately does not show

There is **no payout countdown and no distribution total**. How pump.fun accounts for Trader Cashback on-chain is not publicly documented, so there is nothing here that can be read and verified. Rather than leave two dead cards in the panel, those tiles were removed. Do not add a timer for a payout whose cadence you cannot prove.

---

## 2. Holder count (optional, off by default)

Solana's public RPC cannot give a holder total. `getTokenLargestAccounts` returns the top accounts only, and `getProgramAccounts` over the token program is disabled on public endpoints (and would be far too large for a browser anyway). A real total needs an indexer — Helius, Birdeye or Solscan Pro — and all of them require an API key.

**This site is static.** It has no server and no build step, so anything written into `main.js` is readable by anyone who opens the page. Do not paste a private API key into this repo.

The workable options:

1. **Leave it off** (default). `holdersApiUrl: null` removes the tile and the panel shows four live tiles.
2. **Put a small proxy in front of it.** A serverless function that holds the key server-side, calls the indexer, and answers with JSON. Point `holdersApiUrl` at the proxy. `.env.example` lists the variables such a proxy would read.

`holdersApiUrl` may contain `{mint}`, which is replaced with `contractAddress`. The response is searched for the first of `holders`, `holderCount`, `holder_count`, `total` or `result`, at the top level or inside `data`.

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
| Where the fee goes | **Trader Cashback** — back to the wallets trading the token, not to the creator. Chosen once before launch and irreversible |
| Telegram | `https://t.me/deliveryguyonsol` |
| X | `https://x.com/DeliveryGuy_SOL` |

Solana needs no network to be added to a wallet, so there is no "Add network" button and no chain-id, RPC or EVM code anywhere in this repo.

To change any copy, edit `index.html` directly.

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
