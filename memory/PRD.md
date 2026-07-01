# MonoNode — Memory Vault (Whole-Computer Deduplication)

## Original Problem Statement
> User wants OS-level dedup so that no file/app is duplicated anywhere in computer memory. Shows path to existing copy when a duplicate is detected. Covers PDFs, docs, images, audios, videos, installers.

## Architecture
- **Backend (FastAPI + MongoDB)**
  - `POST /api/files/upload` — single-file multipart upload, SHA-256 dedup
  - `POST /api/files/register` — metadata-only registration
  - `POST /api/files/scan` — bulk hash batch (prefetch + insert_many); correctly labels batch_duplicate vs vault_match
  - `GET /api/files` · `DELETE /api/files/{id}`
  - `GET /api/files/export?format=csv|json` — full vault export
  - `POST/GET/DELETE /api/apps` — dedup by name+version (case-insensitive)
  - `GET /api/apps/export?format=csv|json`
  - `GET /api/stats` — totals, duplicates_prevented, bytes_saved, by_category
  - `GET /api/agent/monoscan.py?request_backend=…` — serves the local agent with backend URL baked in
- **Local Agent (`/app/backend/agent/monoscan.py`)**
  - One-shot scan: `--root <path>`
  - Continuous watch mode: `--watch` (polls periodically, hashes only new files, no external deps)
  - OS-level enforcer: `--replace-duplicates --yes` (deletes duplicates and replaces with symlinks to the canonical copy — real "one file on disk" semantics)
  - Skips hidden dirs, node_modules, .git, $RECYCLE.BIN, System Volume Information by default
- **Packaging** (see `/app/backend/agent/PACKAGING.md`)
  - PyInstaller commands for Windows .exe, Mac .pkg, Linux .deb / AppImage
  - launchd / Task Scheduler / systemd auto-schedule snippets included
- **Frontend (React + Tailwind)**
  - Tabs: Overview · Files · Full Scan · Applications
  - Drag-drop single upload + collision modal
  - Browser folder scan (webkitdirectory + SubtleCrypto SHA-256, contents never leave the browser)
  - Agent tab with per-OS command switcher (Mac/Windows/Linux) + copy + download
  - Export buttons (CSV/JSON) on both Files and Apps tabs
  - Distinctive "Data Vault" terminal aesthetic (IBM Plex, orange/black, sharp edges, scanlines)

## Reality Notes
- Browsers cannot silently scan the whole OS — sandbox rule. The agent solves this.
- Bytes never leave the user's machine — only SHA-256 hashes + paths.
- Symlink replacement on Windows requires Developer Mode or admin privileges.

## Implemented (Jan 2026)
- ✅ Upload dedup with collision modal
- ✅ Files/Apps registries with search, filters, delete
- ✅ Applications case-insensitive name+version dedup
- ✅ Dashboard stats + distribution by category
- ✅ Browser folder-scan (whole tree, client-side hash)
- ✅ Local Python agent (whole-disk scan, watch mode, symlink replacement)
- ✅ CSV/JSON export for files and apps
- ✅ Correct batch_duplicate vs vault_match labeling
- ✅ Bulk optimized scan (single $in prefetch + insert_many)
- ✅ Per-OS packaging documentation with signing/notarising steps
- ✅ Distinctive "Data Vault" UI
- ✅ Testing agent: 100% (backend 13/13, frontend 100%) across 3 iterations

## Backlog
- **P1**: Streaming CSV export for very large vaults (100k+ rows)
- **P2**: Refactor App.js into per-panel modules (currently ~1050 lines)
- **P2**: Tighten CORS in production (`allow_credentials=True` with `*` is spec-invalid)
- **P2**: Watch mode: detect content mutation on already-known paths (currently only detects new paths)
- **P2**: Multi-user auth (Emergent Google Auth or JWT) for cloud vaults
- **P3**: Mobile companion apps (Android with MANAGE_EXTERNAL_STORAGE; iOS is fully sandboxed)
- **P3**: Kernel-level filesystem interception (signed drivers required)
