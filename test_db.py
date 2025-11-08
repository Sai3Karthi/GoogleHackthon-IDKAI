"""Test database connection to Neon PostgreSQL"""
from database import get_sync_engine
from database.models import PipelineSession, ModuleResult
from sqlalchemy.orm import Session

engine = get_sync_engine()
with Session(engine) as session:
    pipeline_count = session.query(PipelineSession).count()
    result_count = session.query(ModuleResult).count()
    print(f"✓ Database connection successful!")
    print(f"✓ pipeline_sessions table: {pipeline_count} rows")
    print(f"✓ module_results table: {result_count} rows")
    print(f"\nDatabase is ready for use!")
