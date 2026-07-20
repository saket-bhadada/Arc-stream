from fastapi import HTTPException
import os
import asyncpg
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

class ArcStreamDB:
    def __init__(self,dsn:str):
        if not dsn:
            raise RuntimeError(
                '[Arc-StreamDB] Database_url is not set in ml_service/app'
            )
        self.dsn = dsn
        self.pool:Optional[asyncpg.pool] = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(
            self.dsn,
            min_size = 2,
            max_size = 10,
        )
        print('[Arc-StreamDB] asyncpg pool connected')

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
            print('[Arc-StreamDB] asyncpg pool closed')

    async def find_nearest_track(self,predicted_vector:list[float],session_history:list[str],top_k:int=30,return_n:int = 3)->list[dict]:
        if not self.pool:
            raise RuntimeError(
                '[ArcStreamDB] Pool not initialised. Call connect() first.'
            )

        vector_str = '['+','.join(
            str(round(float(v),8) for v in predicted_vector)
        )+']'
        fetch_limit = top_k + len(session_history) + 10
        query = """
            SELECT
                id           AS track_id,
                track_name,
                artists,
                energy,
                z_vector::text AS z_vector_str
            FROM  track_features
            ORDER BY z_vector <-> $1::vector
            LIMIT $2
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query,vector_str,fetch_limit)

        history_set = set(session_history)
        fresh = [
            dict(row) 
            for row in rows
            if row['track_id'] not in history_set
        ]
        return fresh[:return_n]


    async def get_track_z_vector(self,track_id:str)->list[float]:
        if not self.pool:
            raise RuntimeError(
                 '[ArcStreamDB] Pool not initialised. Call connect() first.'
            )
        
        query = """
            SELECT z_vector::text AS z_vector_str
            FROM   track_features
            WHERE  id = $1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query,track_id)

        if not row:
            raise ValueError(
                f"No track found for id: {track_id}"
            )

        raw = row['z_vector_str'].strip('[]')
        return [float(v) for v in raw.split(',')]

    async def ping(self)->bool:
        try:
            async with self.pool.acquire() as conn:
                await conn.fetchval('SELECT 1')
            return True
        except Exception:
            return False

    async def track_count(self)->int:
        async with self.pool.acquire() as conn:
            return await conn.fetchval('Select COUNT(*) FROM track_features')