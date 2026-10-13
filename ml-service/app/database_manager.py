import os
from typing import Optional, Sequence
import asyncpg
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()


def _as_pgvector(values: Sequence[float]) -> str:
    """Serialize a vector in the text format accepted by pgvector."""
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


def _parse_pgvector(value: str) -> list[float]:
    return [float(item) for item in value.strip("[]").split(",") if item]


class ArcStreamDB:
    def __init__(self, dsn: str):
        if not dsn:
            raise RuntimeError(
                '[Arc-StreamDB] Database_url is not set in ml_service/app'
            )
        self.dsn = dsn.replace("postgresql+psycopg2://", "postgresql://", 1)
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(
            self.dsn,
            min_size=2,
            max_size=10,
        )
        print('[Arc-StreamDB] asyncpg pool connected')

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
            self.pool = None
            print('[Arc-StreamDB] asyncpg pool closed')

    def _require_pool(self) -> asyncpg.Pool:
        if self.pool is None:
            raise RuntimeError(
                '[ArcStreamDB] Pool not initialised. Call connect() first.'
            )
        return self.pool

    async def find_nearest_tracks(
        self,
        predicted_vector: Sequence[float],
        excluded_track_ids: Sequence[str] = (),
        limit: int = 1,
    ) -> list[dict[str, object]]:
        """Return unique nearest tracks, excluding IDs already used in a session."""
        if limit < 1:
            return []

        query = """
            SELECT
                id           AS track_id,
                track_name,
                artists,
                energy,
                z_vector::text AS z_vector
            FROM  track_features
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

    async def find_nearest_track(
        self,
        predicted_vector: list[float],
        session_history: list[str],
        top_k: int = 30,
        return_n: int = 3,
    ) -> list[dict]:
        fetch_limit = max(return_n, top_k + len(session_history))
        candidates = await self.find_nearest_tracks(
            predicted_vector, session_history, limit=fetch_limit
        )
        return candidates[:return_n]

    async def get_track_features(self, track_id: str) -> dict[str, object] | None:
        query = """
            SELECT
                id           AS track_id,
                track_name,
                artists,
                energy,
                valence,
                danceability,
                tempo
            FROM track_features
            WHERE id = $1
        """
        row = await self._require_pool().fetchrow(query, track_id)
        if not row:
            return None
        return {
            "track_id": row["track_id"],
            "track_name": row["track_name"],
            "artists": row["artists"],
            "energy": float(row["energy"]) if row["energy"] is not None else 0.0,
            "valence": float(row["valence"]) if row["valence"] is not None else 0.0,
            "danceability": float(row["danceability"]) if row["danceability"] is not None else 0.0,
            "tempo": float(row["tempo"]) if row["tempo"] is not None else 0.0,
        }

    async def get_energy_seed(self, target_energy: float) -> list[float] | None:
        """Return a dataset vector near an energy target to start a playlist."""
        query = """
            SELECT z_vector::text AS z_vector
            FROM track_features
            ORDER BY ABS(energy - $1), id
            LIMIT 1
        """
        row = await self._require_pool().fetchrow(query, target_energy)
        return _parse_pgvector(row["z_vector"]) if row is not None else None

    async def get_track_z_vector(self, track_id: str) -> list[float] | None:
        query = """
            SELECT z_vector::text AS z_vector_str
            FROM   track_features
            WHERE  id = $1
        """
        row = await self._require_pool().fetchrow(query, track_id)

        if not row:
            return None

        raw = row['z_vector_str'].strip('[]')
        return [float(v) for v in raw.split(',') if v]

    async def get_track_z_vectors_batch(self, track_ids: list[str]) -> dict[str, list[float]]:
        if not track_ids:
            return {}

        query = """
            SELECT id AS track_id, z_vector::text AS z_vector_str
            FROM   track_features
            WHERE  id = ANY($1::text[])
        """
        rows = await self._require_pool().fetch(query, track_ids)

        result = {}
        for row in rows:
            raw = row['z_vector_str'].strip('[]')
            result[row['track_id']] = [float(v) for v in raw.split(',') if v]
        return result

    async def ping(self) -> bool:
        try:
            return await self._require_pool().fetchval('SELECT 1') == 1
        except Exception:
            return False

    async def track_count(self) -> int:
        return int(await self._require_pool().fetchval('SELECT COUNT(*) FROM track_features'))