import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import Column, DateTime, Float, Integer, String, Text, UniqueConstraint, create_engine
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


class WatchlistGroup(Base):
    """Named watchlists beyond the default one."""
    __tablename__ = "watchlist_groups"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    list_name = Column(String(50), nullable=False, index=True)
    symbol    = Column(String(20), nullable=False)
    added_at  = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("list_name", "symbol", name="uq_wlg_list_symbol"),)


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"
    id       = Column(Integer, primary_key=True, autoincrement=True)
    symbol   = Column(String(20), nullable=False)
    shares   = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)


class TradeJournalEntry(Base):
    __tablename__ = "trade_journal"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    symbol     = Column(String(20), nullable=False, index=True)
    side       = Column(String(10), nullable=False)   # 'buy' | 'sell'
    price      = Column(Float, nullable=False)
    shares     = Column(Float, nullable=False)
    strategy   = Column(String(50), nullable=True)
    trade_date = Column(String(20), nullable=False)   # YYYY-MM-DD
    notes      = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PortfolioSnapshot(Base):
    """Daily portfolio value snapshots for the equity curve."""
    __tablename__ = "portfolio_snapshots"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    date        = Column(String(10), unique=True, nullable=False)   # YYYY-MM-DD
    total_value = Column(Float, nullable=False)
    total_cost  = Column(Float, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)


class SmartAlertRule(Base):
    """Condition-based alert rules (volume spike, gap, RSI, MA cross, earnings proximity)."""
    __tablename__ = "smart_alert_rules"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    symbol     = Column(String(20), nullable=False, index=True)
    alert_type = Column(String(30), nullable=False)   # volume_spike|gap_up|gap_down|rsi_overbought|rsi_oversold|golden_cross|death_cross|earnings_proximity
    params     = Column(Text, default='{}')           # JSON: thresholds/multipliers
    active     = Column(Integer, default=1)           # 1=active, 0=disabled
    created_at = Column(DateTime, default=datetime.utcnow)


class PriceAlert(Base):
    __tablename__ = "price_alerts"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    symbol        = Column(String(20), nullable=False, index=True)
    target_price  = Column(Float, nullable=False)
    condition     = Column(String(10), nullable=False)   # 'above' | 'below'
    note          = Column(String(200), nullable=True)
    status        = Column(String(20), default='active') # 'active' | 'triggered' | 'dismissed'
    alert_type    = Column(String(30), default='price')  # 'price' | 'pct_change' | 'week52_break' | 'volume_spike'
    trigger_value = Column(Float, nullable=True)         # threshold for pct_change/volume_spike
    created_at    = Column(DateTime, default=datetime.utcnow)
    triggered_at  = Column(DateTime, nullable=True)


# ── Generic key-value cache ───────────────────────────────────────────────────

class CacheEntry(Base):
    __tablename__ = "cache_entries"
    key        = Column(String(200), primary_key=True)
    data       = Column(Text, nullable=False)
    fetched_at = Column(DateTime, nullable=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def init_db():
    Base.metadata.create_all(bind=engine)


def migrate_db():
    """Add new columns to existing tables without dropping data."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE price_alerts ADD COLUMN alert_type VARCHAR(30) DEFAULT 'price'",
        "ALTER TABLE price_alerts ADD COLUMN trigger_value REAL",
        ("CREATE TABLE IF NOT EXISTS smart_alert_rules ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "symbol VARCHAR(20) NOT NULL, "
         "alert_type VARCHAR(30) NOT NULL, "
         "params TEXT DEFAULT '{}', "
         "active INTEGER DEFAULT 1, "
         "created_at DATETIME)"),
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # Column already exists


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
