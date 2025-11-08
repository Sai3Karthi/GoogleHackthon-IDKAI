"""Shared database utilities for the IDK-AI pipeline."""

from .models import Base, PipelineSession, ModuleResult
from .session import (
    get_async_engine,
    get_async_session,
    get_sync_engine,
    initialize_database_schema,
    resolve_database_url,
    resolve_async_database_url,
    resolve_sync_database_url,
)
from .pipeline_store import (
    create_pipeline_session,
    get_pipeline_session,
    mark_session_completed,
    mark_session_skip,
    save_module_result,
    get_module_result,
    get_all_module_results,
    update_session_status,
)
from .exceptions import SessionNotFoundError, ModuleResultNotFoundError

__all__ = [
    "Base",
    "PipelineSession",
    "ModuleResult",
    "get_async_engine",
    "get_async_session",
    "get_sync_engine",
    "initialize_database_schema",
    "resolve_database_url",
    "resolve_async_database_url",
    "resolve_sync_database_url",
    "create_pipeline_session",
    "get_pipeline_session",
    "mark_session_completed",
    "mark_session_skip",
    "save_module_result",
    "get_module_result",
    "get_all_module_results",
    "update_session_status",
    "SessionNotFoundError",
    "ModuleResultNotFoundError",
]
