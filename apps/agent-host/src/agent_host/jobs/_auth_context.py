from contextvars import ContextVar

from agent.auth import register_token_fetcher

job_auth_token: ContextVar[str | None] = ContextVar("job_auth_token", default=None)


def _job_token_fetcher() -> str | None:
    return job_auth_token.get()


register_token_fetcher(_job_token_fetcher, priority=5)
