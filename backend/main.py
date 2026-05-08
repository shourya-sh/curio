from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before any code reads os.environ (DATABASE_URL, GEMINI_API_KEY, …).
# override=True so local .env wins over stale or placeholder GEMINI_* in the shell/OS env.
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from db import get_db
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from logger import get_logger
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = get_logger("app") # logger for the overall app


@asynccontextmanager
async def lifespan(app: FastAPI):
    from ai import gemini_configured, gemini_key_pool_size

    if gemini_configured():
        logger.info("Gemini key pool at startup: %s key(s)", gemini_key_pool_size())
    yield


app = FastAPI(title="Curio", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    # Also allow local-network dev hosts (e.g. http://192.168.x.x:5173).
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
#routers below!
from routers import session_router, node_router, link_router, profile_router
app.include_router(session_router.router)
app.include_router(node_router.router)
app.include_router(link_router.router)
app.include_router(profile_router.router)


#health check + db check
@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db.commit()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}

