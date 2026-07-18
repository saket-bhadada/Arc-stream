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