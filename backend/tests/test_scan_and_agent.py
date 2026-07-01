"""Tests for MonoNode dedup backend: /api/files/scan, exports, agent script + regressions."""
import os
import csv
import io
import json
import hashlib
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s


# ---------- Root ----------
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200 and r.json().get("status") == "online"


# ---------- /api/files/scan ----------
class TestScan:
    def test_batch_duplicate_label_correct(self, session):
        """Within-batch duplicate must be labeled 'batch_duplicate' (not 'vault_match')."""
        sha_a = _sha(f"TEST_batch_alpha_{uuid.uuid4()}")
        sha_b = _sha(f"TEST_batch_beta_{uuid.uuid4()}")
        items = [
            {"filename": "TEST_alpha.txt", "size": 100, "sha256": sha_a,
             "relative_path": "/tmp/TEST_alpha.txt", "mime_type": "text/plain"},
            {"filename": "TEST_beta.pdf", "size": 200, "sha256": sha_b,
             "relative_path": "/tmp/TEST_beta.pdf", "mime_type": "application/pdf"},
            {"filename": "TEST_alpha_copy.txt", "size": 100, "sha256": sha_a,
             "relative_path": "/tmp/copy/TEST_alpha_copy.txt", "mime_type": "text/plain"},
        ]
        r = session.post(f"{API}/files/scan",
                         json={"items": items, "root_label": "/tmp", "source": "browser"})
        assert r.status_code == 200
        d = r.json()
        assert d["scanned"] == 3
        assert d["added"] == 2
        assert d["duplicates"] == 1
        assert d["bytes_saved"] == 100

        assert len(d["duplicate_details"]) == 1
        det = d["duplicate_details"][0]
        assert det["reason"] == "batch_duplicate", (
            f"expected batch_duplicate got {det['reason']}")
        assert det["sha256"] == sha_a
        assert det["existing_path"] == "/tmp/TEST_alpha.txt"

        # cleanup
        for f in session.get(f"{API}/files").json():
            if f["sha256"] in (sha_a, sha_b):
                session.delete(f"{API}/files/{f['id']}")

    def test_bulk_insert_many_unique(self, session):
        """Send many unique items; verify all were inserted, no duplicates counted."""
        pre = session.get(f"{API}/stats").json()
        pre_dups = pre.get("duplicates_prevented", 0)
        pre_files = pre.get("total_files", 0)

        N = 25
        shas = [_sha(f"TEST_bulk_{uuid.uuid4()}_{i}") for i in range(N)]
        items = [
            {"filename": f"TEST_bulk_{i}.bin", "size": 10 + i, "sha256": shas[i],
             "relative_path": f"/tmp/TEST_bulk_{i}.bin", "mime_type": "application/octet-stream"}
            for i in range(N)
        ]
        r = session.post(f"{API}/files/scan",
                         json={"items": items, "root_label": "/tmp", "source": "agent"})
        assert r.status_code == 200
        d = r.json()
        assert d["scanned"] == N
        assert d["added"] == N
        assert d["duplicates"] == 0
        assert d["bytes_saved"] == 0
        assert d["duplicate_details"] == []

        post = session.get(f"{API}/stats").json()
        assert post["duplicates_prevented"] == pre_dups
        assert post["total_files"] == pre_files + N

        # cleanup
        sha_set = set(shas)
        for f in session.get(f"{API}/files").json():
            if f["sha256"] in sha_set:
                session.delete(f"{API}/files/{f['id']}")

    def test_scan_new_plus_vault_match(self, session):
        """Mix: one existing-in-vault SHA + one new SHA."""
        sha_in_vault = _sha(f"TEST_vault_{uuid.uuid4()}")
        sha_new = _sha(f"TEST_new_{uuid.uuid4()}")

        r0 = session.post(f"{API}/files/scan", json={
            "items": [{"filename": "TEST_in_vault.txt", "size": 50, "sha256": sha_in_vault,
                       "relative_path": "/tmp/TEST_in_vault.txt", "mime_type": "text/plain"}],
            "root_label": "/tmp", "source": "browser"})
        assert r0.status_code == 200 and r0.json()["added"] == 1

        r = session.post(f"{API}/files/scan", json={
            "items": [
                {"filename": "TEST_in_vault_copy.txt", "size": 50, "sha256": sha_in_vault,
                 "relative_path": "/other/TEST_in_vault_copy.txt", "mime_type": "text/plain"},
                {"filename": "TEST_new.txt", "size": 300, "sha256": sha_new,
                 "relative_path": "/other/TEST_new.txt", "mime_type": "text/plain"},
            ],
            "root_label": "/other", "source": "agent"})
        assert r.status_code == 200
        d = r.json()
        assert d["added"] == 1 and d["duplicates"] == 1
        assert len(d["duplicate_details"]) == 1
        det = d["duplicate_details"][0]
        assert det["reason"] == "vault_match"
        assert det["existing_path"] == "/tmp/TEST_in_vault.txt"

        # cleanup
        for f in session.get(f"{API}/files").json():
            if f["sha256"] in (sha_in_vault, sha_new):
                session.delete(f"{API}/files/{f['id']}")


# ---------- Exports ----------
class TestExports:
    def test_files_export_csv(self, session):
        # Seed a file whose filename contains a comma and quote for escape testing
        sha = _sha(f"TEST_csv_{uuid.uuid4()}")
        tricky = 'TEST_csv,"quoted",name.txt'
        session.post(f"{API}/files/scan", json={
            "items": [{"filename": tricky, "size": 42, "sha256": sha,
                       "relative_path": "/tmp/" + tricky, "mime_type": "text/plain"}],
            "root_label": "/tmp", "source": "browser"})

        r = session.get(f"{API}/files/export", params={"format": "csv"})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "").lower()
        assert "attachment" in r.headers.get("content-disposition", "").lower()

        text = r.text
        first_line = text.splitlines()[0]
        assert first_line == "id,filename,size,mime_type,sha256,file_category,original_path,created_at"

        # Parse CSV and confirm the tricky filename round-trips
        reader = csv.DictReader(io.StringIO(text))
        found = [row for row in reader if row["sha256"] == sha]
        assert len(found) == 1
        assert found[0]["filename"] == tricky
        assert int(found[0]["size"]) == 42

        # cleanup
        for f in session.get(f"{API}/files").json():
            if f["sha256"] == sha:
                session.delete(f"{API}/files/{f['id']}")

    def test_files_export_json(self, session):
        r = session.get(f"{API}/files/export", params={"format": "json"})
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "").lower()
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        data = json.loads(r.text)
        assert isinstance(data, list)

    def test_apps_export_csv(self, session):
        # seed
        session.post(f"{API}/apps", json={
            "app_name": f"TEST_ExpApp_{uuid.uuid4().hex[:6]}",
            "version": "1.0.0", "install_path": "/tmp/TEST_expapp",
            "platform": "linux", "notes": "csv,\"test\"",
        })
        r = session.get(f"{API}/apps/export", params={"format": "csv"})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "").lower()
        first_line = r.text.splitlines()[0]
        assert first_line == "id,app_name,version,platform,install_path,notes,created_at"

    def test_apps_export_json(self, session):
        r = session.get(f"{API}/apps/export", params={"format": "json"})
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "").lower()
        assert isinstance(json.loads(r.text), list)


# ---------- Agent script ----------
class TestAgentScript:
    def test_agent_script_contains_new_flags(self, session):
        r = session.get(f"{API}/agent/monoscan.py")
        assert r.status_code == 200
        body = r.text
        assert "python" in r.headers.get("content-type", "").lower()
        for needle in ["--watch", "--replace-duplicates", "--yes", "--interval",
                       "cmd_watch", "do_replace_duplicates"]:
            assert needle in body, f"missing {needle} in agent script"

    def test_agent_script_backend_replacement(self, session):
        custom = "https://custom-backend.example.com"
        r = session.get(f"{API}/agent/monoscan.py", params={"request_backend": custom})
        assert r.status_code == 200
        assert custom in r.text
        assert "__BACKEND_URL__" not in r.text


# ---------- Regressions ----------
class TestUploadRegression:
    def test_upload_and_duplicate(self, session):
        content = ("TEST_reg_" + uuid.uuid4().hex).encode()
        digest = hashlib.sha256(content).hexdigest()
        r1 = session.post(f"{API}/files/upload",
                          files={"file": ("TEST_reg.txt", io.BytesIO(content), "text/plain")})
        assert r1.status_code == 200
        rec = r1.json()["record"]
        assert rec["sha256"] == digest

        r2 = session.post(f"{API}/files/upload",
                          files={"file": ("TEST_reg_copy.txt", io.BytesIO(content), "text/plain")})
        assert r2.status_code == 200 and r2.json()["duplicate"] is True
        session.delete(f"{API}/files/{rec['id']}")


class TestAppsRegression:
    def test_apps_crud(self, session):
        name = f"TEST_RegApp_{uuid.uuid4().hex[:6]}"
        payload = {"app_name": name, "version": "9.9.9",
                   "install_path": "/tmp/TEST_regapp", "platform": "linux", "notes": "reg-test"}
        r1 = session.post(f"{API}/apps", json=payload)
        assert r1.status_code == 200
        rec = r1.json()["record"]
        # case-insensitive dedup
        p2 = dict(payload); p2["app_name"] = name.lower()
        r2 = session.post(f"{API}/apps", json=p2)
        assert r2.status_code == 200 and r2.json()["duplicate"] is True
        # filter
        assert any(a["id"] == rec["id"]
                   for a in session.get(f"{API}/apps", params={"platform": "linux"}).json())
        # delete + 404
        assert session.delete(f"{API}/apps/{rec['id']}").status_code == 200
        assert session.delete(f"{API}/apps/nonexistent-xyz").status_code == 404


def test_stats_has_by_category(session):
    j = session.get(f"{API}/stats").json()
    for k in ("total_files", "total_apps", "duplicates_prevented", "bytes_saved",
              "total_bytes_tracked", "by_category"):
        assert k in j
