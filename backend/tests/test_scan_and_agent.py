"""Tests for MonoNode dedup backend: /api/files/scan and /api/agent/monoscan.py + regressions."""
import os
import hashlib
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://no-duplicates-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s


# ---------- Root / health ----------
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("status") == "online"


# ---------- /api/files/scan ----------
class TestScan:
    def test_scan_dedup_within_batch_and_vault(self, session):
        # Get baseline stats
        pre = session.get(f"{API}/stats").json()
        pre_dups = pre.get("duplicates_prevented", 0)
        pre_saved = pre.get("bytes_saved", 0)
        pre_files = pre.get("total_files", 0)

        # First batch: two unique + one batch-duplicate of first
        sha_a = _sha(f"TEST_scan_alpha_{uuid.uuid4()}")
        sha_b = _sha(f"TEST_scan_beta_{uuid.uuid4()}")
        items = [
            {"filename": "TEST_alpha.txt", "size": 100, "sha256": sha_a,
             "relative_path": "/tmp/TEST_alpha.txt", "mime_type": "text/plain"},
            {"filename": "TEST_beta.pdf", "size": 200, "sha256": sha_b,
             "relative_path": "/tmp/TEST_beta.pdf", "mime_type": "application/pdf"},
            {"filename": "TEST_alpha_copy.txt", "size": 100, "sha256": sha_a,
             "relative_path": "/tmp/copy/TEST_alpha_copy.txt", "mime_type": "text/plain"},
        ]
        payload = {"items": items, "root_label": "/tmp/TEST", "source": "browser"}
        r = session.post(f"{API}/files/scan", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()

        # Aggregate fields present
        for k in ("scanned", "added", "duplicates", "bytes_saved",
                  "total_bytes_scanned", "root_label", "source", "duplicate_details"):
            assert k in data, f"missing key {k} in {data.keys()}"

        assert data["scanned"] == 3
        assert data["added"] == 2
        assert data["duplicates"] == 1
        assert data["bytes_saved"] == 100
        assert data["total_bytes_scanned"] == 400
        assert data["root_label"] == "/tmp/TEST"
        assert data["source"] == "browser"

        # Duplicate detail entry present with all fields
        assert len(data["duplicate_details"]) == 1
        d = data["duplicate_details"][0]
        for k in ("scanned_path", "existing_path", "filename", "size", "sha256", "reason"):
            assert k in d, f"missing {k}"
        assert d["reason"] in ("batch_duplicate", "vault_match")
        assert d["existing_path"] == "/tmp/TEST_alpha.txt"
        assert d["scanned_path"] == "/tmp/copy/TEST_alpha_copy.txt"
        assert d["sha256"] == sha_a

        # Second scan: same alpha again -> should be vault_match
        items2 = [
            {"filename": "TEST_alpha_v2.txt", "size": 100, "sha256": sha_a,
             "relative_path": "/other/TEST_alpha_v2.txt", "mime_type": "text/plain"},
        ]
        r2 = session.post(f"{API}/files/scan", json={"items": items2, "root_label": "/other", "source": "agent"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["added"] == 0
        assert d2["duplicates"] == 1
        assert d2["source"] == "agent"
        assert len(d2["duplicate_details"]) == 1
        det = d2["duplicate_details"][0]
        assert det["reason"] == "vault_match"
        # existing_path should point to the previously stored original path
        assert det["existing_path"] == "/tmp/TEST_alpha.txt"

        # Stats increments
        post = session.get(f"{API}/stats").json()
        assert post["duplicates_prevented"] == pre_dups + 2  # one batch + one vault
        assert post["bytes_saved"] == pre_saved + 200  # 100 + 100
        assert post["total_files"] == pre_files + 2  # only alpha and beta added

        # Verify persistence via GET /api/files (search by sha)
        got = session.get(f"{API}/files", params={"q": sha_a[:16]}).json()
        assert any(f["sha256"] == sha_a for f in got)

        # Cleanup: delete the two added files
        all_files = session.get(f"{API}/files").json()
        for f in all_files:
            if f["sha256"] in (sha_a, sha_b):
                session.delete(f"{API}/files/{f['id']}")

    def test_scan_empty_batch(self, session):
        r = session.post(f"{API}/files/scan", json={"items": [], "root_label": "", "source": "browser"})
        assert r.status_code == 200
        d = r.json()
        assert d["scanned"] == 0 and d["added"] == 0 and d["duplicates"] == 0


# ---------- /api/agent/monoscan.py ----------
class TestAgentScript:
    def test_agent_script_default(self, session):
        r = session.get(f"{API}/agent/monoscan.py")
        assert r.status_code == 200
        # text/x-python content type
        assert "python" in r.headers.get("content-type", "").lower()
        body = r.text
        assert "MonoScan" in body
        assert "def main" in body
        # If no backend passed and PUBLIC_BACKEND_URL not set, placeholder may still exist
        # Just verify script body is a valid python file
        assert body.startswith("#!/usr/bin/env python3") or "import" in body[:500]

    def test_agent_script_with_backend_replacement(self, session):
        custom = "https://custom-backend.example.com"
        r = session.get(f"{API}/agent/monoscan.py", params={"request_backend": custom})
        assert r.status_code == 200
        body = r.text
        assert custom in body
        assert "__BACKEND_URL__" not in body


# ---------- Regression: /api/files/upload dedup ----------
class TestUploadDedupRegression:
    def test_upload_and_duplicate(self, session):
        content = b"TEST_regression_upload_unique_bytes_12345"
        digest = hashlib.sha256(content).hexdigest()
        # First upload
        r1 = session.post(f"{API}/files/upload", files={"file": ("TEST_reg.txt", io.BytesIO(content), "text/plain")})
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["duplicate"] in (False, True)  # may already exist from a prior run
        rec = d1["record"]
        assert rec["sha256"] == digest

        # Second upload with same content
        r2 = session.post(f"{API}/files/upload", files={"file": ("TEST_reg_copy.txt", io.BytesIO(content), "text/plain")})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["duplicate"] is True
        assert d2["record"]["sha256"] == digest

        # cleanup
        session.delete(f"{API}/files/{rec['id']}")


# ---------- Regression: /api/apps dedup ----------
class TestAppsRegression:
    def test_apps_crud(self, session):
        payload = {
            "app_name": "TEST_RegApp",
            "version": "9.9.9",
            "install_path": "/tmp/TEST_regapp",
            "platform": "linux",
            "notes": "reg-test",
        }
        r1 = session.post(f"{API}/apps", json=payload)
        assert r1.status_code == 200
        d1 = r1.json()
        rec = d1["record"]

        # duplicate detection - case insensitive
        p2 = dict(payload)
        p2["app_name"] = "test_regapp"
        r2 = session.post(f"{API}/apps", json=p2)
        assert r2.status_code == 200
        assert r2.json()["duplicate"] is True

        # listing filter
        got = session.get(f"{API}/apps", params={"platform": "linux"}).json()
        assert any(a["id"] == rec["id"] for a in got)

        # delete
        dr = session.delete(f"{API}/apps/{rec['id']}")
        assert dr.status_code == 200

        # 404 for missing
        dr2 = session.delete(f"{API}/apps/nonexistent-id-xyz")
        assert dr2.status_code == 404


# ---------- Regression: filter / stats ----------
def test_stats_has_by_category(session):
    r = session.get(f"{API}/stats")
    assert r.status_code == 200
    j = r.json()
    for k in ("total_files", "total_apps", "duplicates_prevented", "bytes_saved",
              "total_bytes_tracked", "by_category"):
        assert k in j
