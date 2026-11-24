from __future__ import annotations


class JobAdmissionError(RuntimeError):
    def __init__(self, message: str, retry_after_seconds: int = 30):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds
