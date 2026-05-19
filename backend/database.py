import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import Column, DateTime, Float, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DB_PATH = os.path.join(os.path.dirname(__file__), "stockmonitor.db")
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Permanent user data ───────────────────────────────────────────────────────

class WatchlistSymbol(Base):
    __tablename__ = "watchlist"
    id       = Column(Integer, primary_key=True, autoincrement=True)
    symbol   = Column(String(20), unique=True, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"
    id       = Column(Integer, primary_key=True, autoincrement=True)
    symbol   = Column(String(20), nullable=False)
    shares   = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)


# ── Generic key-value cache ───────────────────────────────────────────────────

class CacheEntry(Base):
    __tablename__ = "cache_entries"
    key        = Column(String(200), primary_key=True)
    data       = Column(Text, nullable=False)
    fetched_at = Column(DateTime, nullable=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def init_db():
    Base.metadata.create_all(bind=engine)


@contextmanager
def db_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def cache_get(key: str, ttl: timedelta):
    with db_session() as db:
        row = db.query(CacheEntry).filter(CacheEntry.key == key).first()
        if row and (datetime.utcnow() - row.fetched_at) < ttl:
            return json.loads(row.data)
    return None


def cache_set(key: str, data) -> None:
    serialized = json.dumps(data, default=str)
    now = datetime.utcnow()
    with db_session() as db:
        row = db.query(CacheEntry).filter(CacheEntry.key == key).first()
        if row:
            row.data = serialized
            row.fetched_at = now
        else:
            db.add(CacheEntry(key=key, data=serialized, fetched_at=now))
