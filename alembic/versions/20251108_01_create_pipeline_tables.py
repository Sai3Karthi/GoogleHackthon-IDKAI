"""Create pipeline session and module result tables."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251108_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pipeline_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("analysis_mode", sa.String(length=32), nullable=True),
        sa.Column("input_type", sa.String(length=32), nullable=True),
        sa.Column("input_text", sa.Text(), nullable=True),
        sa.Column("input_url", sa.Text(), nullable=True),
        sa.Column("input_metadata", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("skip_to_final", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("skip_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "module_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("module_name", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="completed"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["session_id"], ["pipeline_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("session_id", "module_name", name="uq_module_results_session_module"),
    )

    op.create_index(
        "ix_module_results_session_id",
        "module_results",
        ["session_id"],
    )
    op.create_index(
        "ix_module_results_module_name",
        "module_results",
        ["module_name"],
    )


def downgrade() -> None:
    op.drop_index("ix_module_results_module_name", table_name="module_results")
    op.drop_index("ix_module_results_session_id", table_name="module_results")
    op.drop_table("module_results")
    op.drop_table("pipeline_sessions")
