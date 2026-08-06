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
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
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


class PriceTarget(Base):
    """User-defined price targets per watchlist symbol."""
    __tablename__ = "price_targets"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    symbol       = Column(String(20), nullable=False, index=True)
    target_price = Column(Float, nullable=False)
    target_date  = Column(String(10), nullable=True)   # YYYY-MM-DD optional deadline
    note         = Column(String(300), nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)


class OptionsPosition(Base):
    """Open options positions for P&L tracking."""
    __tablename__ = "options_positions"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    symbol         = Column(String(20), nullable=False, index=True)
    option_type    = Column(String(4), nullable=False)    # 'call' | 'put'
    strike         = Column(Float, nullable=False)
    expiry         = Column(String(10), nullable=False)   # YYYY-MM-DD
    quantity       = Column(Integer, nullable=False)       # contracts (negative = short)
    entry_premium  = Column(Float, nullable=False)         # per share (×100 per contract)
    note           = Column(String(200), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)


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


# ── Merger Arb ───────────────────────────────────────────────────────────────

class MergerDeal(Base):
    __tablename__ = "merger_deals"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    target_ticker   = Column(String(20), nullable=False)
    target_name     = Column(String(200), default='')
    acquirer_name   = Column(String(200), default='')
    deal_type       = Column(String(20), default='cash')   # cash | stock | mixed
    offer_price     = Column(Float, nullable=False)
    announce_date   = Column(String(10), default='')       # YYYY-MM-DD
    expected_close  = Column(String(10), default='')       # YYYY-MM-DD
    status          = Column(String(30), default='pending_regulatory')
    deal_value_bn   = Column(Float, nullable=True)
    regulatory_body = Column(String(50), default='')
    notes           = Column(String(1000), default='')
    source          = Column(String(20), default='manual') # manual | edgar
    edgar_accession = Column(String(60), default='')
    created_at      = Column(DateTime, default=datetime.utcnow)


class ArbPosition(Base):
    __tablename__ = "arb_positions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    deal_id       = Column(Integer, nullable=False, index=True)   # references merger_deals.id
    shares        = Column(Float, nullable=False)
    entry_price   = Column(Float, nullable=False)
    entry_date    = Column(String(10), default='')                # YYYY-MM-DD
    notes         = Column(String(500), default='')
    created_at    = Column(DateTime, default=datetime.utcnow)


# ── SPACs ─────────────────────────────────────────────────────────────────────

class SpacDeal(Base):
    __tablename__ = "spac_deals"
    id                     = Column(Integer, primary_key=True, autoincrement=True)
    ticker                 = Column(String(20), nullable=False)
    company_name           = Column(String(200), default='')
    sponsor                = Column(String(200), default='')
    warrant_ticker         = Column(String(20), default='')
    warrant_strike         = Column(Float, default=11.5)
    warrant_ratio          = Column(Float, default=0.5)    # shares received per warrant exercised
    ipo_date               = Column(String(10), default='')
    trust_value_per_share  = Column(Float, default=10.0)
    trust_value_date       = Column(String(10), default='')   # as-of date for trust_value_per_share
    deadline_date          = Column(String(10), default='')
    status                 = Column(String(30), default='searching')  # searching|deal_announced|shareholder_vote|redemption_period|closing|completed|liquidated
    target_name            = Column(String(200), default='')
    deal_announce_date     = Column(String(10), default='')
    pipe_amount_mn         = Column(Float, nullable=True)
    notes                  = Column(String(1000), default='')
    source                 = Column(String(20), default='manual')  # manual | edgar
    edgar_accession        = Column(String(60), default='')
    created_at             = Column(DateTime, default=datetime.utcnow)


class SpacPosition(Base):
    __tablename__ = "spac_positions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    spac_id       = Column(Integer, nullable=False, index=True)   # references spac_deals.id
    security_type = Column(String(10), default='common')          # common | warrant
    shares        = Column(Float, nullable=False)                 # shares or warrant units
    entry_price   = Column(Float, nullable=False)
    entry_date    = Column(String(10), default='')
    notes         = Column(String(500), default='')
    created_at    = Column(DateTime, default=datetime.utcnow)


class SpacAlertRule(Base):
    __tablename__ = "spac_alert_rules"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    spac_id     = Column(Integer, nullable=False, index=True)   # references spac_deals.id
    alert_type  = Column(String(30), nullable=False)            # deadline_approaching | discount_threshold | deal_announced
    params      = Column(Text, default='{}')
    active      = Column(Integer, default=1)
    created_at  = Column(DateTime, default=datetime.utcnow)


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
        ("CREATE TABLE IF NOT EXISTS price_targets ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "symbol VARCHAR(20) NOT NULL, "
         "target_price REAL NOT NULL, "
         "target_date VARCHAR(10), "
         "note VARCHAR(300), "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS options_positions ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "symbol VARCHAR(20) NOT NULL, "
         "option_type VARCHAR(4) NOT NULL, "
         "strike REAL NOT NULL, "
         "expiry VARCHAR(10) NOT NULL, "
         "quantity INTEGER NOT NULL, "
         "entry_premium REAL NOT NULL, "
         "note VARCHAR(200), "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS smart_alert_rules ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "symbol VARCHAR(20) NOT NULL, "
         "alert_type VARCHAR(30) NOT NULL, "
         "params TEXT DEFAULT '{}', "
         "active INTEGER DEFAULT 1, "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS merger_deals ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "target_ticker VARCHAR(20) NOT NULL, "
         "target_name VARCHAR(200) DEFAULT '', "
         "acquirer_name VARCHAR(200) DEFAULT '', "
         "deal_type VARCHAR(20) DEFAULT 'cash', "
         "offer_price REAL NOT NULL, "
         "announce_date VARCHAR(10) DEFAULT '', "
         "expected_close VARCHAR(10) DEFAULT '', "
         "status VARCHAR(30) DEFAULT 'pending_regulatory', "
         "deal_value_bn REAL, "
         "regulatory_body VARCHAR(50) DEFAULT '', "
         "notes VARCHAR(1000) DEFAULT '', "
         "source VARCHAR(20) DEFAULT 'manual', "
         "edgar_accession VARCHAR(60) DEFAULT '', "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS arb_positions ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "deal_id INTEGER NOT NULL, "
         "shares REAL NOT NULL, "
         "entry_price REAL NOT NULL, "
         "entry_date VARCHAR(10) DEFAULT '', "
         "notes VARCHAR(500) DEFAULT '', "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS spac_deals ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "ticker VARCHAR(20) NOT NULL, "
         "company_name VARCHAR(200) DEFAULT '', "
         "sponsor VARCHAR(200) DEFAULT '', "
         "warrant_ticker VARCHAR(20) DEFAULT '', "
         "warrant_strike REAL DEFAULT 11.5, "
         "warrant_ratio REAL DEFAULT 0.5, "
         "ipo_date VARCHAR(10) DEFAULT '', "
         "trust_value_per_share REAL DEFAULT 10.0, "
         "trust_value_date VARCHAR(10) DEFAULT '', "
         "deadline_date VARCHAR(10) DEFAULT '', "
         "status VARCHAR(30) DEFAULT 'searching', "
         "target_name VARCHAR(200) DEFAULT '', "
         "deal_announce_date VARCHAR(10) DEFAULT '', "
         "pipe_amount_mn REAL, "
         "notes VARCHAR(1000) DEFAULT '', "
         "source VARCHAR(20) DEFAULT 'manual', "
         "edgar_accession VARCHAR(60) DEFAULT '', "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS spac_positions ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "spac_id INTEGER NOT NULL, "
         "security_type VARCHAR(10) DEFAULT 'common', "
         "shares REAL NOT NULL, "
         "entry_price REAL NOT NULL, "
         "entry_date VARCHAR(10) DEFAULT '', "
         "notes VARCHAR(500) DEFAULT '', "
         "created_at DATETIME)"),
        ("CREATE TABLE IF NOT EXISTS spac_alert_rules ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT, "
         "spac_id INTEGER NOT NULL, "
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
