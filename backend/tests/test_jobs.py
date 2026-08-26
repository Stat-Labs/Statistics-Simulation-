"""Tests for the background job manager."""

import time

from jobs import JobManager


def _noop_report(progress, stage, message=None):
    pass


def test_submit_runs_and_succeeds():
    mgr = JobManager(max_workers=1)
    rec = mgr.submit(
        "profile",
        lambda report: report(0.5, "half") or {"ok": True, "v": 42},
    )
    # Poll briefly for completion.
    for _ in range(100):
        data = mgr.get(rec.jobId)
        if data["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.01)
    assert data["status"] == "succeeded"
    assert data["progress"] == 1.0
    assert data["result"] == {"ok": True, "v": 42}


def test_failure_is_surfaced():
    mgr = JobManager(max_workers=1)
    rec = mgr.submit("analyse", lambda report: (_ for _ in ()).throw(ValueError("boom")))
    for _ in range(100):
        data = mgr.get(rec.jobId)
        if data["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.01)
    assert data["status"] == "failed"
    assert "boom" in data["error"]
    assert data["result"] is None


def test_progress_reporter_updates_record():
    mgr = JobManager(max_workers=1)

    def body(r):
        r(0.15, "sniffing")
        time.sleep(0.05)
        r(0.62, "pass 1 done")
        time.sleep(0.05)
        r(1.0, "done")
        return {"ok": True}

    rec = mgr.submit("profile", body)
    stages = []
    for _ in range(100):
        data = mgr.get(rec.jobId)
        stages.append((data["progress"], data["stage"]))
        if data["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.01)
    assert data["status"] == "succeeded"
    assert (0.15, "sniffing") in stages
    assert (0.62, "pass 1 done") in stages
    assert data["progress"] == 1.0


def test_result_hidden_until_succeeded():
    mgr = JobManager(max_workers=1)
    started = threading_flag = __import__("threading").Event()

    def block(report):
        started.set()
        time.sleep(0.2)
        return {"ok": True}

    rec = mgr.submit("profile", block)
    started.wait(1)
    data = mgr.get(rec.jobId)
    assert data["status"] in ("queued", "running")
    assert data["result"] is None
    for _ in range(100):
        data = mgr.get(rec.jobId)
        if data["status"] == "succeeded":
            break
        time.sleep(0.02)
    assert data["result"] == {"ok": True}


def test_list_jobs_and_404():
    mgr = JobManager(max_workers=1)
    rec = mgr.submit("profile", lambda report: {"ok": True})
    for _ in range(100):
        data = mgr.get(rec.jobId)
        if data["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.01)
    jobs = mgr.list_jobs()
    assert any(j["jobId"] == rec.jobId for j in jobs)
    assert mgr.get("does-not-exist") is None


def test_ttl_expiry():
    mgr = JobManager(max_workers=1, ttl_seconds=0)
    rec = mgr.submit("profile", lambda report: {"ok": True})
    time.sleep(0.05)
    # A new submit triggers _expire; the finished job is dropped.
    mgr.submit("profile", lambda report: {"ok": True})
    assert mgr.get(rec.jobId) is None
