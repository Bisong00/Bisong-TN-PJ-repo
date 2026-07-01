from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, Request, Response, Depends, Cookie, Header
from fastapi.responses import PlainTextResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import hashlib
import json
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ============================================================================
# Models
# ============================================================================

class FileRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    filename: str
    size: int
    mime_type: str
    sha256: str
    file_category: str
    original_path: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ScanItem(BaseModel):
    filename: str
    size: int
    sha256: str
    relative_path: str
    mime_type: Optional[str] = ""


class ScanRequest(BaseModel):
    items: List[ScanItem]
    root_label: Optional[str] = ""
    source: Optional[str] = "browser"


class AppRegistryEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    app_name: str
    version: str
    install_path: str
    platform: str
    notes: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AppRegistryCreate(BaseModel):
    app_name: str
    version: str
    install_path: str
    platform: str
    notes: Optional[str] = ""


class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = ""


# ============================================================================
# Auth
# ============================================================================
# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH

EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def _get_user_from_session_token(token: str) -> Optional[dict]:
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            return None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    return user


async def _get_user_from_agent_token(token: str) -> Optional[dict]:
    if not token:
        return None
    row = await db.agent_tokens.find_one({"token": token, "revoked": False}, {"_id": 0})
    if not row:
        return None
    user = await db.users.find_one({"user_id": row["user_id"]}, {"_id": 0})
    return user


async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Auth dependency. Accepts: httpOnly session_token cookie, OR
    'Authorization: Bearer <session_token OR agent_token>' header."""
    # 1) cookie
    user = await _get_user_from_session_token(session_token) if session_token else None
    # 2) authorization header (bearer)
    if not user and authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            tok = parts[1]
            user = await _get_user_from_session_token(tok) or await _get_user_from_agent_token(tok)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    """Exchange the session_id (from the OAuth callback URL fragment) for a
    session_token cookie. Front-end should call this once with X-Session-ID."""
    session_id = request.headers.get("X-Session-ID") or request.headers.get("x-session-id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing X-Session-ID header")

    async with httpx.AsyncClient(timeout=15) as hc:
        r = await hc.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data["email"]
    name = data.get("name", email)
    picture = data.get("picture", "")
    session_token = data["session_token"]

    # upsert user by email
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "created_at": datetime.now(timezone.utc),
        "expires_at": expires_at,
    })

    response.set_cookie(
        key="session_token", value=session_token, path="/",
        httponly=True, secure=True, samesite="none",
        max_age=7 * 24 * 3600,
    )
    return {"user_id": user_id, "email": email, "name": name, "picture": picture}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
    }


@api_router.post("/auth/logout")
async def logout(response: Response,
                 session_token: Optional[str] = Cookie(default=None)):
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


@api_router.post("/auth/agent-token")
async def create_agent_token(user: dict = Depends(get_current_user)):
    token = "mono_" + secrets.token_urlsafe(32)
    await db.agent_tokens.insert_one({
        "token": token,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "revoked": False,
    })
    return {"token": token}


@api_router.get("/auth/agent-token")
async def list_agent_tokens(user: dict = Depends(get_current_user)):
    rows = await db.agent_tokens.find(
        {"user_id": user["user_id"], "revoked": False}, {"_id": 0}
    ).to_list(50)
    return rows


@api_router.delete("/auth/agent-token/{token}")
async def revoke_agent_token(token: str, user: dict = Depends(get_current_user)):
    r = await db.agent_tokens.update_one(
        {"token": token, "user_id": user["user_id"]},
        {"$set": {"revoked": True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Token not found")
    return {"revoked": True}


# ============================================================================
# File classification helpers
# ============================================================================

CATEGORY_MAP = {
    "pdf": ["application/pdf"],
    "doc": [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain", "text/csv", "application/rtf",
    ],
    "audio": ["audio/"],
    "video": ["video/"],
    "image": ["image/"],
    "installer": [
        "application/x-msdownload", "application/vnd.microsoft.portable-executable",
        "application/x-apple-diskimage", "application/vnd.debian.binary-package",
        "application/x-rpm", "application/vnd.android.package-archive", "application/x-msi",
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
    if ext in {".pdf"}: return "pdf"
    if ext in {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf", ".odt"}: return "doc"
    if ext in {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"}: return "audio"
    if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"}: return "video"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp", ".svg"}: return "image"
    return "other"


# ============================================================================
# Dedup counter (per user)
# ============================================================================

async def inc_counter(user_id: str, bytes_saved: int, n: int = 1) -> None:
    await db.dedup_counter.update_one(
        {"user_id": user_id},
        {"$inc": {"duplicates_prevented": n, "bytes_saved": int(bytes_saved)}},
        upsert=True,
    )


async def get_counter(user_id: str) -> dict:
    doc = await db.dedup_counter.find_one({"user_id": user_id})
    if not doc:
        doc = {"user_id": user_id, "duplicates_prevented": 0, "bytes_saved": 0}
        await db.dedup_counter.insert_one(doc)
    return doc


async def record_duplicate(*, user_id: str, sha256: str, filename: str, size: int,
                           scanned_path: str, existing_path: str, reason: str,
                           source: str, vault_id: Optional[str] = None) -> None:
    await db.duplicates.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "sha256": sha256,
        "filename": filename,
        "size": int(size or 0),
        "scanned_path": scanned_path,
        "existing_path": existing_path,
        "vault_id": vault_id,
        "reason": reason,
        "source": source,
        "reclaimed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ============================================================================
# Files
# ============================================================================

@api_router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    original_path: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    hasher = hashlib.sha256()
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        hasher.update(chunk)
        total += len(chunk)
    digest = hasher.hexdigest()

    existing = await db.files.find_one(
        {"user_id": user["user_id"], "sha256": digest}, {"_id": 0}
    )
    if existing:
        await inc_counter(user["user_id"], existing.get("size", total))
        await record_duplicate(
            user_id=user["user_id"], sha256=digest,
            filename=file.filename or "unnamed", size=total,
            scanned_path=original_path or (file.filename or ""),
            existing_path=existing.get("original_path") or existing.get("filename", ""),
            reason="upload_duplicate", source="upload",
            vault_id=existing.get("id"),
        )
        return {"duplicate": True, "record": existing}

    record = FileRecord(
        user_id=user["user_id"],
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


@api_router.post("/files/scan")
async def bulk_scan(payload: ScanRequest, user: dict = Depends(get_current_user)):
    items = payload.items
    uid = user["user_id"]
    if not items:
        return {"scanned": 0, "added": 0, "duplicates": 0, "bytes_saved": 0,
                "total_bytes_scanned": 0, "root_label": payload.root_label,
                "source": payload.source, "duplicate_details": []}

    shas = list({it.sha256.lower() for it in items})
    vault_rows = await db.files.find(
        {"user_id": uid, "sha256": {"$in": shas}}, {"_id": 0}
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

        if sha in seen_in_batch:
            duplicates += 1
            bytes_saved += size
            duplicate_details.append({
                "scanned_path": it.relative_path, "existing_path": seen_in_batch[sha],
                "filename": it.filename, "size": size, "sha256": sha,
                "reason": "batch_duplicate",
            })
            dup_records_to_insert.append({
                "id": str(uuid.uuid4()), "user_id": uid, "sha256": sha,
                "filename": it.filename, "size": size,
                "scanned_path": it.relative_path, "existing_path": seen_in_batch[sha],
                "vault_id": None, "reason": "batch_duplicate",
                "source": payload.source or "scan", "reclaimed": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            continue

        existing = vault_map.get(sha)
        if existing:
            duplicates += 1
            bytes_saved += size
            ex_path = existing.get("original_path") or existing.get("filename")
            duplicate_details.append({
                "scanned_path": it.relative_path, "existing_path": ex_path,
                "filename": it.filename, "size": size, "sha256": sha,
                "reason": "vault_match",
            })
            dup_records_to_insert.append({
                "id": str(uuid.uuid4()), "user_id": uid, "sha256": sha,
                "filename": it.filename, "size": size,
                "scanned_path": it.relative_path, "existing_path": ex_path,
                "vault_id": existing.get("id"), "reason": "vault_match",
                "source": payload.source or "scan", "reclaimed": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            continue

        seen_in_batch[sha] = it.relative_path
        record = FileRecord(
            user_id=uid, filename=it.filename, size=size,
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
            {"user_id": uid},
            {"$inc": {"duplicates_prevented": duplicates, "bytes_saved": int(bytes_saved)}},
            upsert=True,
        )

    return {
        "scanned": len(items), "added": added, "duplicates": duplicates,
        "bytes_saved": bytes_saved, "total_bytes_scanned": total_bytes,
        "root_label": payload.root_label, "source": payload.source,
        "duplicate_details": duplicate_details[:500],
    }


@api_router.get("/files")
async def list_files(
    q: Optional[str] = None, category: Optional[str] = None,
    skip: int = 0, limit: int = 100,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(limit, 500))
    query: dict = {"user_id": user["user_id"]}
    if category and category != "all":
        query["file_category"] = category
    if q:
        query["$or"] = [
            {"filename": {"$regex": q, "$options": "i"}},
            {"sha256": {"$regex": q, "$options": "i"}},
            {"original_path": {"$regex": q, "$options": "i"}},
            {"mime_type": {"$regex": q, "$options": "i"}},
        ]
    total = await db.files.count_documents(query)
    items = await db.files.find(query, {"_id": 0}) \
        .sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(get_current_user)):
    r = await db.files.delete_one({"id": file_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
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


async def _stream_csv(cursor, headers):
    yield _csv_line(headers)
    async for r in cursor:
        yield _csv_line([r.get(h, "") for h in headers])


async def _stream_json(cursor):
    yield "[\n"
    first = True
    async for r in cursor:
        prefix = "" if first else ",\n"
        first = False
        yield prefix + json.dumps(r, default=str)
    yield "\n]\n"


FILE_HEADERS = ["id", "filename", "size", "mime_type", "sha256",
                "file_category", "original_path", "created_at"]
APP_HEADERS = ["id", "app_name", "version", "platform", "install_path", "notes", "created_at"]


@api_router.get("/files/export")
async def export_files(format: str = "json", user: dict = Depends(get_current_user)):
    cursor = db.files.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    if format.lower() == "csv":
        return StreamingResponse(_stream_csv(cursor, FILE_HEADERS), media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=mononode_files.csv"})
    return StreamingResponse(_stream_json(cursor), media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=mononode_files.json"})


# ============================================================================
# Apps
# ============================================================================

@api_router.post("/apps")
async def register_app(payload: AppRegistryCreate, user: dict = Depends(get_current_user)):
    key = {
        "user_id": user["user_id"],
        "app_name": {"$regex": f"^{payload.app_name}$", "$options": "i"},
        "version": payload.version,
    }
    existing = await db.apps.find_one(key, {"_id": 0})
    if existing:
        return {"duplicate": True, "record": existing}
    entry = AppRegistryEntry(user_id=user["user_id"], **payload.model_dump())
    doc = entry.model_dump()
    await db.apps.insert_one(doc)
    doc.pop("_id", None)
    return {"duplicate": False, "record": doc}


@api_router.get("/apps")
async def list_apps(
    q: Optional[str] = None, platform: Optional[str] = None,
    skip: int = 0, limit: int = 100,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(limit, 500))
    query: dict = {"user_id": user["user_id"]}
    if platform and platform != "all":
        query["platform"] = platform
    if q:
        query["$or"] = [
            {"app_name": {"$regex": q, "$options": "i"}},
            {"version": {"$regex": q, "$options": "i"}},
            {"install_path": {"$regex": q, "$options": "i"}},
        ]
    total = await db.apps.count_documents(query)
    items = await db.apps.find(query, {"_id": 0}) \
        .sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.delete("/apps/{app_id}")
async def delete_app(app_id: str, user: dict = Depends(get_current_user)):
    r = await db.apps.delete_one({"id": app_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="App not found")
    return {"deleted": True}


@api_router.get("/apps/export")
async def export_apps(format: str = "json", user: dict = Depends(get_current_user)):
    cursor = db.apps.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    if format.lower() == "csv":
        return StreamingResponse(_stream_csv(cursor, APP_HEADERS), media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=mononode_apps.csv"})
    return StreamingResponse(_stream_json(cursor), media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=mononode_apps.json"})


# ============================================================================
# Duplicates
# ============================================================================

def _shell_quote_posix(p: str) -> str:
    return "'" + p.replace("'", "'\"'\"'") + "'"


def _reclaim_block_posix(dup: dict) -> str:
    dup_path = _shell_quote_posix(dup["scanned_path"])
    orig_path = _shell_quote_posix(dup["existing_path"])
    return (
        f"# --- {dup['filename']} ({dup['size']} bytes, sha={dup['sha256'][:16]}…) ---\n"
        f"DUP={dup_path}\n"
        f"ORIG={orig_path}\n"
        "if [ -f \"$DUP\" ] && [ -f \"$ORIG\" ] && [ ! -L \"$DUP\" ]; then\n"
        "  cp -p \"$DUP\" \"/tmp/$(basename \"$DUP\").mononode.bak\" 2>/dev/null || true\n"
        "  rm \"$DUP\" && ln -s \"$ORIG\" \"$DUP\" && echo \"[✓] reclaimed: $DUP\"\n"
        "else\n"
        "  echo \"[·] skipped (missing or already symlink): $DUP\"\n"
        "fi\n"
    )


def _reclaim_script_posix_single(dup: dict) -> str:
    return (
        "#!/usr/bin/env bash\n"
        "# MonoNode reclaim script — replaces a duplicate with a symlink to the canonical copy.\n"
        "set -euo pipefail\n\n"
        + _reclaim_block_posix(dup)
    )


def _reclaim_script_posix_bulk(dups: List[dict]) -> str:
    header = (
        "#!/usr/bin/env bash\n"
        "# MonoNode Reclaim-All script\n"
        f"# Generated: {datetime.now(timezone.utc).isoformat()}\n"
        f"# Duplicates: {len(dups)}\n"
        "# Each duplicate is backed up to /tmp before replacement.\n"
        "set -uo pipefail\n\n"
    )
    return header + "\n".join(_reclaim_block_posix(d) for d in dups)


def _reclaim_block_windows(dup: dict) -> str:
    dup_p = dup["scanned_path"].replace("\"", "`\"")
    orig_p = dup["existing_path"].replace("\"", "`\"")
    return (
        f"# --- {dup['filename']} ({dup['size']} bytes) ---\r\n"
        f"$dup = \"{dup_p}\"\r\n"
        f"$orig = \"{orig_p}\"\r\n"
        "if ((Test-Path -LiteralPath $dup) -and (Test-Path -LiteralPath $orig) -and -not (Get-Item -LiteralPath $dup).LinkType) {\r\n"
        "  Copy-Item -LiteralPath $dup -Destination (Join-Path $env:TEMP ((Split-Path $dup -Leaf) + '.mononode.bak')) -ErrorAction SilentlyContinue\r\n"
        "  Remove-Item -LiteralPath $dup -Force\r\n"
        "  New-Item -ItemType SymbolicLink -Path $dup -Target $orig | Out-Null\r\n"
        "  Write-Host \"[+] reclaimed: $dup\"\r\n"
        "} else {\r\n"
        "  Write-Host \"[.] skipped: $dup\"\r\n"
        "}\r\n"
    )


def _reclaim_script_windows_single(dup: dict) -> str:
    return (
        "# MonoNode reclaim script (PowerShell)\r\n"
        "$ErrorActionPreference = 'Continue'\r\n\r\n"
        + _reclaim_block_windows(dup)
    )


def _reclaim_script_windows_bulk(dups: List[dict]) -> str:
    header = (
        "# MonoNode Reclaim-All script (PowerShell)\r\n"
        f"# Generated: {datetime.now(timezone.utc).isoformat()}\r\n"
        f"# Duplicates: {len(dups)}\r\n"
        "# Requires Developer Mode or elevated PowerShell for symlinks.\r\n"
        "$ErrorActionPreference = 'Continue'\r\n\r\n"
    )
    return header + "\r\n".join(_reclaim_block_windows(d) for d in dups)


@api_router.get("/duplicates")
async def list_duplicates(
    q: Optional[str] = None, reason: Optional[str] = None,
    reclaimed: Optional[bool] = None, skip: int = 0, limit: int = 100,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(limit, 500))
    query: dict = {"user_id": user["user_id"]}
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
    total = await db.duplicates.count_documents(query)
    items = await db.duplicates.find(query, {"_id": 0}) \
        .sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/duplicates/stats")
async def duplicates_stats(user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    total = await db.duplicates.count_documents({"user_id": uid})
    active = await db.duplicates.count_documents({"user_id": uid, "reclaimed": False})
    reclaimed = await db.duplicates.count_documents({"user_id": uid, "reclaimed": True})
    agg = await db.duplicates.aggregate([
        {"$match": {"user_id": uid, "reclaimed": False}},
        {"$group": {"_id": None, "bytes": {"$sum": "$size"}}}
    ]).to_list(1)
    return {"total": total, "active": active, "reclaimed": reclaimed,
            "reclaimable_bytes": (agg[0]["bytes"] if agg else 0)}


@api_router.delete("/duplicates/{dup_id}")
async def delete_duplicate(dup_id: str, user: dict = Depends(get_current_user)):
    r = await db.duplicates.delete_one({"id": dup_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    return {"deleted": True}


@api_router.post("/duplicates/{dup_id}/mark-reclaimed")
async def mark_reclaimed(dup_id: str, user: dict = Depends(get_current_user)):
    r = await db.duplicates.update_one(
        {"id": dup_id, "user_id": user["user_id"]},
        {"$set": {"reclaimed": True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    return {"reclaimed": True}


@api_router.get("/duplicates/{dup_id}/script")
async def reclaim_script(dup_id: str, platform: str = "posix",
                        user: dict = Depends(get_current_user)):
    dup = await db.duplicates.find_one(
        {"id": dup_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not dup:
        raise HTTPException(status_code=404, detail="Duplicate not found")
    plat = (platform or "posix").lower()
    safe = "".join(ch if ch.isalnum() else "_" for ch in dup["filename"])[:40] or "reclaim"
    if plat in ("windows", "win", "powershell", "ps1"):
        return PlainTextResponse(_reclaim_script_windows_single(dup), media_type="text/plain",
            headers={"Content-Disposition": f"attachment; filename=reclaim_{safe}.ps1"})
    return PlainTextResponse(_reclaim_script_posix_single(dup), media_type="text/x-shellscript",
        headers={"Content-Disposition": f"attachment; filename=reclaim_{safe}.sh"})


@api_router.get("/duplicates/reclaim-all")
async def reclaim_all(platform: str = "posix",
                      user: dict = Depends(get_current_user)):
    """Master script that reclaims EVERY active duplicate in one shot."""
    rows = await db.duplicates.find(
        {"user_id": user["user_id"], "reclaimed": False}, {"_id": 0}
    ).sort("created_at", -1).to_list(10000)
    if not rows:
        raise HTTPException(status_code=404, detail="No active duplicates to reclaim")
    plat = (platform or "posix").lower()
    if plat in ("windows", "win", "powershell", "ps1"):
        return PlainTextResponse(_reclaim_script_windows_bulk(rows), media_type="text/plain",
            headers={"Content-Disposition": "attachment; filename=reclaim_all.ps1"})
    return PlainTextResponse(_reclaim_script_posix_bulk(rows), media_type="text/x-shellscript",
        headers={"Content-Disposition": "attachment; filename=reclaim_all.sh"})


# ============================================================================
# Stats
# ============================================================================

@api_router.get("/stats")
async def stats(user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    total_files = await db.files.count_documents({"user_id": uid})
    total_apps = await db.apps.count_documents({"user_id": uid})
    counter = await get_counter(uid)
    by_cat: dict = {}
    async for row in db.files.aggregate([
        {"$match": {"user_id": uid}},
        {"$group": {"_id": "$file_category", "count": {"$sum": 1}, "bytes": {"$sum": "$size"}}}
    ]):
        by_cat[row["_id"]] = {"count": row["count"], "bytes": row["bytes"]}
    tb = await db.files.aggregate([
        {"$match": {"user_id": uid}},
        {"$group": {"_id": None, "bytes": {"$sum": "$size"}}}
    ]).to_list(1)
    total_bytes = tb[0]["bytes"] if tb else 0
    return {
        "total_files": total_files,
        "total_apps": total_apps,
        "duplicates_prevented": counter.get("duplicates_prevented", 0),
        "bytes_saved": counter.get("bytes_saved", 0),
        "total_bytes_tracked": total_bytes,
        "by_category": by_cat,
    }


# ============================================================================
# Agent script (no auth required — script itself uses --token)
# ============================================================================

@api_router.get("/")
async def root():
    return {"service": "MonoNode Dedup API", "status": "online"}


@api_router.get("/agent/monoscan.py", response_class=PlainTextResponse)
async def agent_script(request_backend: Optional[str] = None):
    body = (ROOT_DIR / "agent" / "monoscan.py").read_text(encoding="utf-8")
    backend_url = request_backend or os.environ.get("PUBLIC_BACKEND_URL", "")
    if backend_url:
        body = body.replace("__BACKEND_URL__", backend_url)
    return PlainTextResponse(
        body,
        headers={"Content-Disposition": "attachment; filename=monoscan.py"},
        media_type="text/x-python",
    )


# ============================================================================
# App bootstrap
# ============================================================================

app.include_router(api_router)

# CORS — for cookies we need explicit origins + allow_credentials=True
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
