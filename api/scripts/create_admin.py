"""Buat user admin awal untuk panel admin.

Pemakaian:
    uv run python -m scripts.create_admin --email admin@ekoteologi.id \
        --password rahasia123 --nama "Admin"
Nilai default diambil dari env ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME bila ada.
"""

import argparse
import asyncio
import os

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models import User

DEFAULT_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@ekoteologi.id")
DEFAULT_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ekoteologi123")
DEFAULT_NAME = os.environ.get("ADMIN_NAME", "Administrator")


async def create_admin(email: str, password: str, full_name: str) -> None:
    if len(password) < 8:
        raise SystemExit("Password minimal 8 karakter.")
    async with get_session_factory()() as db:
        existing = (await db.scalars(select(User).where(User.email == email.lower()))).first()
        if existing:
            existing.role = "admin"
            existing.password_hash = hash_password(password)
            print(f"User {email} sudah ada — di-promote/reset jadi admin.")
        else:
            db.add(
                User(
                    email=email.lower(),
                    full_name=full_name,
                    role="admin",
                    password_hash=hash_password(password),
                )
            )
            print(f"Admin {email} dibuat.")
        await db.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Buat/reset user admin panel.")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--nama", default=DEFAULT_NAME)
    args = parser.parse_args()
    asyncio.run(create_admin(args.email, args.password, args.nama))
