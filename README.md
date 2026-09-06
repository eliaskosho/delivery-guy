# Delivery Guy — deliveryguy.xyz

Marketing site for **Delivery Guy ($DELIVERY)** on Robinhood Chain.
Plain HTML, CSS and vanilla JS. No framework, no build step, no npm.

```
index.html          the whole page
styles.css          styles (dark base, lime accent #c5fa07)
main.js             CONFIG + all behaviour (live panel, gallery, wallet button)
assets/
  logo.webp         square mascot logo (topbar, footer)
  mascot.webp       cut-out mascot (hero)
  og.jpg            1200×630 social preview
  favicon-*.png, apple-touch-icon.png
  banner.webp       wide banner shown above the gallery
  gallery/          memes shown on the site (read automatically, meme-01.webp ...)
tools/
  optimize-images.py  resizes + converts memes to WebP and names them meme-NN.webp
```

---

## 1. CONFIG (launch data)

Open `main.js`. The first thing in the file is the `CONFIG` block. It is the only thing you edit; every other file reads from it.

| Key | Current value | What it switches on |
|---|---|---|
| `contractAddress` | `0x9A88…0989` | CA in topbar + hero, copy button, Blockscout link, live panel |
| `buyUrl` | pons trade page for the token | Every "Buy" button and the footer pons link. If `null`, derived as `https://www.ponsfamily.com/launchpad/<contractAddress>` |
| `dexscreener` | pair page on DEXScreener | Hero button, chip under the live panel, footer link. The pair id in the URL is also what the live panel reads price, market cap and 24 h volume from |
| `dextools`, `coinmarketcap`, `coingecko` | `null` until listed | Chips under the live panel. `null` = removed from the page, never a dead link |
| `explorer` | Blockscout token page | All "Blockscout" links. `null` = derived from the chain explorer + `contractAddress` |
| `telegram`, `x` | community links | Every Telegram / X link on the page |
| `upsTokenAddress` | UPS stock token on Robinhood Chain | Distribution stats |
| `distributorAddress` | pons holder-distributor for this launch (the pool's creator-fee recipient) | "Total UPS delivered", "Last payout", measured cadence |
| `distributionFromBlock` | block just before the pool went live | Where the payout scan starts. Without it the scan is capped to the last ~3.5 days and the total is shown with "≈" |
| `feeEscrowAddress` | pons V2 fee escrow | "… UPS collected, waiting for the next payout" under the total |
| `totalDistributedCall` | `null` | Optional `{ to, data }` `eth_call` returning the lifetime total as `uint256`. Without it the site sums payouts read from Blockscout and shows "≈" |

Setting a key back to `null` returns that part of the page to its pre-launch state ("Launching soon", "CA revealed at launch", stats as "—").

### Where the live numbers come from

| Stat | Source |
|---|---|
| Supply, decimals | Robinhood Chain RPC (`eth_call`) |
| Holders | Blockscout API v2 (`/api/v2/tokens/<address>`, fallback `/counters`) |
| Price, market cap, 24 h volume, trade count | DEXScreener public API, pair taken from `dexscreener` |
| Total distributed, last payout, round count | Robinhood Chain RPC: `eth_getLogs` for UPS transfers sent by `distributorAddress` since `distributionFromBlock`, chunked (250k blocks, halved on failure) and cached in the browser so only new blocks are scanned on refresh. Blockscout as a bounded fallback; `totalDistributedCall` if set |
| UPS collected, waiting for payout | `feeEscrowAddress.balanceOfToken(distributorAddress, upsTokenAddress)` via RPC |
| Countdown | Median gap between the newest payout rounds (up to 8), counted from the last round. Shows "—" until two rounds exist. Never a fixed interval |

If a source is down, the panel keeps the last known values (cached in the browser) with an "Updated HH:MM" stamp and the status "Reconnecting". It never shows a spinner forever.

### How the fee reaches holders (as observed on-chain, 2026-09-06)

Every swap in the UPS pool pays its fee to the pons hook, which sweeps it into the pons fee escrow. The escrow credits the creator side to `distributorAddress`, a pons holder-distributor proxy, and the protocol side to a protocol address. A pons keeper claims the distributor's balance and multi-sends UPS to holders in one transaction; each round shows up as ERC-20 transfers from `distributorAddress`, which is what the live panel reads.

Measured on launch night: the first round landed 2 h 23 min after launch, then rounds came roughly every 45 minutes (43 to 47 min over 7 rounds). Each round pays only holders whose share is above a small minimum (about 0.015 UPS); smaller shares are skipped that round. The panel says "No payout yet" until the first round lands, shows the escrow balance collected so far, and only counts down once two real rounds exist.

UPS amounts are summed in raw units and displayed through the token's ERC-8056 `uiMultiplier()` (about 1.0022 at launch). USD values use the UPS price implied by the DEXScreener pair.

---

## 2. Gallery: adding and removing memes

The gallery reads `assets/gallery/` automatically. Static hosts cannot list a folder, so the loader looks for files named:

```
assets/gallery/meme-01.webp
assets/gallery/meme-02.webp
assets/gallery/meme-03.webp
...
```

`.webp`, `.jpg`, `.jpeg` and `.png` all work. Numbering can have gaps of up to five. Remove a file and it simply disappears; add `meme-24.webp` and it shows up. No code changes.

**Optional custom order:** create `assets/gallery/manifest.json` with a JSON array of filenames, e.g. `["meme-05.webp", "meme-01.webp"]`. If that file exists, it wins over the probing.

**Optimizing new memes** (recommended, keeps the page fast):

```bash
python -m pip install pillow            # once
python tools/optimize-images.py path/to/new-memes --out assets/gallery
```

It converts to WebP (max 1080 px), skips duplicates, and continues the numbering from the highest existing `meme-NN`.

### Image note

Every meme and the banner carry the feather mark, and most show the "Robinhood" wordmark on a van, scooter, bike or box. The logo and mascot carry the feather too. The project owner reviewed this on 2026-09-05 and chose to publish them as they are.

If you ever swap in mark-free versions: memes go in `assets/gallery/`, the banner is `assets/banner.webp` (the strip above the gallery disappears if the file is missing), and the brand files are `assets/logo.webp`, `assets/mascot.webp`, the favicons and `assets/og.jpg`.

---

## 3. Deploy

No build step. Upload the folder as-is.

**Vercel**
1. Push this folder to a Git repo (GitHub, GitLab).
2. vercel.com → Add New Project → import the repo.
3. Framework preset: **Other**. Build command: empty. Output directory: `./` (root).
4. Deploy. Add `deliveryguy.xyz` under Settings → Domains and point the DNS as Vercel shows.

Or from a terminal: `npx vercel --prod` inside the folder.

**GitHub Pages**
1. Push to a repo. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
2. Add a file named `CNAME` containing `deliveryguy.xyz` and point your DNS (A records to GitHub Pages IPs, or a CNAME for `www`).

**Test locally**

```bash
python -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly from disk works too, except the gallery manifest lookup (probing still works).

---

## 4. Facts baked into the site

| | |
|---|---|
| Chain | Robinhood Chain, chain ID 4663 (`0x1237`), Arbitrum Orbit L2, gas in ETH |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Launchpad | pons V2, `https://www.ponsfamily.com/launchpad` |
| Contract | `0x9A881D5cC0A1Ff529AeF0F0A79D6BeEFF6e90989` (verified on Blockscout as `PonsV2LauncherToken`) |
| Pair | UPS / DELIVERY, DEXScreener id `0x21c17bf5…de2c1`, launched 2026-09-05 22:39 UTC |
| Paired asset | UPS stock token, `0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2` |
| Supply | 1,000,000,000, fixed |
| Fee | A cut of every swap, in UPS. 1% creator tax on the bonding curve; after graduation the pool fee (about 0.3% measured), ~85% of it credited to the holder distributor |
| Distribution | to holders, in UPS, in automatic rounds run by the pons keeper. Measured ~45 min apart on launch night; minimum ~0.015 UPS per holder per round. The live panel shows the real cadence |
| Telegram | `https://t.me/deliveryguytg` |
| X | `https://x.com/DeliveryGuyRHoo` |

To change any copy, edit `index.html` directly. The "Add network to wallet" button calls `wallet_addEthereumChain` with the values in the `CHAIN` object at the top of `main.js`.

## 5. House rules the copy follows

- No "APY", "earn", "passive income", "guaranteed", no price predictions. Mechanics only.
- `pons` in lowercase.
- Risk text in the footer, including the US restriction for UPS-paired markets on pons.
- No private key or seed phrase input anywhere. Ever.
