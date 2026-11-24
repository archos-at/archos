from __future__ import annotations


def terminal_job_statuses() -> tuple[str, ...]:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    return (JobStatus.SUCCESS.value, JobStatus.FAILURE.value, JobStatus.INTERRUPTED.value)
