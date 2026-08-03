"""In-process background job manager.

Render Free gives a single small worker, so jobs run on a thread pool (default
one worker) and the queue keeps the HTTP endpoints responsive: the frontend
submits a job and polls `GET /jobs/{id}` for progress/result. State is
per-worker (like `ProfileCache`); a horizontally-scaled deployment would swap
this for a shared store (Redis etc.).
"""

from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Optional

# Progress reporter injected into job bodies: report(progress, stage).
ProgressReporter = Callable[[float, str], None]

JOB_TTL_SECONDS = 3600  # finished jobs are dropped after this long


@dataclass
class JobRecord:
    jobId: str
    kind: str  # "profile" | "analyse"
    status: str  # "queued" | "running" | "succeeded" | "failed"
    progress: float
    stage: str
    createdAt: float
    startedAt: Optional[float] = None
    finishedAt: Optional[float] = None
    result: Any = None
    error: Optional[str] = None
    message: Optional[str] = None

    def to_dict(self, include_result: bool) -> dict:
        return {
            "jobId": self.jobId,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 4),
            "stage": self.stage,
            "message": self.message,
            "createdAt": self.createdAt,
            "startedAt": self.startedAt,
            "finishedAt": self.finishedAt,
            "result": self.result if include_result else None,
            "error": self.error,
        }


class JobManager:
    """Thread-safe job registry + bounded worker pool."""

    def __init__(self, max_workers: int = 1, ttl_seconds: int = JOB_TTL_SECONDS):
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="statlab-job")
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds

    def submit(self, kind: str, fn: Callable[[ProgressReporter], dict]) -> JobRecord:
        with self._lock:
            rec = JobRecord(
                jobId=uuid.uuid4().hex[:12],
                kind=kind,
                status="queued",
                progress=0.0,
                stage="queued",
                createdAt=time.time(),
            )
            self._jobs[rec.jobId] = rec
            self._expire()
        self._pool.submit(self._run, rec, fn)
        return rec

    def _run(self, rec: JobRecord, fn: Callable[[ProgressReporter], dict]) -> None:
        def report(progress: float, stage: str, message: Optional[str] = None) -> None:
            with self._lock:
                rec.progress = max(0.0, min(1.0, progress))
                rec.stage = stage
                if message:
                    rec.message = message

        with self._lock:
            rec.status = "running"
            rec.startedAt = time.time()
            rec.stage = "starting"
        try:
            rec.result = fn(report)
            with self._lock:
                rec.status = "succeeded"
                rec.progress = 1.0
                rec.stage = "done"
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            with self._lock:
                rec.status = "failed"
                rec.error = str(exc)
                rec.stage = "failed"
        finally:
            with self._lock:
                rec.finishedAt = time.time()

    def get(self, job_id: str) -> Optional[dict]:
        with self._lock:
            rec = self._jobs.get(job_id)
            if rec is None:
                return None
            return rec.to_dict(include_result=rec.status == "succeeded")

    def list_jobs(self) -> list[dict]:
        with self._lock:
            self._expire()
            recs = list(self._jobs.values())
        return [r.to_dict(include_result=False) for r in recs]

    def _expire(self) -> None:
        now = time.time()
        stale = [
            jid
            for jid, r in self._jobs.items()
            if r.finishedAt is not None and now - r.finishedAt > self._ttl
        ]
        for jid in stale:
            del self._jobs[jid]
