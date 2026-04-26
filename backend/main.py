from db import get_db
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from logger import get_logger
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = get_logger("app") # logger for the overall app

app = FastAPI(title="Curio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
#routers below!

@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db.commit()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}
