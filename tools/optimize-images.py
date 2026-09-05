#!/usr/bin/env python3
"""
Optimize meme images for the gallery.

Usage:
  python tools/optimize-images.py <source-folder> [--out assets/gallery] [--max 1080] [--quality 80]

- Reads every .png/.jpg/.jpeg/.webp in <source-folder> (sorted by filename)
- Skips exact duplicates (same file hash) within the batch
- Resizes so the longest side is at most --max pixels
- Saves as WebP, named meme-01.webp, meme-02.webp, ... continuing from the
  highest number already present in --out, so you can add batches later.

Requires Pillow:  python -m pip install pillow
"""
import argparse, hashlib, os, re, sys
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is missing. Install it with:  python -m pip install pillow")

ap = argparse.ArgumentParser()
ap.add_argument("source")
ap.add_argument("--out", default=os.path.join("assets", "gallery"))
ap.add_argument("--max", type=int, default=1080)
ap.add_argument("--quality", type=int, default=80)
args = ap.parse_args()

os.makedirs(args.out, exist_ok=True)
existing = [int(m.group(1)) for f in os.listdir(args.out)
            for m in [re.match(r"meme-(\d+)\.(webp|jpg|jpeg|png)$", f, re.I)] if m]
n = max(existing, default=0)

seen = set()
files = sorted(f for f in os.listdir(args.source)
               if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
if not files:
    sys.exit(f"No images found in {args.source}")

for f in files:
    src = os.path.join(args.source, f)
    h = hashlib.md5(open(src, "rb").read()).hexdigest()
    if h in seen:
        print(f"skip duplicate  {f}"); continue
    seen.add(h)
    im = Image.open(src)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    im.thumbnail((args.max, args.max), Image.LANCZOS)
    n += 1
    dst = os.path.join(args.out, f"meme-{n:02d}.webp")
    im.save(dst, "WEBP", quality=args.quality, method=6)
    print(f"{f:45s} -> {os.path.basename(dst)}  {im.size[0]}x{im.size[1]}  {os.path.getsize(dst)//1024} KB")

print(f"\nDone. {n} image(s) now in {args.out}")
