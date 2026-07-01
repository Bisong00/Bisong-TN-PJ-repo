# MonoNode — Memory Vault (Whole-Computer Deduplication)

## Original Problem Statement
> Prevent double downloads/installs. One instance per file/app across the whole computer memory. Show existing path when a duplicate is detected. Covers PDFs, docs, images, audios, videos, installers.

## Architecture
- **Backend (FastAPI + MongoDB + Motor)**
  - `POST /api/files/upload` — SHA-256 dedup; persists a `duplicates` record on collision
  - `POST /api/files/scan` — bulk hash batch (single `$in` prefetch + `insert_many`); correct `batch_duplicate` vs `vault_match` labels; persists every duplicate occurrence
  - `GET /api/files/export?format=csv|json` — StreamingResponse for large vaults
  - `POST/GET/DELETE /api/apps` + `/api/apps/export`
  - `GET /api/duplicates` (filters: q, reason, reclaimed) · `/duplicates/stats` · `DELETE /duplicates/{id}` · `POST /duplicates/{id}/mark-reclaimed` · `GET /duplicates/{id}/script?platform=posix|windows` (**Reclaim now** shell/PowerShell script)
  - `GET /api/agent/monoscan.py?request_backend=…` — serves the local agent
  - `GET /api/stats` — totals + collisions + memory saved + by_category
  - CORS spec-compliant (auto-disables `allow_credentials` when origin is `*`)
- **Local Agent (`/app/backend/agent/monoscan.py`)**
  - One-shot: `--root <path>`
  - `--watch` — polls; tracks `(mtime_ns, size)` so it detects content mutations, not just new paths
  - `--replace-duplicates --yes` — deletes duplicates and replaces with symlinks (real OS-level enforcement)
  - Skips node_modules, .git, `$RECYCLE.BIN`, System Volume Information, hidden dirs
- **Packaging** (`/app/backend/agent/PACKAGING.md`) — PyInstaller commands + signing/notarising + launchd/Task-Scheduler/systemd snippets
- **Frontend** (React + Tailwind, modularised)
  - `App.js` (170 lines, orchestration only)
  - `lib/api.js` (constants, helpers)
  - `components/`: `shared.jsx` · `Dropzone.jsx` · `FilesPanel.jsx` · `AppsPanel.jsx` · `ScanPanel.jsx` · `DuplicatesPanel.jsx` · `Dashboard.jsx` · `DuplicateModal.jsx`
  - 5 tabs: Overview · Files · Full Scan · Duplicates · Applications
  - Distinctive "MonoNode / Data Vault" terminal aesthetic (IBM Plex Sans + Mono, black + orange accent, scanlines, sharp edges)

## Reality Notes
- Browser cannot silently scan whole OS — sandbox rule. The agent solves this.
- File bytes never leave the user's machine — only SHA-256 hashes + paths.
- Symlink replacement on Windows requires Developer Mode or elevated PowerShell.

## Implemented (Jan 2026, iterations 1–4)
- ✅ SHA-256 file upload dedup with collision modal
- ✅ Files & Apps registries (search, filters, delete, CSV/JSON export streaming)
- ✅ Applications case-insensitive name+version dedup
- ✅ Overview dashboard (totals, collisions blocked, memory saved, by-category)
- ✅ Browser folder-scan (webkitdirectory + SubtleCrypto SHA-256)
- ✅ Local Python agent (whole-disk scan · watch mode with mtime/size mutation detection · symlink replace)
- ✅ **Duplicates registry** with "Reclaim now" per-row `.sh`/`.ps1` downloads
- ✅ Correct `batch_duplicate` vs `vault_match` labeling
- ✅ Bulk-optimised scan endpoint (prefetch + insert_many)
- ✅ Spec-compliant CORS
- ✅ Frontend fully refactored into per-panel modules
- ✅ Packaging documentation
- ✅ Distinctive "Data Vault" UI
- ✅ **Testing agent iterations 1–4 all 100%** (backend 23/23, frontend 100%)

## Backlog
- **P1**: Pagination on `/api/duplicates` (currently capped at 500)
- **P1**: `/api/stats` tooltip note that `duplicates_prevented` is a lifetime counter
- **P2**: Multi-user auth (Emergent Google Auth vs JWT — needs user decision, see finish note)
- **P2**: Real-time content watch (inotify/FSEvents/ReadDirectoryChangesW) instead of poll
- **P2**: Bulk actions in Duplicates tab (select all → generate combined reclaim script)
- **P3**: Native mobile companion (Android with MANAGE_EXTERNAL_STORAGE; iOS is fully sandboxed)
- **P3**: Kernel-level filesystem interception (signed drivers required)
