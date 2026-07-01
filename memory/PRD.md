# MonoNode — Memory Vault (Whole-Computer Deduplication)

## Original Problem Statement
> "i want to build a software for computers and mobiles that manages memory by making sure that applications can only be installed once, and any file can only be downloaded once. the main goal is that no file or application should be double in the memory. if it already exist, then let it show a path to that particular file or application. pdfs, word docs, audios, videos included."

Follow-up clarifications:
> "so many ways one can receive data. like from social media platforms and also from the internet. no double download. only one instance of all applications, files, pdfs, word docs, images, audios, videos in the whole memory not just in each folder. it should scan all folders."
> "i want it to be part of the OS so it can scan the whole computer memory."

## User Choices
- Web-based dashboard as the control room + downloadable local agent (approved A+B path).
- Applications registry (manual: name/version/install path/platform)
- Full feature set: stats, search, filters, delete, whole-folder scan
- Distinctive "MonoNode / Data Vault" terminal aesthetic — IBM Plex Sans + Mono, black/orange, sharp edges, scanlines.

## Architecture
- **Backend (FastAPI + MongoDB)**:
  - `POST /api/files/upload` — single-file multipart, SHA-256 dedup
  - `POST /api/files/register` — metadata-only registration
  - `POST /api/files/scan` — bulk batch of {filename,size,sha256,relative_path,mime_type}; returns aggregate + duplicate_details
  - `GET /api/files`, `DELETE /api/files/{id}`
  - `POST/GET/DELETE /api/apps` (dedup by name+version, case-insensitive)
  - `GET /api/stats` (totals, duplicates_prevented, bytes_saved, by_category)
  - `GET /api/agent/monoscan.py` — serves the local Python agent with backend URL baked in
- **Local Agent (`/app/backend/agent/monoscan.py`)** — Python 3.8+ CLI; recursively walks any root (`--root /` on Mac/Linux, `--root C:\` on Windows, or any subfolder), hashes every file, batches to `/api/files/scan`. Skips hidden dirs / node_modules / .git / $RECYCLE.BIN by default.
- **Frontend (React + Tailwind)**: Overview / Files / Full Scan / Applications tabs; drag-drop upload; browser folder-scan (webkitdirectory + SubtleCrypto SHA-256); collision modal; agent instructions with per-OS command switcher + copy + download.

## Reality Notes
- **Browsers cannot silently scan the whole OS** — that's a sandboxing rule. Solution: the local Python agent runs on the user's own machine with full disk access and reports to the vault.
- File **bytes are never transmitted** — only SHA-256 hashes + paths. The vault stores metadata only; it is not a storage backend.
- On Windows, whole-drive scans may need to be run from an elevated PowerShell for system-owned paths; on Mac, Full Disk Access permission for the terminal is required.

## User Personas
- Individuals wanting to declutter drives full of re-downloaded PDFs, media, installers
- Power users maintaining a canonical media/software library across devices
- IT-conscious users enforcing "one instance" policy

## Core Requirements (met)
- SHA-256 dedup across all file types (PDF, DOC, audio, video, image, installers, other) ✓
- Show existing path when duplicate found ✓
- Whole-computer / whole-folder scan (via agent + browser) ✓
- Applications registry with duplicate prevention ✓

## Implemented (Jan 2026)
- ✅ Single-file upload + SHA-256 collision modal with origin path
- ✅ Files list · search · category filters · delete
- ✅ Applications registry with case-insensitive name+version dedup
- ✅ Overview dashboard: total files, apps, collisions blocked, memory saved, distribution
- ✅ Whole-folder browser scan (webkitdirectory + SubtleCrypto SHA-256, batched)
- ✅ Local `monoscan.py` agent for whole-computer scan (Windows/Mac/Linux) with per-OS command switcher, copy button, and one-click download
- ✅ Distinctive "Data Vault" UI (IBM Plex, orange accent, sharp edges, scanlines)
- ✅ Testing agent: backend 100% (8/8), frontend 100% (14/14 UI checks)

## Prioritized Backlog
- **P1**: Refactor bulk_scan for large scans — bulk `find({sha256:$in})` + `insert_many` (100k+ items)
- **P1**: Fix cosmetic label (`batch_duplicate` vs `vault_match` in scan response)
- **P1**: CSV / JSON export of the vault
- **P2**: Auth (multi-user vaults) — Emergent Google Auth or JWT
- **P2**: Refactor App.js into per-component files (~1000 lines now)
- **P2**: Package the Python agent as a signed installer for each OS (Tauri wrapper, PyInstaller `.exe`, notarised `.pkg`)
- **P2**: Scheduled scan integration (cron / launchd / Task Scheduler helper script)
- **P3**: Filesystem watcher mode — real-time dedup as files land in Downloads

## Deferred
- Kernel-level filesystem interception (requires signed drivers, months of native dev)
- Mobile whole-device scan (iOS is fully sandboxed; Android needs MANAGE_EXTERNAL_STORAGE + native app)
