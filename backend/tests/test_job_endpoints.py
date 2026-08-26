"""End-to-end tests of the background-job endpoints via FastAPI TestClient."""

import io
import time

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _csv_bytes(rows=200):
    buf = io.StringIO()
    buf.write("id,value\n")
    for i in range(rows):
        buf.write(f"{i},{i * 1.0}\n")
    return buf.getvalue().encode()


def _poll(job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = client.get(f"/jobs/{job_id}")
        assert res.status_code == 200, res.text
        data = res.json()
        if data["status"] in ("succeeded", "failed"):
            return data
        time.sleep(0.05)
    raise AssertionError("job did not finish in time")


def test_profile_job_end_to_end():
    res = client.post(
        "/jobs/profile",
        files={"file": ("sample.csv", _csv_bytes(), "text/csv")},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["status"] in ("queued", "running")
    assert job["kind"] == "profile"
    assert job["result"] is None

    done = _poll(job["jobId"])
    assert done["status"] == "succeeded", done
    result = done["result"]
    assert result["success"] is True
    assert result["rowCount"] == 200
    assert result["columnCount"] == 2
    assert result["manifest"]["engineVersion"] == "streaming-1.0.0"
    assert result["cacheHit"] is False


def test_analyse_job_end_to_end():
    analyses = '{"mode":"manual","descriptive":{"columns":["value"]}}'
    res = client.post(
        "/jobs/analyse",
        files={"file": ("sample.csv", _csv_bytes(), "text/csv")},
        data={"analyses": analyses},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    done = _poll(job["jobId"])
    assert done["status"] == "succeeded", done
    result = done["result"]
    assert result["success"] is True
    # Alias applied: payload uses `schema` not `schema_`.
    assert "schema" in result
    assert result["schema"]["rowCount"] == 200
    assert len(result["result"]["descriptive"]) == 1


def test_failed_job_reports_error():
    res = client.post(
        "/jobs/profile",
        files={"file": ("bad.csv", b"", "text/csv")},
    )
    assert res.status_code == 200, res.text
    done = _poll(res.json()["jobId"])
    assert done["status"] == "failed"
    assert done["error"]


def test_get_unknown_job_404():
    res = client.get("/jobs/nope")
    assert res.status_code == 404


def test_list_jobs_returns_submitted():
    client.post(
        "/jobs/profile",
        files={"file": ("sample.csv", _csv_bytes(50), "text/csv")},
    )
    res = client.get("/jobs")
    assert res.status_code == 200
    assert any(j["kind"] == "profile" for j in res.json())
