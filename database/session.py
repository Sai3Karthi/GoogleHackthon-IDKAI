"""Database engine and session management utilities."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager, contextmanager
from functools import lru_cache
from typing import AsyncIterator, Iterator

import asyncio
import sys

try:  # Prefer asyncpg on platforms where it's available
    import asyncpg  # type: ignore  # noqa: F401
    _HAS_ASYNCPG = True
except ImportError:  # pragma: no cover - optional dependency
    _HAS_ASYNCPG = False

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from config_loader import get_config
from .models import Base


if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:  # pragma: no cover - defensive guard
        pass

_PREFER_ASYNCPG = _HAS_ASYNCPG and sys.platform.startswith("win")


def resolve_database_url() -> str:
    """Return the base database URL using config precedence."""
    config = get_config()
    return config.get_database_url()


def resolve_async_database_url() -> str:
    """Return database URL with async driver injected."""
    return _ensure_async_driver(resolve_database_url())


def resolve_sync_database_url() -> str:
    """Return database URL with sync driver injected."""
    return _ensure_sync_driver(resolve_database_url())


def _ensure_async_driver(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        if not _HAS_ASYNCPG:
            return url.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
        return url
    if url.startswith("postgresql+psycopg://"):
        if _PREFER_ASYNCPG:
            return url.replace("postgresql+psycopg://", "postgresql+asyncpg://", 1)
        return url
    if url.startswith("postgresql+psycopg_async://"):
        if _PREFER_ASYNCPG:
            return url.replace("postgresql+psycopg_async://", "postgresql+asyncpg://", 1)
        return url
    if url.startswith("postgresql://"):
        driver = "asyncpg" if _PREFER_ASYNCPG else "psycopg"
        return url.replace("postgresql://", f"postgresql+{driver}://", 1)
    if url.startswith("postgres://"):
        driver = "asyncpg" if _PREFER_ASYNCPG else "psycopg"
        return url.replace("postgres://", f"postgresql+{driver}://", 1)
    if url.startswith("sqlite+aiosqlite://"):
        return url
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    return url


def _ensure_sync_driver(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("sqlite://"):
        return url
    return url


@lru_cache(maxsize=1)
def get_async_engine() -> AsyncEngine:
    async_url = resolve_async_database_url()
    url = make_url(async_url)

    engine_kwargs = {
        "echo": get_config().get_database_echo(),
        "pool_pre_ping": True,
    }

    pool_size = os.getenv("DATABASE_POOL_SIZE")
    max_overflow = os.getenv("DATABASE_MAX_OVERFLOW")

    if url.get_backend_name().startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = NullPool
    else:
        if pool_size:
            engine_kwargs["pool_size"] = int(pool_size)
        if max_overflow:
            engine_kwargs["max_overflow"] = int(max_overflow)

    return create_async_engine(async_url, **engine_kwargs)


@lru_cache(maxsize=1)
def _get_async_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_async_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


@asynccontextmanager
async def get_async_session() -> AsyncIterator[AsyncSession]:
    """Provide a scoped AsyncSession."""
    session_factory = _get_async_session_factory()
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@lru_cache(maxsize=1)
def get_sync_engine():
    sync_url = resolve_sync_database_url()
    url = make_url(sync_url)

    engine_kwargs = {
        "echo": get_config().get_database_echo(),
        "pool_pre_ping": True,
    }

    if url.get_backend_name().startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = NullPool
    else:
        pool_size = os.getenv("DATABASE_POOL_SIZE")
        max_overflow = os.getenv("DATABASE_MAX_OVERFLOW")
        if pool_size:
            engine_kwargs["pool_size"] = int(pool_size)
        if max_overflow:
            engine_kwargs["max_overflow"] = int(max_overflow)

    return create_engine(sync_url, **engine_kwargs)


@lru_cache(maxsize=1)
def _get_sync_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_sync_engine(), expire_on_commit=False, autoflush=False)


@contextmanager
def get_sync_session() -> Iterator[Session]:
    """Context manager for synchronous session usage (e.g., migrations, scripts)."""
    session_factory = _get_sync_session_factory()
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_database_schema() -> None:
    """Ensure all ORM tables are created in the configured database."""
    engine = get_sync_engine()
    Base.metadata.create_all(bind=engine)
