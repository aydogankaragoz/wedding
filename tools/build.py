#!/usr/bin/env python3
"""Build the encrypted gallery.

Usage:
  GALLERY_PASSWORD='...' GITHUB_REPO='user/repo' python3 tools/build.py SOURCE_DIR

Produces (in the repo root):
  data/config.json          public: salt + iterations (needed to derive the key)
  data/manifest.bin         encrypted JSON: groups, photos, original download URLs
  t/<id>.bin                encrypted thumbnails (~480px)
  p/<id>.bin                encrypted previews (~2048px)
  originals/                plain copies of the originals, deduplicated, for upload
                            to a GitHub Release (git-ignored)

Every .bin file is: 12-byte IV || AES-256-GCM ciphertext.
Key = PBKDF2-HMAC-SHA256(password, salt, ITER). Re-running with the same
password reuses the salt and skips images already built.
"""
import hashlib, io, json, os, secrets, shutil, sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = Path(__file__).resolve().parent.parent
ITER = 310_000
THUMB, THUMB_Q = 480, 72
PREVIEW, PREVIEW_Q = 2048, 80
GAP_SECONDS = 15 * 60          # a pause this long starts a new group
RELEASE_TAG = "originals"

def derive_key(password, salt):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER)
    return kdf.derive(password.encode())

def encrypt(key, data):
    iv = secrets.token_bytes(12)
    return iv + AESGCM(key).encrypt(iv, data, None)

def jpeg(im, size, q):
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return buf.getvalue()

def taken_at(im):
    ex = im.getexif()
    s = ex.get_ifd(0x8769).get(36867) or ex.get(306)
    return datetime.strptime(s, "%Y:%m:%d %H:%M:%S") if s else None

def process(args):
    path, pid, key = args
    tp, pp = ROOT / "t" / f"{pid}.bin", ROOT / "p" / f"{pid}.bin"
    with Image.open(path) as im:
        when = taken_at(im)
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        if not (tp.exists() and pp.exists()):
            tp.write_bytes(encrypt(key, jpeg(im, THUMB, THUMB_Q)))
            pp.write_bytes(encrypt(key, jpeg(im, PREVIEW, PREVIEW_Q)))
    return pid, when, w, h

def main():
    src = Path(sys.argv[1]).expanduser()
    password = os.environ["GALLERY_PASSWORD"]
    repo = os.environ["GITHUB_REPO"]

    cfg_path = ROOT / "data" / "config.json"
    (ROOT / "data").mkdir(exist_ok=True)
    for d in ("t", "p", "originals"):
        (ROOT / d).mkdir(exist_ok=True)
    salt_hex = None
    if cfg_path.exists():
        salt_hex = json.loads(cfg_path.read_text())["salt"]
    key = derive_key(password, bytes.fromhex(salt_hex)) if salt_hex else None
    check = ROOT / "data" / "check.txt"
    if key and (not check.exists() or check.read_text() != hashlib.sha256(key).hexdigest()):
        print("Password changed -> rebuilding everything with a new salt")
        for d in ("t", "p"):
            shutil.rmtree(ROOT / d); (ROOT / d).mkdir()
        key = None
    if not key:
        salt_hex = secrets.token_hex(16)
        key = derive_key(password, bytes.fromhex(salt_hex))
    cfg_path.write_text(json.dumps({"salt": salt_hex, "iter": ITER}))
    check.write_text(hashlib.sha256(key).hexdigest())   # git-ignored

    # Deduplicate by content; id = short hash of content (stable across runs)
    seen = {}
    for p in sorted(src.rglob("*")):
        if p.suffix.lower() not in (".jpg", ".jpeg") or p.name.startswith("."):
            continue
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        seen.setdefault(h, p)
    print(f"{len(seen)} unique photos")

    jobs = [(p, h[:16], key) for h, p in seen.items()]
    with ProcessPoolExecutor() as ex:
        results = list(ex.map(process, jobs, chunksize=4))
    paths = {h[:16]: p for h, p in seen.items()}

    photos = []
    for pid, when, w, h in results:
        p = paths[pid]
        name = p.name
        dst = ROOT / "originals" / name
        if dst.exists() and dst.stat().st_size != p.stat().st_size:
            name = f"{p.stem}_{pid[:6]}{p.suffix}"; dst = ROOT / "originals" / name
        if not dst.exists():
            os.link(p, dst) if os.stat(p).st_dev == os.stat(ROOT).st_dev else shutil.copy2(p, dst)
        photos.append({"id": pid, "name": name, "t": when.isoformat() if when else None,
                       "w": w, "h": h, "size": p.stat().st_size,
                       "url": f"https://github.com/{repo}/releases/download/{RELEASE_TAG}/{name}"})
    photos.sort(key=lambda x: (x["t"] or "", x["name"]))

    # Group by pauses in shooting
    titles_path = ROOT / "tools" / "group_titles.json"
    titles = json.loads(titles_path.read_text()) if titles_path.exists() else []
    groups, prev = [], None
    for ph in photos:
        t = datetime.fromisoformat(ph["t"]) if ph["t"] else None
        if not groups or (t and prev and (t - prev).total_seconds() > GAP_SECONDS):
            groups.append({"photos": []})
        groups[-1]["photos"].append(ph)
        prev = t or prev
    for i, g in enumerate(groups):
        g["title"] = titles[i] if i < len(titles) else ""
        g["start"], g["end"] = g["photos"][0]["t"], g["photos"][-1]["t"]

    manifest = {"title": os.environ.get("GALLERY_TITLE", "Düğün"), "groups": groups}
    (ROOT / "data" / "manifest.bin").write_bytes(
        encrypt(key, json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()))

    # Remove stale encrypted files
    ids = {ph["id"] for ph in photos}
    for d in ("t", "p"):
        for f in (ROOT / d).iterdir():
            if f.stem not in ids:
                f.unlink()
    print(f"{len(groups)} groups:", [len(g["photos"]) for g in groups])

if __name__ == "__main__":
    main()
