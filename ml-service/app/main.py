# ml_service/app/main.py
# Phase 6: /predict_buffer now runs a real pgvector Euclidean search
# via SQLAlchemy instead of returning mock catalogue tracks.
# The LSTM is still stubbed — a flat [0.5]*33 vector stands in for
# ArcNavigatorLSTM's output until Phase 7 wires in the trained model.

import os
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv

import models, database
from database_manager import ArcStreamDB

load_dotenv()

models.Base.metadata.create_all(bind=database.engine)

arc_db = ArcStreamDB(os.getenv('DATABASE_URL'))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await arc_db.connect()
    try:
        count = await arc_db.track_count()
        print(f'[Startup] track_features: {count:,} rows ready for pgvector search.')
        if count == 0:
            print('[Startup] WARNING — track_features is empty. Run database/populate_db.py.')
    except Exception as e:
        print(f'[Startup] Could not count track_features: {e}')

    yield

    await arc_db.disconnect()


app = FastAPI(
    title       = 'Arc-Stream AI Engine',
    description = 'Phase 6 — live pgvector search via SQLAlchemy.',
    version     = '0.6.0',
    lifespan    = lifespan,
)

MIN_SEQ_LEN = 5
MAX_SEQ_LEN = 9


# ── Pydantic request models ───────────────────────────────────────────────────
class BufferRequest(BaseModel):
    target_energy:      float
    session_history:    list[str]         = []
    # Phase 6: made optional — Node's simplified /api/engine/next-track route
    # doesn't send this. Real LSTM sequencing returns in Phase 7.
    current_z_sequence: list[list[float]] = []


class PlaylistRequest(BaseModel):
    energy_curve:       list[float]
    current_z_sequence: list[list[float]] = []
    session_history:    list[str]         = []


# ── Mock track catalogue (still used by /generate_playlist only) ──────────────
MOCK_TRACKS = [
    {'track_id': '3n3Ppam7vgaVa1iaRUIOKE', 'track_name': 'Mr. Brightside',     'artists': 'The Killers',   'energy': 0.92},
    {'track_id': '7ouMYWpwJ422jRcDASZB7P', 'track_name': 'Knights of Cydonia', 'artists': 'Muse',          'energy': 0.88},
    {'track_id': '0VjIjW4GlUZAMYd2vXMi3b', 'track_name': 'Blinding Lights',    'artists': 'The Weeknd',    'energy': 0.73},
    {'track_id': '6UelLqGlWMcVH1E5c4H7lY', 'track_name': 'Watermelon Sugar',   'artists': 'Harry Styles',  'energy': 0.82},
    {'track_id': '2takcwOaAZWiXQijPHIx7B', 'track_name': 'drivers license',    'artists': 'Olivia Rodrigo','energy': 0.43},
]


def get_mock_latent_vector() -> list[float]:
    return [0.5] * 33

@app.get('/')
async def health_check(db: Session = Depends(database.get_db)):
    try:
        db.execute(text('SELECT 1'))
        sqlalchemy_status = 'connected'
    except Exception as e:
        sqlalchemy_status = f'error: {e}'

    asyncpg_status = 'connected' if await arc_db.ping() else 'error'

    try:
        count = await arc_db.track_count()
    except Exception:
        count = 0

    return {
        'status':              'ok',
        'service':             'Arc-Stream AI Engine',
        'phase':                6,
        'sqlalchemy_session':   sqlalchemy_status,
        'asyncpg_pool':         asyncpg_status,
        'track_features_rows':  count,
    }


@app.post('/predict_buffer')
async def predict_buffer(
    payload: BufferRequest,
    db: Session = Depends(database.get_db),
):
    mock_vector = get_mock_latent_vector()

    try:
        closest = (
            db.query(models.TrackFeature)
            .order_by(models.TrackFeature.z_vector.l2_distance(mock_vector))
            .limit(1)
            .first()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'pgvector query failed: {e}')

    if not closest:
        raise HTTPException(
            status_code=404,
            detail='No tracks found in track_features — run database/populate_db.py first.',
        )

    track = {
        'track_id':         closest.id,
        'track_name':       closest.track_name,
        'artists':          closest.artists,
        'predicted_vector': mock_vector,
    }

    return {'tracks': [track]}


@app.post('/generate_playlist')
def generate_playlist(payload: PlaylistRequest, db: Session = Depends(database.get_db)):
    seq_len   = len(payload.current_z_sequence)
    curve_len = len(payload.energy_curve)

    if curve_len == 0:
        raise HTTPException(status_code=400, detail='energy_curve must not be empty')

    tracks = [random.choice(MOCK_TRACKS) for _ in range(curve_len)]

    return {'tracks': tracks, 'seq_len': seq_len, 'curve_len': curve_len}