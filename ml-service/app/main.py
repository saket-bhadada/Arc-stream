# ml-service/app/main.py
import os
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv

from app import models, database
from app.database_manager import ArcStreamDB
from app.inference import load_model, predict_next_latent_vector
from app.config import MIN_SEQ_LEN, MAX_SEQ_LEN

load_dotenv()
models.Base.metadata.create_all(bind=database.engine)

arc_db = ArcStreamDB(os.getenv('DATABASE_URL'))
WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), 'weights', 'arc_stream_lstm.pth')


@asynccontextmanager
async def lifespan(app: FastAPI):
    await arc_db.connect()
    app.state.model = load_model(WEIGHTS_PATH)
    try:
        count = await arc_db.track_count()
        print(f'[Startup] track_features: {count:,} rows.')
        if count == 0:
            print('[Startup] WARNING — empty. Run database/populate_db.py.')
    except Exception as e:
        print(f'[Startup] Could not count track_features: {e}')
    yield
    await arc_db.disconnect()


app = FastAPI(title='Arc-Stream AI Engine', version='0.7.0', lifespan=lifespan)


class BufferRequest(BaseModel):
    target_energy:      float             = Field(..., ge=0.0, le=1.0)
    session_history:    list[str]         = []
    current_z_sequence: list[list[float]] = Field(..., min_length=MIN_SEQ_LEN, max_length=MAX_SEQ_LEN)


class PlaylistRequest(BaseModel):
    energy_curve:       list[float]
    current_z_sequence: list[list[float]] = []
    session_history:    list[str]         = []


MOCK_TRACKS = [
    {'track_id': '3n3Ppam7vgaVa1iaRUIOKE', 'track_name': 'Mr. Brightside',     'artists': 'The Killers',   'energy': 0.92},
    {'track_id': '7ouMYWpwJ422jRcDASZB7P', 'track_name': 'Knights of Cydonia', 'artists': 'Muse',          'energy': 0.88},
    {'track_id': '0VjIjW4GlUZAMYd2vXMi3b', 'track_name': 'Blinding Lights',    'artists': 'The Weeknd',    'energy': 0.73},
    {'track_id': '6UelLqGlWMcVH1E5c4H7lY', 'track_name': 'Watermelon Sugar',   'artists': 'Harry Styles',  'energy': 0.82},
    {'track_id': '2takcwOaAZWiXQijPHIx7B', 'track_name': 'drivers license',    'artists': 'Olivia Rodrigo','energy': 0.43},
]


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
        'status': 'ok', 'phase': 7,
        'sqlalchemy_session': sqlalchemy_status,
        'asyncpg_pool': asyncpg_status,
        'track_features_rows': count,
        'model_loaded': app.state.model is not None,
    }


@app.post('/predict_buffer')
async def predict_buffer(payload: BufferRequest, db: Session = Depends(database.get_db)):
    try:
        predicted_vector = predict_next_latent_vector(
            model=app.state.model,
            sequence_history=payload.current_z_sequence,
            target_energy=payload.target_energy,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        query = db.query(models.TrackFeature)
        if payload.session_history:
            query = query.filter(models.TrackFeature.id.notin_(payload.session_history))
        closest = query.order_by(models.TrackFeature.z_vector.l2_distance(predicted_vector)).limit(1).first()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'pgvector query failed: {e}')

    if not closest:
        raise HTTPException(status_code=404, detail='No fresh tracks — run database/populate_db.py or session_history exhausted the catalogue.')

    return {'tracks': [{
        'track_id': closest.id, 'track_name': closest.track_name,
        'artists': closest.artists, 'predicted_vector': predicted_vector,
    }]}


@app.post('/generate_playlist')
def generate_playlist(payload: PlaylistRequest, db: Session = Depends(database.get_db)):
    curve_len = len(payload.energy_curve)
    if curve_len == 0:
        raise HTTPException(status_code=400, detail='energy_curve must not be empty')
    tracks = [random.choice(MOCK_TRACKS) for _ in range(curve_len)]
    return {'tracks': tracks, 'curve_len': curve_len}