"""google_sub pada users (Sprint 1 — Google Sign-In)

Revision ID: b7c4d9e1a2f3
Revises: e3f96f221dba
Create Date: 2026-09-04

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c4d9e1a2f3"
down_revision: str | Sequence[str] | None = "e3f96f221dba"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_sub", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])


def downgrade() -> None:
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
