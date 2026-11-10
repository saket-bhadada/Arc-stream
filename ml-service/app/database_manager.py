import asyncio
import logging
from typing import Any, Optional, Sequence

import asyncpg
from pgvector.asyncpg import register_vector
from sqlalchemy.engine import make_url

logger = logging.getLogger(__name__)


def _as_pgvector(values: Sequence[float]) -> str:
    """Serialize a vector in the text format accepted by pgvector."""
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"


def _parse_pgvector(value: str) -> list[float]:
    return [float(item) for item in value.strip("[]").split(",") if item]


async def _register_pgvector(connection: asyncpg.Connection) -> None:
    schema = await connection.fetchval(
        """
        SELECT ns.nspname
        FROM pg_extension AS ext
        JOIN pg_namespace AS ns ON ns.oid = ext.extnamespace
        WHERE ext.extname = 'vector'
        """
    )
    if not schema:
        raise RuntimeError("pgvector is not installed; run CREATE EXTENSION vector.")
    await register_vector(connection, schema=schema)


class ArcStreamDB:
    def __init__(self, dsn: Optional[str]):
        self.dsn = dsn
        self.pool: Optional[asyncpg.Pool] = None
        self._connect_lock = asyncio.Lock()
        self._iterative_scan_supported: bool | None = None

    async def connect(self) -> None:
        if self.pool is not None:
            return

        async with self._connect_lock:
            if self.pool is not None:
                return
            if not self.dsn:
                raise RuntimeError("DATABASE_URL environment variable is not set.")

            url = make_url(self.dsn).set(drivername="postgresql")
            query = dict(url.query)
            ssl_mode = query.pop("sslmode", None)
            explicit_ssl = query.pop("ssl", None)
            if not ssl_mode:
                ssl_mode = explicit_ssl
            if url.host and url.host.endswith(".pooler.supabase.com"):
                ssl_mode = ssl_mode or "require"
            url = url.set(query=query)

            if ssl_mode:
                ssl_mode = str(ssl_mode).lower()
            ssl_setting: Optional[str | bool]
            if ssl_mode in ("require", "verify-ca", "verify-full"):
                ssl_setting = ssl_mode
            elif ssl_mode == "disable":
                ssl_setting = False
            else:
                ssl_setting = None

            pool_options: dict[str, Any] = {
                "dsn": url.render_as_string(hide_password=False),
                "min_size": 1,
                "max_size": 2,
                "statement_cache_size": 0,
                "init": _register_pgvector,
            }
            if ssl_setting is not None:
                pool_options["ssl"] = ssl_setting

            try:
                self.pool = await asyncpg.create_pool(**pool_options)
            except Exception as error:
                logger.warning(
                    "[Database] Async pool connection failed (%s); a later request will retry.",
                    type(error).__name__,
                )
                raise
            logger.info(
                "[Database] Async pool connected (Supabase pooler=%s).",
                bool(url.host and url.host.endswith(".pooler.supabase.com")),
            )

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
            self.pool = None
            logger.info("[Database] Async pool closed.")

    async def _get_pool(self) -> asyncpg.Pool:
        if self.pool is None:
            await self.connect()
        if self.pool is None:
            raise RuntimeError("Database pool could not be initialized.")
        return self.pool

    async def find_nearest_tracks(
        self,
        predicted_vector: Sequence[float],
        excluded_track_ids: Sequence[str] = (),
        limit: int = 1,
        allowed_ids: Sequence[str] | None = None,
    ) -> list[dict[str, object]]:
        """Return unique nearest tracks, excluding IDs already used in a session."""
        if limit < 1 or (allowed_ids is not None and not allowed_ids):
            return []

        if allowed_ids is None:
            query = """
                SELECT
                    id           AS track_id,
                    track_name,
                    artists,
                    energy,
                    valence,
                    danceability,
                    tempo,
                    z_vector::text AS z_vector
                FROM  track_features
                WHERE NOT (id = ANY($2::text[]))
                ORDER BY z_vector <-> $1::vector
                LIMIT $3
            """
        else:
            query = """
                SELECT
                    id           AS track_id,
                    track_name,
                    artists,
                    energy,
                    valence,
                    danceability,
                    tempo,
                    z_vector::text AS z_vector
                FROM  track_features
                WHERE id = ANY($1::text[])
                  AND NOT (id = ANY($3::text[]))
                ORDER BY z_vector <-> $2::vector
                LIMIT $4
            """

        pool = await self._get_pool()
        iterative_scan = (
            allowed_ids is not None
            and await self._supports_iterative_scan(pool)
        )
        requested_limit = limit
        max_fetch = len(allowed_ids) if allowed_ids is not None else limit
        fetch_limit = min(
            max_fetch,
            limit if iterative_scan else max(limit * 4, limit),
        )
        rows = []

        async with pool.acquire() as connection:
            while fetch_limit > 0:
                if allowed_ids is None:
                    params = (
                        _as_pgvector(predicted_vector),
                        list(excluded_track_ids),
                        fetch_limit,
                    )
                else:
                    params = (
                        list(allowed_ids),
                        _as_pgvector(predicted_vector),
                        list(excluded_track_ids),
                        fetch_limit,
                    )

                if iterative_scan:
                    async with connection.transaction():
                        await connection.execute(
                            "SET LOCAL hnsw.iterative_scan = 'strict_order'"
                        )
                        rows = await connection.fetch(query, *params)
                else:
                    rows = await connection.fetch(query, *params)

                if len(rows) >= requested_limit or fetch_limit >= max_fetch:
                    break
                fetch_limit = min(max_fetch, max(fetch_limit * 2, requested_limit))

        return [
            {
                "track_id": row["track_id"],
                "track_name": row["track_name"],
                "artists": row["artists"],
                "energy": float(row["energy"]) if row["energy"] is not None else 0.0,
                "valence": float(row["valence"]) if row["valence"] is not None else 0.0,
                "danceability": (
                    float(row["danceability"]) if row["danceability"] is not None else 0.0
                ),
                "tempo": float(row["tempo"]) if row["tempo"] is not None else 0.0,
                "z_vector": _parse_pgvector(row["z_vector"]),
            }
            for row in rows[:requested_limit]
        ]

    async def _supports_iterative_scan(self, pool: asyncpg.Pool) -> bool:
        if self._iterative_scan_supported is not None:
            return self._iterative_scan_supported

        version = await pool.fetchval(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        )
        try:
            major, minor = (int(part) for part in str(version).split(".")[:2])
            self._iterative_scan_supported = (major, minor) >= (0, 8)
        except (TypeError, ValueError):
            self._iterative_scan_supported = False
        return self._iterative_scan_supported

    async def find_nearest_track(
        self,
        predicted_vector: list[float],
        session_history: list[str],
        top_k: int = 30,
        return_n: int = 3,
        allowed_ids: Sequence[str] | None = None,
    ) -> list[dict]:
        fetch_limit = max(return_n, top_k + len(session_history))
        candidates = await self.find_nearest_tracks(
            predicted_vector,
            session_history,
            limit=fetch_limit,
            allowed_ids=allowed_ids,
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
        pool = await self._get_pool()
        row = await pool.fetchrow(query, track_id)
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
        pool = await self._get_pool()
        row = await pool.fetchrow(query, target_energy)
        return _parse_pgvector(row["z_vector"]) if row is not None else None

    async def get_track_z_vector(self, track_id: str) -> list[float] | None:
        query = """
            SELECT z_vector::text AS z_vector_str
            FROM   track_features
            WHERE  id = $1
        """
        pool = await self._get_pool()
        row = await pool.fetchrow(query, track_id)

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
        pool = await self._get_pool()
        rows = await pool.fetch(query, track_ids)

        result = {}
        for row in rows:
            raw = row['z_vector_str'].strip('[]')
            result[row['track_id']] = [float(v) for v in raw.split(',') if v]
        return result

    async def ping(self) -> bool:
        try:
            pool = await self._get_pool()
            return await pool.fetchval('SELECT 1') == 1
        except Exception as error:
            logger.warning("[Database] Ping failed (%s).", type(error).__name__)
            return False

    async def track_count(self) -> int:
        pool = await self._get_pool()
        return int(await pool.fetchval('SELECT COUNT(*) FROM track_features'))