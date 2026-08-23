from pathlib import Path

import asyncpg


SCHEMA_PATH = Path(__file__).with_name("sql") / "schema.sql"


async def create_pool(settings):
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=10,
        command_timeout=30,
    )

async def initialize_database(pool):
    schema = SCHEMA_PATH.read_text(encoding="utf-8")

    async with pool.acquire() as connection:
        await connection.execute(schema)