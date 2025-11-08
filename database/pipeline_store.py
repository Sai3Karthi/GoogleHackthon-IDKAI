"""High-level CRUD helpers for pipeline sessions and module results."""

from __future__ import annotations

from typing import Any, Dict, Optional
import uuid

from sqlalchemy import select

from .exceptions import ModuleResultNotFoundError, SessionNotFoundError
from .models import ModuleResult, PipelineSession
from .session import get_async_session


def _as_uuid(value: uuid.UUID | str) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


async def create_pipeline_session(
    *,
    analysis_mode: Optional[str],
    input_type: Optional[str],
    input_text: Optional[str],
    input_url: Optional[str],
    input_metadata: Optional[Dict[str, Any]] = None,
    status: str = "pending",
) -> PipelineSession:
    async with get_async_session() as session:
        record = PipelineSession(
            analysis_mode=analysis_mode,
            input_type=input_type,
            input_text=input_text,
            input_url=input_url,
            input_metadata=input_metadata or {},
            status=status,
        )
        session.add(record)
        await session.flush()
        await session.refresh(record)
        return record


async def get_pipeline_session(session_id: uuid.UUID | str) -> PipelineSession:
    target_id = _as_uuid(session_id)
    async with get_async_session() as session:
        stmt = select(PipelineSession).where(PipelineSession.id == target_id)
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()
        if record is None:
            raise SessionNotFoundError(f"Session {target_id} not found")
        return record


async def mark_session_skip(
    session_id: uuid.UUID | str,
    *,
    skip_to_final: bool,
    skip_reason: Optional[str],
    status: str | None = None,
) -> PipelineSession:
    target_id = _as_uuid(session_id)
    async with get_async_session() as session:
        stmt = select(PipelineSession).where(PipelineSession.id == target_id)
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()
        if record is None:
            raise SessionNotFoundError(f"Session {target_id} not found")

        record.skip_to_final = skip_to_final
        record.skip_reason = skip_reason
        if status:
            record.status = status

        await session.flush()
        await session.refresh(record)
        return record


async def mark_session_completed(session_id: uuid.UUID | str, status: str = "completed") -> PipelineSession:
    target_id = _as_uuid(session_id)
    async with get_async_session() as session:
        stmt = select(PipelineSession).where(PipelineSession.id == target_id)
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()
        if record is None:
            raise SessionNotFoundError(f"Session {target_id} not found")

        record.status = status
        await session.flush()
        await session.refresh(record)
        return record


async def update_session_status(session_id: uuid.UUID | str, status: str) -> PipelineSession:
    """Update the pipeline session status without altering other fields."""
    target_id = _as_uuid(session_id)
    async with get_async_session() as session:
        stmt = select(PipelineSession).where(PipelineSession.id == target_id)
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()
        if record is None:
            raise SessionNotFoundError(f"Session {target_id} not found")

        record.status = status
        await session.flush()
        await session.refresh(record)
        return record


async def save_module_result(
    session_id: uuid.UUID | str,
    *,
    module_name: str,
    payload: Dict[str, Any],
    status: str = "completed",
) -> ModuleResult:
    target_id = _as_uuid(session_id)
    normalized_module = module_name.lower()

    async with get_async_session() as session:
        stmt = select(ModuleResult).where(
            ModuleResult.session_id == target_id,
            ModuleResult.module_name == normalized_module,
        )
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()

        if record is None:
            record = ModuleResult(
                session_id=target_id,
                module_name=normalized_module,
                payload=payload,
                status=status,
            )
            session.add(record)
        else:
            record.payload = payload
            record.status = status

        await session.flush()
        await session.refresh(record)
        return record


async def get_module_result(
    session_id: uuid.UUID | str,
    module_name: str,
) -> ModuleResult:
    target_id = _as_uuid(session_id)
    normalized_module = module_name.lower()

    async with get_async_session() as session:
        stmt = select(ModuleResult).where(
            ModuleResult.session_id == target_id,
            ModuleResult.module_name == normalized_module,
        )
        result = await session.execute(stmt)
        record = result.scalar_one_or_none()

        if record is None:
            raise ModuleResultNotFoundError(
                f"Module result for session {target_id} and module {normalized_module} not found"
            )
        return record


async def get_all_module_results(session_id: uuid.UUID | str) -> Dict[str, ModuleResult]:
    target_id = _as_uuid(session_id)
    async with get_async_session() as session:
        stmt = select(ModuleResult).where(ModuleResult.session_id == target_id)
        result = await session.execute(stmt)
        records = result.scalars().all()
        if not records:
            raise ModuleResultNotFoundError(f"No module results found for session {target_id}")
        return {record.module_name: record for record in records}
