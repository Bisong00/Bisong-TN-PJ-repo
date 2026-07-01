# MonoNode — Memory Vault (Deduplication Manager)

## Original Problem Statement
> "i want to build a software for computers and mobiles that manages memorie by making sure that applications can only be installed once, and any file can only be downloaded once. the main goal is that no file or application should be double in the memory. if it already exist, the let it show a path to that particular file or application. note that even pdfs, word docs, audios, and videos are also involed."

## User Choices
- Web-based dashboard (SHA-256 hashing on upload) with optional origin path metadata
- Applications registry (manual: name/version/install path/platform)
- Full feature set: stats dashboard, search, category filters, delete UI
- Distinctive design (implemented as "MonoNode / Data Vault" terminal aesthetic — IBM Plex Sans/Mono, black + orange accent, sharp edges, scanlines)

## Architecture
- **Backend**: FastAPI + Motor (MongoDB). Endpoints under /api:
  - POST /api/files/upload (multipart) → SHA-256 hash → dedup check → metadata record (bytes NOT persisted)
  - POST /api/files/register (metadata only)
  - GET/DELETE /api/files
  - POST/GET/DELETE /api/apps (dedup by app_name case-insensitive + version)
  - GET /api/stats (totals, duplicates_prevented, bytes_saved, by_category)
- **Frontend**: React + Tailwind. Single-page with 3 tabs (Overview / Files / Applications), drag-drop upload, duplicate collision modal, app register form, filter chips, search.
- **Storage**: MongoDB collections `files`, `apps`, `dedup_counter`.

## User Personas
- Individual users tracking downloads across devices
- Power users managing installers/media libraries
- IT-conscious users wanting a "single source of truth" registry

## Core Requirements
- SHA-256-based file deduplication (no double copies)
- Show existing path when duplicate detected
- Support any file type (PDF, DOC, audio, video, image, installer, other)
- Application registry with duplicate prevention on name+version

## Implemented (Jan 2026)
- ✅ SHA-256 file upload + dedup detection with collision modal
- ✅ Origin-path field on upload for path-of-record tracking
- ✅ Files list with search + category filters + delete
- ✅ Applications registry with name/version dedup + platform + notes
- ✅ Dashboard: totals, collisions blocked, memory saved, distribution by category
- ✅ Distinctive "Data Vault" terminal UI (IBM Plex mono, orange accent, scanlines, sharp edges)
- ✅ Testing agent verified: backend 100%, frontend fixed (scanline pointer-events)

## Prioritized Backlog
- **P1**: Client-side folder scan via File System Access API (Chromium) — scan a whole folder without upload
- **P1**: Export vault as CSV / JSON
- **P2**: Auth (multi-user vaults) — Emergent Google Auth or JWT
- **P2**: Native desktop wrapper (Tauri) that hooks into OS download folder
- **P2**: Mobile companion (React Native / Capacitor) with content-provider scanning

## Deferred / Future
- OS-level install hook (needs native code, not feasible on web)
- Bulk actions (multi-select delete, batch tag/move)
- Chart visualizations for time-based ingest history
