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

## 1. After launch: fill in CONFIG

Open `main.js`. The first thing in the file is:

```js
const CONFIG = {
  contractAddress: null,
  buyUrl: null,
  dexscreener: null,
  dextools: null,
  coinmarketcap: null,
  coingecko: null,

  upsTokenAddress: null,
  distributorAddress: null,
  totalDistributedCall: null,
};
```

Fill in what you have. Everything else stays `null`. No other file needs to change.

| Key | What to paste | What it switches on |
|---|---|---|
| `contractAddress` | `$DELIVERY` token address, `0x…` | CA in topbar + hero, copy button, Blockscout link, live panel |
| `buyUrl` | pons trade page. **Optional**: if you leave it `null` and `contractAddress` is set, the site uses `https://www.ponsfamily.com/launchpad/<contractAddress>` (that is the pattern pons uses) | All "Buy" buttons go live |
| `dexscreener`, `dextools`, `coinmarketcap`, `coingecko` | Full URLs | Chips under the live panel. Missing ones are removed from the page, never shown as dead links |
| `upsTokenAddress` | UPS stock token contract on Robinhood Chain | Needed for the distribution stats |
| `distributorAddress` | The contract that sends UPS to holders (the token vault for this launch) | "Total UPS delivered", "Last payout", countdown anchoring |
| `totalDistributedCall` | Optional `{ to: '0x…', data: '0x…' }` for an `eth_call` that returns the lifetime total as `uint256` | Exact lifetime total. Without it the site sums recent payouts from Blockscout and shows "≈" |

Before launch the site shows: buy buttons as **"Launching soon"**, **"CA revealed at launch"**, stats as **—** with "Live after launch".

### Where the live numbers come from

| Stat | Source |
|---|---|
| Supply, decimals | Robinhood Chain RPC (`eth_call`) |
| Holders | Blockscout API v2 (`/api/v2/tokens/<address>`) |
| Price in UPS, USD, market cap | DEXScreener public API (needs a pair to be indexed) |
| Total distributed, last payout | Blockscout token transfers sent by `distributorAddress` in `upsTokenAddress`, or `totalDistributedCall` |
| Countdown | Anchored to the last payout time when known, otherwise to 5-minute wall-clock marks |

If a source is down, the panel keeps the last known values (cached in the browser) with an "Updated HH:MM" stamp and the status "Reconnecting". It never shows a spinner forever.

> **Once the pons holder-distribution setting is live**, put the vault/distributor contract in `distributorAddress` and the UPS token in `upsTokenAddress`. The reader assumes UPS leaves that contract as ERC-20 transfers to holders. If the vault exposes a lifetime-total view, add it as `totalDistributedCall` for an exact figure. Anything else lives in `readDistributions()` in `main.js`, one self-contained function.

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
| Paired asset | UPS stock token |
| Supply | 1,000,000,000, fixed |
| Fee | 1% of every trade, in UPS |
| Distribution | to all holders, every 5 minutes, in UPS |
| Telegram | `https://t.me/deliveryguytg` |
| X | `https://x.com/DeliveryGuyRHoo` |

To change any copy, edit `index.html` directly. The "Add network to wallet" button calls `wallet_addEthereumChain` with the values in the `CHAIN` object at the top of `main.js`.

## 5. House rules the copy follows

- No "APY", "earn", "passive income", "guaranteed", no price predictions. Mechanics only.
- `pons` in lowercase.
- Risk text in the footer, including the US restriction for UPS-paired markets on pons.
- No private key or seed phrase input anywhere. Ever.
