"""Shared test fixtures.

isolated_db: every test in this suite runs against a throwaway SQLite
database instead of the real backend/stockmonitor.db, so running pytest can
never leave fixture data (mocked tickers, prices, watchlist/portfolio/alert
rows written by CRUD tests, etc.) in the database the running app actually
reads. Before this existed, test_main.py wrote directly into the real DB —
e.g. a mocked quote's name ("Test Corp") could sit in the real quote cache
for its TTL, and a crashed CRUD test could leave test rows in the user's
real watchlist or portfolio.

Every router reaches the database only through db_session()/cache_get()/
cache_set() in database.py, all of which call the module-level SessionLocal
by name at call time — so patching database.SessionLocal here is enough to
redirect the whole app, with no per-router changes needed.

A test module that needs additional isolated-DB setup (e.g. test_digest.py,
which also clears delivery-channel env vars) defines its own fixture named
`isolated_db`; pytest resolves a module-level fixture in place of this one
for that module, so the two never both run.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
from database import Base


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False))
    yield
