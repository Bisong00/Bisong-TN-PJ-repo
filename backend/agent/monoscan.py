#!/usr/bin/env python3
"""
MonoScan — Local Whole-Computer Deduplication Agent
====================================================
Scans a folder (or your whole drive) recursively, computes SHA-256 for every
file, and sends the hashes to your MonoNode vault so you get a single unified
report of every duplicate file living on your computer.

USAGE
-----
    python3 monoscan.py --root /                        # scan whole disk (Mac/Linux)
    python3 monoscan.py --root C:\\                      # scan C: drive (Windows)
    python3 monoscan.py --root ~/Downloads               # scan just Downloads
    python3 monoscan.py --root . --max-size-mb 500       # skip files > 500MB
    python3 monoscan.py --root ~ --dry-run               # scan but do not send

REQUIREMENTS
------------
    Python 3.8+.  Only stdlib + `requests`.
        pip install requests

The agent will:
  * skip hidden folders (starting with `.`) unless --include-hidden
  * skip common noisy system paths (node_modules, .git, __pycache__, $RECYCLE.BIN, System Volume Information, etc.)
  * batch upload hashes in groups of 200 to the /api/files/scan endpoint
  * print a summary at the end and open the dashboard URL
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.stderr.write(
        "\n[!] The 'requests' library is required. Install with:\n"
        "    pip install requests\n\n"
    )
    sys.exit(1)


DEFAULT_BACKEND = "__BACKEND_URL__"  # replaced by /api/agent/monoscan.py endpoint
BATCH_SIZE = 200
SKIP_DIR_NAMES = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache",
    "$RECYCLE.BIN", "System Volume Information", ".Trash", ".Trashes",
    "AppData", "Library/Caches",
}


def sha256_of_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            data = f.read(chunk_size)
            if not data:
                break
            h.update(data)
    return h.hexdigest()


def iter_files(root: Path, include_hidden: bool, max_size_bytes: int):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        # prune noisy dirs in-place
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIR_NAMES and (include_hidden or not d.startswith("."))
        ]
        for name in filenames:
            if not include_hidden and name.startswith("."):
                continue
            p = Path(dirpath) / name
            try:
                st = p.stat()
            except (OSError, PermissionError):
                continue
            if not p.is_file():
                continue
            if max_size_bytes and st.st_size > max_size_bytes:
                continue
            yield p, st.st_size


def send_batch(backend: str, items: list, root_label: str, dry_run: bool) -> dict:
    if dry_run:
        return {"scanned": len(items), "added": 0, "duplicates": 0, "bytes_saved": 0}
    resp = requests.post(
        f"{backend.rstrip('/')}/api/files/scan",
        json={"items": items, "root_label": root_label, "source": "agent"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def human_bytes(n: int) -> str:
    for u in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.1f} {u}" if u != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} PB"


def main() -> int:
    ap = argparse.ArgumentParser(description="MonoScan — whole-computer dedup agent")
    ap.add_argument("--root", required=True, help="Folder to scan recursively (e.g. / or C:\\ or ~/Downloads)")
    ap.add_argument("--backend", default=DEFAULT_BACKEND, help="MonoNode backend URL")
    ap.add_argument("--include-hidden", action="store_true", help="Include hidden files/folders")
    ap.add_argument("--max-size-mb", type=int, default=2048, help="Skip files larger than N MB (default 2048)")
    ap.add_argument("--dry-run", action="store_true", help="Hash & report locally; do not send to vault")
    args = ap.parse_args()

    root = Path(os.path.expanduser(args.root)).resolve()
    if not root.exists():
        print(f"[!] Path does not exist: {root}", file=sys.stderr)
        return 2

    print(f"[*] MonoScan starting")
    print(f"    root     : {root}")
    print(f"    backend  : {args.backend}")
    print(f"    dry_run  : {args.dry_run}")
    print(f"    max size : {args.max_size_mb} MB")
    print()

    max_bytes = args.max_size_mb * 1024 * 1024
    batch: list = []
    total_scanned = 0
    total_bytes = 0
    total_added = 0
    total_dups = 0
    total_saved = 0
    started = time.time()

    def flush():
        nonlocal total_added, total_dups, total_saved
        if not batch:
            return
        try:
            r = send_batch(args.backend, batch, str(root), args.dry_run)
            total_added += r.get("added", 0)
            total_dups += r.get("duplicates", 0)
            total_saved += r.get("bytes_saved", 0)
        except Exception as e:
            print(f"[!] batch send failed: {e}", file=sys.stderr)
        batch.clear()

    for p, size in iter_files(root, args.include_hidden, max_bytes):
        try:
            digest = sha256_of_file(p)
        except (OSError, PermissionError) as e:
            continue
        mime, _ = mimetypes.guess_type(p.name)
        batch.append({
            "filename": p.name,
            "size": size,
            "sha256": digest,
            "relative_path": str(p),
            "mime_type": mime or "",
        })
        total_scanned += 1
        total_bytes += size
        if total_scanned % 25 == 0:
            print(f"    scanned {total_scanned} files · {human_bytes(total_bytes)} · last: {p}")
        if len(batch) >= BATCH_SIZE:
            flush()

    flush()

    dur = time.time() - started
    print()
    print("[✓] MonoScan complete")
    print(f"    files scanned  : {total_scanned}")
    print(f"    bytes scanned  : {human_bytes(total_bytes)}")
    print(f"    added to vault : {total_added}")
    print(f"    duplicates     : {total_dups}")
    print(f"    memory saved   : {human_bytes(total_saved)}")
    print(f"    elapsed        : {dur:.1f}s")
    print()
    if not args.dry_run:
        print(f"    → Open your dashboard: {args.backend}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
