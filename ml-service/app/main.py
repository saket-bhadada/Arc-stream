"""FastAPI endpoints for CSV-backed Arc-Stream recommendations."""

from __future__ import annotations

import os
from math import isfinite
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Sequence

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import LATENT_DIM, MAX_SEQ_LEN, MIN_SEQ_LEN
from app.database_manager import ArcStreamDB
from app.inference import load_model, predict_next_latent_vector

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required.")

arc_db = ArcStreamDB(DATABASE_URL)
WEIGHTS_PATH = Path(__file__).resolve().parent / "weights" / "arc_stream_lstm.pth"


@asynccontextmanager
async def lifespan(application: FastAPI):
    await arc_db.connect()
    application.state.model = load_model(WEIGHTS_PATH)
    try:
        count = await arc_db.track_count()
        print(f"[Startup] track_features: {count:,} rows.")
        if count == 0:
            print("[Startup] Database is empty. Run database/populate_db.py.")
    finally:
        yield
        await arc_db.disconnect()


app = FastAPI(title="Arc-Stream AI Engine", version="1.0.0", lifespan=lifespan)


class BufferRequest(BaseModel):
    target_energy: float = Field(ge=0.0, le=1.0)
    session_history: list[str] = Field(default_factory=list)
    current_z_sequence: list[list[float]] = Field(
        min_length=MIN_SEQ_LEN,
        max_length=MAX_SEQ_LEN,
    )


class PlaylistRequest(BaseModel):
    energy_curve: list[float] = Field(min_length=1)
    current_z_sequence: list[list[float]] = Field(default_factory=list, max_length=MAX_SEQ_LEN)
    session_history: list[str] = Field(default_factory=list)


class QueuePredictRequest(BaseModel):
    seed_track_ids: list[str] = Field(min_length=1, max_length=9)
    target_energy: float = Field(ge=0.0, le=1.0)
    count: int = Field(default=5, ge=1, le=10)
    session_history: list[str] = Field(default_factory=list)


def validate_vectors(vectors: Sequence[Sequence[float]]) -> None:
    """Enforce the same seven-dimensional shape as the imported CSV vectors."""
    if any(
        len(vector) != LATENT_DIM or any(not isfinite(value) for value in vector)
        for vector in vectors
    ):
        raise HTTPException(
            status_code=422,
            detail=f"Each z-vector must contain exactly {LATENT_DIM} values.",
        )


def validate_energy_values(values: Sequence[float]) -> None:
    if any(not isfinite(value) or value < 0.0 or value > 1.0 for value in values):
        raise HTTPException(status_code=422, detail="Energy values must be between 0 and 1.")


async def recommend_one(
    sequence: Sequence[Sequence[float]],
    target_energy: float,
    excluded_ids: Sequence[str],
) -> tuple[dict[str, object], list[float]]:
    prediction = predict_next_latent_vector(
        model=app.state.model,
        sequence_history=sequence,
        target_energy=target_energy,
    )
    matches = await arc_db.find_nearest_tracks(prediction, excluded_ids, limit=1)
    if not matches:
        raise HTTPException(status_code=404, detail="No unused tracks remain in track_features.")

    track = matches[0]
    selected_vector = track.pop("z_vector", None)
    if not isinstance(selected_vector, list):
        raise HTTPException(status_code=500, detail="Database returned an invalid track vector.")
    track["predicted_vector"] = prediction
    return track, [float(value) for value in selected_vector]


@app.get("/")
async def health_check() -> dict[str, object]:
    try:
        track_count = await arc_db.track_count()
        database_status = "connected"
    except Exception as error:
        track_count = 0
        database_status = f"error: {error}"

    return {
        "status": "ok",
        "database": database_status,
        "track_features_rows": track_count,
        "vector_dimension": LATENT_DIM,
        "model_loaded": app.state.model is not None,
    }


@app.get("/track_vector/{track_id}")
async def track_vector(track_id: str) -> dict[str, object]:
    vector = await arc_db.get_track_z_vector(track_id)
    if vector is None:
        raise HTTPException(status_code=404, detail="Track is not present in the imported dataset.")
    return {"track_id": track_id, "z_vector": vector}


@app.post("/predict_buffer")
async def predict_buffer(payload: BufferRequest) -> dict[str, list[dict[str, object]]]:
    validate_vectors(payload.current_z_sequence)
    track, _ = await recommend_one(
        sequence=payload.current_z_sequence,
        target_energy=payload.target_energy,
        excluded_ids=payload.session_history,
    )
    return {"tracks": [track]}


@app.post("/generate_playlist")
async def generate_playlist(payload: PlaylistRequest) -> dict[str, object]:
    validate_energy_values(payload.energy_curve)
    validate_vectors(payload.current_z_sequence)

    sequence = [list(vector) for vector in payload.current_z_sequence]
    if not sequence:
        seed = await arc_db.get_energy_seed(payload.energy_curve[0])
        if seed is None:
            raise HTTPException(status_code=404, detail="track_features is empty. Import the dataset first.")
        sequence = [seed]

    used_ids = list(payload.session_history)
    tracks: list[dict[str, object]] = []
    for energy in payload.energy_curve:
        track, selected_vector = await recommend_one(sequence[-MAX_SEQ_LEN:], energy, used_ids)
        tracks.append(track)
        used_ids.append(str(track["track_id"]))
        sequence.append(selected_vector)

    return {"tracks": tracks, "curve_len": len(tracks)}


@app.post("/predict_queue")
async def predict_queue(payload: QueuePredictRequest) -> dict[str, object]:
    vectors_map = await arc_db.get_track_z_vectors_batch(payload.seed_track_ids)
    resolved_seeds: list[tuple[str, list[float]]] = [
        (tid, vectors_map[tid])
        for tid in payload.seed_track_ids
        if tid in vectors_map
    ]

    if not resolved_seeds:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "NO_MAPPED_SEEDS",
                "message": "None of the provided seed tracks exist in the dataset.",
            },
        )

    last_resolved_id = resolved_seeds[-1][0]
    analysis = await arc_db.get_track_features(last_resolved_id)
    if not analysis:
        analysis = {
            "track_id": last_resolved_id,
            "track_name": "",
            "artists": "",
            "energy": 0.0,
            "valence": 0.0,
            "danceability": 0.0,
            "tempo": 0.0,
        }

    recent_vectors = [vec for _, vec in resolved_seeds[-MIN_SEQ_LEN:]]
    seeds_used = len(recent_vectors)
    padded = False

    if len(recent_vectors) < MIN_SEQ_LEN:
        oldest_vec = recent_vectors[0]
        padding = [oldest_vec for _ in range(MIN_SEQ_LEN - len(recent_vectors))]
        window = padding + recent_vectors
        padded = True
    else:
        window = list(recent_vectors)

    excluded_ids = set(payload.session_history) | set(payload.seed_track_ids)
    tracks: list[dict[str, object]] = []

    for step in range(payload.count):
        prediction = predict_next_latent_vector(
            model=app.state.model,
            sequence_history=window[-MIN_SEQ_LEN:],
            target_energy=payload.target_energy,
        )
        matches = await arc_db.find_nearest_track(
            predicted_vector=prediction,
            session_history=list(excluded_ids),
            top_k=30,
            return_n=1,
        )
        if not matches:
            raise HTTPException(status_code=404, detail="No unused tracks remain in track_features.")

        picked = matches[0]
        track_id = str(picked["track_id"])
        excluded_ids.add(track_id)

        real_z_vector = picked.get("z_vector")
        if not isinstance(real_z_vector, list):
            real_z_vector = await arc_db.get_track_z_vector(track_id)
            if not real_z_vector:
                raise HTTPException(status_code=500, detail="Database returned an invalid track vector.")

        tracks.append({
            "position": step + 1,
            "track_id": track_id,
            "track_name": picked.get("track_name", ""),
            "artists": picked.get("artists", ""),
            "energy": float(picked.get("energy", 0.0)),
            "predicted_vector": prediction,
        })
        window.append(real_z_vector)

    return {
        "analysis": analysis,
        "tracks": tracks,
        "seeds_used": seeds_used,
        "padded": padded,
    }
