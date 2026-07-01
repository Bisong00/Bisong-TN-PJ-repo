from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import hashlib
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
