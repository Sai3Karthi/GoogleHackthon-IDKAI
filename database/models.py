"""SQLAlchemy ORM models for the shared pipeline database."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[override]
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import UUID  # type: ignore import-error

            return dialect.type_descriptor(UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(uuid.UUID(value))

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class Base(DeclarativeBase):
    """Base declarative class."""


class PipelineSession(Base):
    """Represents a single pipeline execution across modules."""

    __tablename__ = "pipeline_sessions"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    analysis_mode: Mapped[Optional[str]] = mapped_column(String(32))
    input_type: Mapped[Optional[str]] = mapped_column(String(32))
    input_text: Mapped[Optional[str]] = mapped_column(Text)
    input_url: Mapped[Optional[str]] = mapped_column(Text)
    input_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    skip_to_final: Mapped[bool] = mapped_column(Boolean, default=False)
    skip_reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    module_results: Mapped[list["ModuleResult"]] = relationship(
        "ModuleResult",
        back_populates="session",
        cascade="all, delete-orphan",
    )


class ModuleResult(Base):
    """Stores per-module output payloads for a session."""

    __tablename__ = "module_results"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("pipeline_sessions.id", ondelete="CASCADE"), nullable=False
    )
    module_name: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed")
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    session: Mapped[PipelineSession] = relationship(
        "PipelineSession", back_populates="module_results"
    )

    __table_args__ = (
        UniqueConstraint("session_id", "module_name", name="uq_module_results_session_module"),
    )
