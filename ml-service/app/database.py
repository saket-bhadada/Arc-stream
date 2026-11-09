import os
from threading import Lock

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import declarative_base, sessionmaker

_engine: Engine | None = None
_engine_lock = Lock()

SessionLocal = sessionmaker(autocommit=False, autoflush=False)

Base = declarative_base()


def _get_engine() -> Engine:
    """Create the synchronous SQLAlchemy engine only when a DB-backed route needs it."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                database_url = os.getenv("DATABASE_URL")
                if not database_url:
                    raise RuntimeError("DATABASE_URL environment variable is not set.")

                url = make_url(database_url).set(drivername="postgresql+psycopg2")
                query = dict(url.query)
                ssl_mode = query.pop("ssl", None)
                if ssl_mode:
                    query.setdefault("sslmode", ssl_mode)
                if url.host and url.host.endswith(".pooler.supabase.com"):
                    query.setdefault("sslmode", "require")
                if query != dict(url.query):
                    url = url.set(query=query)

                _engine = create_engine(
                    url,
                    pool_pre_ping=True,
                    pool_size=2,
                    max_overflow=2,
                )
    return _engine


def get_db():
    db = SessionLocal(bind=_get_engine())
    try:
        yield db
    finally:
        db.close()
