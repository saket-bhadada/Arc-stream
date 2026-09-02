"""Async PostgreSQL access for the recommendation service."""

from __future__ import annotations

from collections.abc import Sequence

import asyncpg


def _as_pgvector(values: Sequence[float]) -> str:
    """Serialize a vector in the text format accepted by pgvector."""
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


def _parse_pgvector(value: str) -> list[float]:
    return [float(item) for item in value.strip("[]").split(",") if item]


class ArcStreamDB:
    """Connection-pool owner and pgvector query boundary."""

    def __init__(self, dsn: str) -> None:
        if not dsn:
            raise RuntimeError("DATABASE_URL is required for the ML service.")
        # SQLAlchemy-style URLs are common in .env files but not accepted by asyncpg.
        self.dsn = dsn.replace("postgresql+psycopg2://", "postgresql://", 1)
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(self.dsn, min_size=2, max_size=10)
        print("[ArcStreamDB] asyncpg pool connected")

    async def disconnect(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None
            print("[ArcStreamDB] asyncpg pool closed")

    def _require_pool(self) -> asyncpg.Pool:
        if self.pool is None:
            raise RuntimeError("Database pool is not initialized. Call connect() first.")
        return self.pool

    async def find_nearest_tracks(
        self,
        predicted_vector: Sequence[float],
        excluded_track_ids: Sequence[str],
        limit: int = 1,
    ) -> list[dict[str, object]]:
        """Return unique nearest tracks, excluding IDs already used in a session."""
        if limit < 1:
            return []

        query = """
            SELECT
                id AS track_id,
                track_name,
                artists,
                energy,
                z_vector::text AS z_vector
            FROM track_features
            WHERE NOT (id = ANY($2::text[]))
            ORDER BY z_vector <-> $1::vector
            LIMIT $3
        """
        rows = await self._require_pool().fetch(
            query,
            _as_pgvector(predicted_vector),
            list(excluded_track_ids),
            limit,
        )
        return [
            {
                "track_id": row["track_id"],
                "track_name": row["track_name"],
                "artists": row["artists"],
                "energy": row["energy"],
                "z_vector": _parse_pgvector(row["z_vector"]),
            }
            for row in rows
        ]

    async def get_track_z_vector(self, track_id: str) -> list[float] | None:
        """Fetch a stored normalized vector by Spotify track ID."""
        row = await self._require_pool().fetchrow(
            "SELECT z_vector::text AS z_vector FROM track_features WHERE id = $1",
            track_id,
        )
        return _parse_pgvector(row["z_vector"]) if row is not None else None

    async def get_energy_seed(self, target_energy: float) -> list[float] | None:
        """Return a dataset vector near an energy target to start a playlist."""
        row = await self._require_pool().fetchrow(
            """
            SELECT z_vector::text AS z_vector
            FROM track_features
            ORDER BY ABS(energy - $1), id
            LIMIT 1
            """,
            target_energy,
        )
        return _parse_pgvector(row["z_vector"]) if row is not None else None

    async def ping(self) -> bool:
        try:
            return await self._require_pool().fetchval("SELECT 1") == 1
        except Exception:
            return False

    async def track_count(self) -> int:
        return int(await self._require_pool().fetchval("SELECT COUNT(*) FROM track_features"))
