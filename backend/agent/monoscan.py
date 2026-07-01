#!/usr/bin/env python3
"""
MonoScan — Local Whole-Computer Deduplication Agent
====================================================
Scans a folder (or your whole drive) recursively, computes SHA-256 for every
file, and sends the hashes to your MonoNode vault so you get a single unified
report of every duplicate file on your computer.

MODES
-----
Default (one-shot scan):
    python3 monoscan.py --root /                        # whole disk (Mac/Linux)
    python3 monoscan.py --root C:\\                      # whole C: drive (Windows)
    python3 monoscan.py --root ~/Downloads               # single folder

Watch mode (continuous):
    python3 monoscan.py --root ~/Downloads --watch      # keep running, hash new files as they appear

Delete duplicates and replace with symlinks (the OS-level enforcer):
    python3 monoscan.py --root ~/Downloads --replace-duplicates
        # scans, then for every duplicate found, offers to replace it with a
        # symbolic link pointing to the canonical copy. Zero data loss, only
        # one instance on disk.

Dry run:
    python3 monoscan.py --root ~ --dry-run

REQUIREMENTS
------------
    Python 3.8+  ·  pip install requests
"""
from __future__ import annotations

import argparse
import hashlib
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
            if not p.is_file() or p.is_symlink():
                continue
            if max_size_bytes and st.st_size > max_size_bytes:
                continue
            yield p, st.st_size


def send_batch(backend: str, items: list, root_label: str, dry_run: bool) -> dict:
    if dry_run:
        return {"scanned": len(items), "added": 0, "duplicates": 0,
                "bytes_saved": 0, "duplicate_details": []}
    resp = requests.post(
        f"{backend.rstrip('/')}/api/files/scan",
        json={"items": items, "root_label": root_label, "source": "agent"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def human_bytes(n: float) -> str:
    for u in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.1f} {u}" if u != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


def hash_and_batch(root: Path, include_hidden: bool, max_bytes: int,
                   backend: str, dry_run: bool, on_progress=None):
    """Yield (batch_result_dict) after each successful batch flush.
    Returns totals dict at the end via StopIteration.value (Python 3)."""
    batch: list = []
    total_scanned = 0
    total_bytes = 0
    total_added = 0
    total_dups = 0
    total_saved = 0
    all_dup_details: list = []
    root_label = str(root)

    def flush():
        nonlocal total_added, total_dups, total_saved
        if not batch:
            return None
        try:
            r = send_batch(backend, batch, root_label, dry_run)
            total_added += r.get("added", 0)
            total_dups += r.get("duplicates", 0)
            total_saved += r.get("bytes_saved", 0)
            all_dup_details.extend(r.get("duplicate_details", []) or [])
            return r
        except Exception as e:
            print(f"[!] batch send failed: {e}", file=sys.stderr)
            return None
        finally:
            batch.clear()

    for p, size in iter_files(root, include_hidden, max_bytes):
        try:
            digest = sha256_of_file(p)
        except (OSError, PermissionError):
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
        if on_progress and total_scanned % 25 == 0:
            on_progress(total_scanned, total_bytes, p)
        if len(batch) >= BATCH_SIZE:
            flush()

    flush()
    return {
        "scanned": total_scanned,
        "bytes": total_bytes,
        "added": total_added,
        "duplicates": total_dups,
        "saved": total_saved,
        "duplicate_details": all_dup_details,
    }


def do_replace_duplicates(dup_details: list, assume_yes: bool) -> tuple:
    """For each duplicate, remove the duplicate file and create a symlink
    pointing to the existing_path. Cross-platform (symlink; on Windows may
    require Developer Mode or admin)."""
    replaced = 0
    freed = 0
    skipped = 0
    errors: list = []

    for d in dup_details:
        dup = d.get("scanned_path")
        original = d.get("existing_path")
        if not dup or not original:
            skipped += 1
            continue
        dup_p = Path(dup)
        orig_p = Path(original)
        if not dup_p.exists() or dup_p.is_symlink():
            skipped += 1
            continue
        if not orig_p.exists():
            skipped += 1
            continue
        if dup_p.resolve() == orig_p.resolve():
            skipped += 1
            continue

        if not assume_yes:
            ans = input(f"    replace {dup} -> symlink to {original}? [y/N] ").strip().lower()
            if ans not in ("y", "yes"):
                skipped += 1
                continue

        try:
            size = dup_p.stat().st_size
            dup_p.unlink()
            os.symlink(orig_p, dup_p)
            replaced += 1
            freed += size
            print(f"    [✓] symlinked :: {dup}")
        except OSError as e:
            errors.append(f"{dup}: {e}")
            print(f"    [!] failed {dup}: {e}", file=sys.stderr)

    return replaced, freed, skipped, errors


def cmd_scan(args):
    root = Path(os.path.expanduser(args.root)).resolve()
    if not root.exists():
        print(f"[!] Path does not exist: {root}", file=sys.stderr)
        return 2

    print(f"[*] MonoScan · one-shot scan")
    print(f"    root     : {root}")
    print(f"    backend  : {args.backend}")
    print(f"    dry_run  : {args.dry_run}")
    print(f"    max size : {args.max_size_mb} MB")
    print()

    max_bytes = args.max_size_mb * 1024 * 1024
    started = time.time()

    def prog(n, b, p):
        print(f"    scanned {n} files · {human_bytes(b)} · last: {p}")

    totals = hash_and_batch(root, args.include_hidden, max_bytes,
                            args.backend, args.dry_run, on_progress=prog)

    dur = time.time() - started
    print()
    print("[✓] MonoScan complete")
    print(f"    files scanned  : {totals['scanned']}")
    print(f"    bytes scanned  : {human_bytes(totals['bytes'])}")
    print(f"    added to vault : {totals['added']}")
    print(f"    duplicates     : {totals['duplicates']}")
    print(f"    memory saved   : {human_bytes(totals['saved'])}")
    print(f"    elapsed        : {dur:.1f}s")
    print()

    if args.replace_duplicates and totals["duplicate_details"]:
        print(f"[?] Replacing {len(totals['duplicate_details'])} duplicates with symlinks…")
        if not args.yes:
            print("    (pass --yes to skip individual prompts)")
        r, f, s, errs = do_replace_duplicates(totals["duplicate_details"], args.yes)
        print()
        print(f"[✓] Symlink replacement done")
        print(f"    replaced : {r}")
        print(f"    freed    : {human_bytes(f)}")
        print(f"    skipped  : {s}")
        if errs:
            print(f"    errors   : {len(errs)}")

    if not args.dry_run:
        print(f"\n    → Open your dashboard: {args.backend}")
    return 0


def cmd_watch(args):
    """Poll the root directory periodically and hash any new files.
    No external deps — just re-walks and skips already-seen paths."""
    root = Path(os.path.expanduser(args.root)).resolve()
    if not root.exists():
        print(f"[!] Path does not exist: {root}", file=sys.stderr)
        return 2

    print(f"[*] MonoScan · watch mode (Ctrl+C to stop)")
    print(f"    root     : {root}")
    print(f"    backend  : {args.backend}")
    print(f"    interval : {args.interval}s")
    print()

    max_bytes = args.max_size_mb * 1024 * 1024
    known: set = set()

    # initial index of existing paths so we only report NEW files after this point
    for p, _ in iter_files(root, args.include_hidden, max_bytes):
        known.add(str(p))
    print(f"    [i] baseline indexed :: {len(known)} files known · watching for new arrivals…")

    try:
        while True:
            time.sleep(args.interval)
            new_batch: list = []
            for p, size in iter_files(root, args.include_hidden, max_bytes):
                sp = str(p)
                if sp in known:
                    continue
                try:
                    digest = sha256_of_file(p)
                except (OSError, PermissionError):
                    continue
                mime, _ = mimetypes.guess_type(p.name)
                new_batch.append({
                    "filename": p.name, "size": size, "sha256": digest,
                    "relative_path": sp, "mime_type": mime or "",
                })
                known.add(sp)

            if new_batch:
                print(f"    [+] {len(new_batch)} new file(s) detected")
                try:
                    r = send_batch(args.backend, new_batch, str(root), args.dry_run)
                    print(f"        added={r.get('added',0)} duplicates={r.get('duplicates',0)} "
                          f"saved={human_bytes(r.get('bytes_saved',0))}")
                    for d in (r.get("duplicate_details") or []):
                        print(f"        [!] duplicate :: {d['scanned_path']}")
                        print(f"            already at :: {d['existing_path']}")
                except Exception as e:
                    print(f"    [!] send failed: {e}", file=sys.stderr)
    except KeyboardInterrupt:
        print("\n[*] Watch mode stopped.")
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="MonoScan — whole-computer dedup agent")
    ap.add_argument("--root", required=True, help="Folder to scan (e.g. / or C:\\ or ~/Downloads)")
    ap.add_argument("--backend", default=DEFAULT_BACKEND, help="MonoNode backend URL")
    ap.add_argument("--include-hidden", action="store_true", help="Include hidden files/folders")
    ap.add_argument("--max-size-mb", type=int, default=2048, help="Skip files > N MB (default 2048)")
    ap.add_argument("--dry-run", action="store_true", help="Hash & report but do not send to vault")
    ap.add_argument("--watch", action="store_true", help="Watch mode: keep running, hash new files as they arrive")
    ap.add_argument("--interval", type=int, default=10, help="Watch mode poll interval (seconds)")
    ap.add_argument("--replace-duplicates", action="store_true",
                    help="After scan, replace duplicates with symlinks to the canonical copy")
    ap.add_argument("--yes", action="store_true", help="Assume yes to all prompts (use with --replace-duplicates)")
    args = ap.parse_args()

    if args.watch:
        return cmd_watch(args)
    return cmd_scan(args)


if __name__ == "__main__":
    raise SystemExit(main())
