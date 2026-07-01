from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import hashlib
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------- Models ----------

class FileRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    size: int
    mime_type: str
    sha256: str
    file_category: str  # pdf, doc, audio, video, image, installer, other
    original_path: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ScanItem(BaseModel):
    filename: str
    size: int
    sha256: str
    relative_path: str  # absolute or relative path where the file lives on user's disk
    mime_type: Optional[str] = ""


class ScanRequest(BaseModel):
    items: List[ScanItem]
    root_label: Optional[str] = ""  # e.g. "C:\\" or "/Users/alice"
    source: Optional[str] = "browser"  # "browser" or "agent"


class AppRegistryEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    app_name: str
    version: str
    install_path: str
    platform: str  # windows, mac, linux, android, ios
    notes: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AppRegistryCreate(BaseModel):
    app_name: str
    version: str
    install_path: str
    platform: str
    notes: Optional[str] = ""


class DedupCounter(BaseModel):
    duplicates_prevented: int = 0
    bytes_saved: int = 0


# ---------- Helpers ----------

CATEGORY_MAP = {
    "pdf": ["application/pdf"],
    "doc": [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv",
        "application/rtf",
    ],
    "audio": ["audio/"],
    "video": ["video/"],
    "image": ["image/"],
    "installer": [
        "application/x-msdownload",
        "application/vnd.microsoft.portable-executable",
        "application/x-apple-diskimage",
        "application/vnd.debian.binary-package",
        "application/x-rpm",
        "application/vnd.android.package-archive",
        "application/x-msi",
    ],
}

INSTALLER_EXTS = {".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".apk", ".appimage", ".ipa"}


def classify_file(filename: str, mime_type: str) -> str:
    mime = (mime_type or "").lower()
    name = filename.lower()
    ext = os.path.splitext(name)[1]

    if ext in INSTALLER_EXTS:
        return "installer"
    for cat, patterns in CATEGORY_MAP.items():
        for p in patterns:
            if p.endswith("/") and mime.startswith(p):
                return cat
            if mime == p:
                return cat
    if ext in {".pdf"}:
        return "pdf"
    if ext in {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf", ".odt"}:
        return "doc"
    if ext in {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"}:
        return "audio"
    if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"}:
        return "video"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp", ".svg"}:
        return "image"
    return "other"


async def get_counter() -> dict:
    doc = await db.dedup_counter.find_one({"_id": "global"})
    if not doc:
        doc = {"_id": "global", "duplicates_prevented": 0, "bytes_saved": 0}
        await db.dedup_counter.insert_one(doc)
    return doc


async def inc_counter(bytes_saved: int) -> None:
    await db.dedup_counter.update_one(
        {"_id": "global"},
        {"$inc": {"duplicates_prevented": 1, "bytes_saved": int(bytes_saved)}},
        upsert=True,
    )


async def record_duplicate(*, sha256: str, filename: str, size: int,
                           scanned_path: str, existing_path: str,
                           reason: str, source: str, vault_id: Optional[str] = None) -> dict:
    """Persist every detected duplicate occurrence so it can be reclaimed later."""
    dup = {
        "id": str(uuid.uuid4()),
        "sha256": sha256,
        "filename": filename,
        "size": int(size or 0),
        "scanned_path": scanned_path,
        "existing_path": existing_path,
        "vault_id": vault_id,
        "reason": reason,          # vault_match | batch_duplicate | upload_duplicate
        "source": source,          # upload | browser | agent
        "reclaimed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.duplicates.insert_one(dup.copy())
    dup.pop("_id", None)
    return dup


# ---------- File endpoints ----------

@api_router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    original_path: Optional[str] = Form(None),
):
    """Compute SHA-256 of uploaded file and check for duplicates.
    If duplicate: return the existing record. If new: persist a metadata record.
    We DO NOT store the file bytes — this is a memory/dedup manager."""
    hasher = hashlib.sha256()
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        hasher.update(chunk)
        total += len(chunk)
    digest = hasher.hexdigest()

    existing = await db.files.find_one({"sha256": digest}, {"_id": 0})
    if existing:
        await inc_counter(existing.get("size", total))
        await record_duplicate(
            sha256=digest, filename=file.filename or "unnamed",
            size=total, scanned_path=original_path or (file.filename or ""),
            existing_path=existing.get("original_path") or existing.get("filename", ""),
            reason="upload_duplicate", source="upload",
            vault_id=existing.get("id"),
        )
        return {"duplicate": True, "record": existing}

    record = FileRecord(
        filename=file.filename or "unnamed",
        size=total,
        mime_type=file.content_type or "application/octet-stream",
        sha256=digest,
        file_category=classify_file(file.filename or "", file.content_type or ""),
        original_path=original_path,
    )
    doc = record.model_dump()
    await db.files.insert_one(doc)
    doc.pop("_id", None)
    return {"duplicate": False, "record": doc}


@api_router.post("/files/register")
async def register_file(record: FileRecord):
    """Register a file by metadata only (e.g. file at a known path). SHA required."""
    existing = await db.files.find_one({"sha256": record.sha256}, {"_id": 0})
    if existing:
        await inc_counter(existing.get("size", record.size))
        return {"duplicate": True, "record": existing}
    doc = record.model_dump()
    await db.files.insert_one(doc)
    doc.pop("_id", None)
    return {"duplicate": False, "record": doc}


@api_router.post("/files/scan")
async def bulk_scan(payload: ScanRequest):
    """Bulk-ingest a batch of hashed items. Optimized:
       - Prefetch all matching SHAs from vault in ONE query
       - Detect within-batch duplicates BEFORE the vault check (correct labeling)
       - Persist unique items via a single insert_many
    """
    items = payload.items
    if not items:
        return {"scanned": 0, "added": 0, "duplicates": 0, "bytes_saved": 0,
                "total_bytes_scanned": 0, "root_label": payload.root_label,
                "source": payload.source, "duplicate_details": []}

    # normalize + collect all hashes
    shas = [it.sha256.lower() for it in items]

    # bulk vault lookup
    vault_rows = await db.files.find(
        {"sha256": {"$in": list(set(shas))}}, {"_id": 0}
    ).to_list(length=len(shas))
    vault_map = {r["sha256"]: r for r in vault_rows}

    added = 0
    duplicates = 0
    bytes_saved = 0
    total_bytes = 0
    duplicate_details: List[dict] = []
    seen_in_batch: dict = {}
    to_insert: List[dict] = []
    dup_records_to_insert: List[dict] = []

    for it in items:
        size = int(it.size or 0)
        total_bytes += size
        sha = it.sha256.lower()

        # 1) Duplicate within this batch (checked first for correct labeling)
        if sha in seen_in_batch:
            duplicates += 1
            bytes_saved += size
            duplicate_details.append({
                "scanned_path": it.relative_path,
                "existing_path": seen_in_batch[sha],
                "filename": it.filename,
                "size": size,
                "sha256": sha,
                "reason": "batch_duplicate",
            })
            dup_records_to_insert.append({
                "id": str(uuid.uuid4()), "sha256": sha, "filename": it.filename,
                "size": size, "scanned_path": it.relative_path,
                "existing_path": seen_in_batch[sha], "vault_id": None,
                "reason": "batch_duplicate", "source": payload.source or "scan",
                "reclaimed": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            continue

        # 2) Already in vault?
        existing = vault_map.get(sha)
        if existing:
            duplicates += 1
            bytes_saved += size
            existing_p = existing.get("original_path") or existing.get("filename")
            duplicate_details.append({
                "scanned_path": it.relative_path,
                "existing_path": existing_p,
                "filename": it.filename,
                "size": size,
                "sha256": sha,
                "reason": "vault_match",
            })
            dup_records_to_insert.append({
                "id": str(uuid.uuid4()), "sha256": sha, "filename": it.filename,
                "size": size, "scanned_path": it.relative_path,
                "existing_path": existing_p, "vault_id": existing.get("id"),
                "reason": "vault_match", "source": payload.source or "scan",
                "reclaimed": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            continue

        # 3) Unique — queue for insert and remember for within-batch check
        seen_in_batch[sha] = it.relative_path
        record = FileRecord(
            filename=it.filename,
            size=size,
            mime_type=it.mime_type or "application/octet-stream",
            sha256=sha,
            file_category=classify_file(it.filename, it.mime_type or ""),
            original_path=it.relative_path,
        )
        to_insert.append(record.model_dump())
        added += 1

    if to_insert:
        await db.files.insert_many(to_insert, ordered=False)

    if dup_records_to_insert:
        await db.duplicates.insert_many(dup_records_to_insert, ordered=False)

    if duplicates:
        await db.dedup_counter.update_one(
            {"_id": "global"},
            {"$inc": {"duplicates_prevented": duplicates, "bytes_saved": int(bytes_saved)}},
            upsert=True,
        )

    return {
        "scanned": len(items),
        "added": added,
        "duplicates": duplicates,
        "bytes_saved": bytes_saved,
        "total_bytes_scanned": total_bytes,
        "root_label": payload.root_label,
        "source": payload.source,
        "duplicate_details": duplicate_details[:500],
    }


@api_router.get("/files")
async def list_files(q: Optional[str] = None, category: Optional[str] = None):
    query: dict = {}
    if category and category != "all":
        query["file_category"] = category
    if q:
        query["$or"] = [
            {"filename": {"$regex": q, "$options": "i"}},
            {"sha256": {"$regex": q, "$options": "i"}},
            {"original_path": {"$regex": q, "$options": "i"}},
            {"mime_type": {"$regex": q, "$options": "i"}},
        ]
    items = await db.files.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    result = await db.files.delete_one({"id": file_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"deleted": True}


def _csv_line(vals: List[str]) -> str:
    out = []
    for v in vals:
        s = "" if v is None else str(v)
        if any(c in s for c in [",", "\"", "\n", "\r"]):
            s = "\"" + s.replace("\"", "\"\"") + "\""
        out.append(s)
    return ",".join(out) + "\n"


async def _stream_collection_csv(collection, headers: List[str]):
    """Async generator: yields CSV header + one line per doc from a Motor cursor."""
    yield _csv_line(headers)
    cursor = collection.find({}, {"_id": 0}).sort("created_at", -1)
    async for r in cursor:
        yield _csv_line([r.get(h, "") for h in headers])


async def _stream_collection_json(collection):
    """Async generator: yields a valid JSON array streamed doc-by-doc."""
    cursor = collection.find({}, {"_id": 0}).sort("created_at", -1)
    yield "[\n"
    first = True
    async for r in cursor:
        prefix = "" if first else ",\n"
        first = False
        yield prefix + json.dumps(r, default=str)
    yield "\n]\n"


FILE_EXPORT_HEADERS = ["id", "filename", "size", "mime_type", "sha256",
                       "file_category", "original_path", "created_at"]
APP_EXPORT_HEADERS = ["id", "app_name", "version", "platform", "install_path", "notes", "created_at"]


@api_router.get("/files/export")
async def export_files(format: str = "json"):
    if format.lower() == "csv":
        return StreamingResponse(
            _stream_collection_csv(db.files, FILE_EXPORT_HEADERS),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=mononode_files.csv"},
        )
    return StreamingResponse(
        _stream_collection_json(db.files),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=mononode_files.json"},
    )


@api_router.get("/apps/export")
async def export_apps(format: str = "json"):
    if format.lower() == "csv":
        return StreamingResponse(
            _stream_collection_csv(db.apps, APP_EXPORT_HEADERS),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=mononode_apps.csv"},
        )
    return StreamingResponse(
        _stream_collection_json(db.apps),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=mononode_apps.json"},
    )


# ---------- Apps endpoints ----------

@api_router.post("/apps")
async def register_app(payload: AppRegistryCreate):
    key = {
        "app_name": {"$regex": f"^{payload.app_name}$", "$options": "i"},
        "version": payload.version,
    }
    existing = await db.apps.find_one(key, {"_id": 0})
    if existing:
        return {"duplicate": True, "record": existing}
    entry = AppRegistryEntry(**payload.model_dump())
    doc = entry.model_dump()
    await db.apps.insert_one(doc)
    await db.dedup_counter.update_one(
        {"_id": "global"}, {"$setOnInsert": {"duplicates_prevented": 0, "bytes_saved": 0}}, upsert=True
    )
    doc.pop("_id", None)
    return {"duplicate": False, "record": doc}


@api_router.get("/apps")
async def list_apps(q: Optional[str] = None, platform: Optional[str] = None):
    query: dict = {}
    if platform and platform != "all":
        query["platform"] = platform
    if q:
        query["$or"] = [
            {"app_name": {"$regex": q, "$options": "i"}},
            {"version": {"$regex": q, "$options": "i"}},
            {"install_path": {"$regex": q, "$options": "i"}},
        ]
    items = await db.apps.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.delete("/apps/{app_id}")
async def delete_app(app_id: str):
    result = await db.apps.delete_one({"id": app_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="App not found")
    return {"deleted": True}


# ---------- Duplicates registry ----------

def _shell_quote_posix(p: str) -> str:
    return "'" + p.replace("'", "'\"'\"'") + "'"


def _reclaim_script_posix(dup: dict) -> str:
    dup_path = _shell_quote_posix(dup["scanned_path"])
    orig_path = _shell_quote_posix(dup["existing_path"])
    return (
        "#!/usr/bin/env bash\n"
        "# MonoNode reclaim script — replaces a duplicate file with a symlink to the canonical copy.\n"
        f"# duplicate  : {dup['scanned_path']}\n"
        f"# canonical  : {dup['existing_path']}\n"
        f"# sha-256    : {dup['sha256']}\n"
        f"# size       : {dup['size']} bytes\n"
        "set -euo pipefail\n"
        f"DUP={dup_path}\n"
        f"ORIG={orig_path}\n"
        "if [ ! -f \"$DUP\" ]; then echo \"[!] duplicate no longer exists: $DUP\"; exit 0; fi\n"
        "if [ ! -f \"$ORIG\" ]; then echo \"[!] canonical missing, aborting: $ORIG\"; exit 1; fi\n"
        "# Optional: safety backup to /tmp before deleting\n"
        "cp -p \"$DUP\" \"/tmp/$(basename \"$DUP\").mononode.bak\" 2>/dev/null || true\n"
        "rm \"$DUP\"\n"
        "ln -s \"$ORIG\" \"$DUP\"\n"
        f"echo \"[✓] reclaimed: $DUP -> $ORIG\"\n"
    )


def _reclaim_script_windows(dup: dict) -> str:
    # PowerShell — mklink requires admin OR Developer Mode
    dup_p = dup["scanned_path"].replace("\"", "`\"")
    orig_p = dup["existing_path"].replace("\"", "`\"")
    return (
        "# MonoNode reclaim script (PowerShell)\r\n"
        f"# duplicate  : {dup['scanned_path']}\r\n"
        f"# canonical  : {dup['existing_path']}\r\n"
        f"# sha-256    : {dup['sha256']}\r\n"
        "$ErrorActionPreference = 'Stop'\r\n"
        f"$dup = \"{dup_p}\"\r\n"
        f"$orig = \"{orig_p}\"\r\n"
        "if (-not (Test-Path -LiteralPath $dup)) { Write-Host \"[!] duplicate no longer exists: $dup\"; exit 0 }\r\n"
        "if (-not (Test-Path -LiteralPath $orig)) { Write-Host \"[!] canonical missing: $orig\"; exit 1 }\r\n"
        "Copy-Item -LiteralPath $dup -Destination (Join-Path $env:TEMP ((Split-Path $dup -Leaf) + '.mononode.bak')) -ErrorAction SilentlyContinue\r\n"
        "Remove-Item -LiteralPath $dup -Force\r\n"
        "New-Item -ItemType SymbolicLink -Path $dup -Target $orig | Out-Null\r\n"
        "Write-Host \"[+] reclaimed: $dup -> $orig\"\r\n"
    )


@api_router.get("/duplicates")
async def list_duplicates(q: Optional[str] = None, reason: Optional[str] = None,
                          reclaimed: Optional[bool] = None, limit: int = 500):
    query: dict = {}
    if reason and reason != "all":
        query["reason"] = reason
    if reclaimed is not None:
        query["reclaimed"] = reclaimed
    if q:
        query["$or"] = [
            {"filename": {"$regex": q, "$options": "i"}},
            {"scanned_path": {"$regex": q, "$options": "i"}},
            {"existing_path": {"$regex": q, "$options": "i"}},
            {"sha256": {"$regex": q, "$options": "i"}},
        ]
    items = await db.duplicates.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return items


@api_router.get("/duplicates/stats")
async def duplicates_stats():
    total = await db.duplicates.count_documents({})
    active = await db.duplicates.count_documents({"reclaimed": False})
    reclaimed = await db.duplicates.count_documents({"reclaimed": True})
    agg = await db.duplicates.aggregate([
        {"$match": {"reclaimed": False}},
        {"$group": {"_id": None, "bytes": {"$sum": "$size"}}}
    ]).to_list(1)
    reclaimable_bytes = agg[0]["bytes"] if agg else 0
    return {"total": total, "active": active, "reclaimed": reclaimed,
            "reclaimable_bytes": reclaimable_bytes}


@api_router.delete("/duplicates/{dup_id}")
async def delete_duplicate(dup_id: str):
    r = await db.duplicates.delete_one({"id": dup_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    return {"deleted": True}


@api_router.post("/duplicates/{dup_id}/mark-reclaimed")
async def mark_reclaimed(dup_id: str):
    r = await db.duplicates.update_one({"id": dup_id}, {"$set": {"reclaimed": True}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    return {"reclaimed": True}


@api_router.get("/duplicates/{dup_id}/script")
async def reclaim_script(dup_id: str, platform: str = "posix"):
    """Generate a per-OS shell script that replaces this duplicate with a symlink."""
    dup = await db.duplicates.find_one({"id": dup_id}, {"_id": 0})
    if not dup:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    plat = (platform or "posix").lower()
    if plat in ("windows", "win", "powershell", "ps1"):
        body = _reclaim_script_windows(dup)
        ext = "ps1"
        mt = "text/plain"
    else:
        body = _reclaim_script_posix(dup)
        ext = "sh"
        mt = "text/x-shellscript"
    safe = "".join(ch if ch.isalnum() else "_" for ch in dup["filename"])[:40] or "reclaim"
    return PlainTextResponse(
        body, media_type=mt,
        headers={"Content-Disposition": f"attachment; filename=reclaim_{safe}.{ext}"},
    )


# ---------- Stats ----------

@api_router.get("/stats")
async def stats():
    total_files = await db.files.count_documents({})
    total_apps = await db.apps.count_documents({})
    counter = await get_counter()

    pipeline = [
        {"$group": {"_id": "$file_category", "count": {"$sum": 1}, "bytes": {"$sum": "$size"}}}
    ]
    by_cat = {}
    async for row in db.files.aggregate(pipeline):
        by_cat[row["_id"]] = {"count": row["count"], "bytes": row["bytes"]}

    total_bytes_agg = await db.files.aggregate([
        {"$group": {"_id": None, "bytes": {"$sum": "$size"}}}
    ]).to_list(1)
    total_bytes = total_bytes_agg[0]["bytes"] if total_bytes_agg else 0

    return {
        "total_files": total_files,
        "total_apps": total_apps,
        "duplicates_prevented": counter.get("duplicates_prevented", 0),
        "bytes_saved": counter.get("bytes_saved", 0),
        "total_bytes_tracked": total_bytes,
        "by_category": by_cat,
    }


@api_router.get("/")
async def root():
    return {"service": "MonoNode Dedup API", "status": "online"}


@api_router.get("/agent/monoscan.py", response_class=PlainTextResponse)
async def agent_script(request_backend: Optional[str] = None):
    """Serve the local scanner agent (Python) with the correct backend URL baked in."""
    script_path = ROOT_DIR / "agent" / "monoscan.py"
    body = script_path.read_text(encoding="utf-8")
    backend_url = request_backend or os.environ.get("PUBLIC_BACKEND_URL", "")
    if backend_url:
        body = body.replace("__BACKEND_URL__", backend_url)
    return PlainTextResponse(
        body,
        headers={"Content-Disposition": "attachment; filename=monoscan.py"},
        media_type="text/x-python",
    )


app.include_router(api_router)

# CORS — spec-compliant. If CORS_ORIGINS is '*' we cannot set allow_credentials=True.
_cors_raw = os.environ.get('CORS_ORIGINS', '*').strip()
_cors_origins = [o.strip() for o in _cors_raw.split(',') if o.strip()]
_cors_allow_credentials = not ('*' in _cors_origins)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_cors_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
