import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    def __init__(self, *, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        hits = self._hits[key]
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= self.max_requests:
            retry_after = max(1, int(self.window_seconds - (now - hits[0])))
            raise HTTPException(
                status_code=429,
                detail=f"Too many AI requests. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)


ai_prompt_limiter = SlidingWindowLimiter(max_requests=8, window_seconds=60)


def client_rate_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


async def limit_ai_prompt(request: Request) -> None:
    ai_prompt_limiter.check(client_rate_key(request))
