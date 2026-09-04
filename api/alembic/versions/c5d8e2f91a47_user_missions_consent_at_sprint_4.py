"""user_missions.consent_at — bukti consent foto server-side (Sprint 4, §2.1 #6)

Revision ID: c5d8e2f91a47
Revises: be22b49a6dc5
Create Date: 2026-09-05 08:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d8e2f91a47"
down_revision: str | Sequence[str] | None = "be22b49a6dc5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Catat waktu persetujuan penggunaan foto bukti (PRD §9) di server."""
    op.add_column(
        "user_missions",
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_missions", "consent_at")
