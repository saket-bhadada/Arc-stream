"""FastAPI endpoints for CSV-backed Arc-Stream recommendations."""

from __future__ import annotations

import os
from math import isfinite
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Sequence

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from app.config import LATENT_DIM, MAX_SEQ_LEN, MIN_SEQ_LEN
from app.database_manager import ArcStreamDB
from app.inference import load_model, predict_next_latent_vector

from fastapi import FastAPI, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel, Field
from typing import List, Optional
from contextlib import asynccontextmanager
import numpy as np

from . import models, database
from .inference import load_inference_model, predict_next_z_vector, predict_anchored_z_vector
from .trajectory import generate_energy_curve

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
    seed_track_ids: list[str] = Field(min_length=1, max_length=9)
    custom_energy_curve: list[float] | None = None
    start_energy: float = Field(default=0.3, ge=0.0, le=1.0)
    target_energy: float = Field(default=0.8, ge=0.0, le=1.0)
    track_count: int = Field(default=12, ge=1, le=30)
    curve_type: Literal["linear", "arc", "wave"] = "arc"
    anchor_strength: float = Field(default=0.45, ge=0.0, le=1.0)


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
async def generate_playlist(payload: PlaylistRequest,db: Session = Depends(database.get_db)):
    try:
        seed_rows = db.query(models.TrackFeature).filter(
            models.TrackFeature.id.in_(payload.seed_track_ids)
        ).all()

        if not seed_rows:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "NO_MAPPED_SEEDS",
                    "message": "None of the provided seed tracks exist in the dataset.",
                },
            )
        seed_map = {row.id: row.z_vector for row in seed_rows}
        ordered_seeds = [seed_map[tid] for tid in payload.seed_track_ids if tid in seed_map]
        seed_vectors = [[float(x) for x in vector] for vector in ordered_seeds]

        while len(seed_vectors)<5:
            seed_vectors.insert(0,seed_vectors[0])

        energy_targets = generate_energy_curve(
            start_energy=payload.start_energy,
            target_energy=payload.target_energy,
            count=payload.track_count,
            curve_type=payload.curve_type,
            custom_points=payload.custom_energy_curve
        )

        rolling_seq = list(seed_vectors[-5:])
        excluded_ids = set(payload.seed_track_ids)
        generated_tracks = []
        for step_idx, target_e in enumerate(energy_targets):
            # Predict 7D vector conditioned on the 5-track window, anchored to seeds + target_e
            ideal_z = predict_anchored_z_vector(
                rolling_sequence=rolling_seq,
                seed_vectors=seed_vectors,
                step_target_energy=target_e,
                anchor_weight=payload.anchor_strength
            )

            # Query tracks within a tight energy band first (±0.08) sorted by 7D Euclidean distance
            energy_band = 0.08
            base_query = db.query(models.TrackFeature).filter(
                ~models.TrackFeature.id.in_(excluded_ids)
            )

            band_match = base_query.filter(
                models.TrackFeature.energy.between(max(0.0, target_e - energy_band), min(1.0, target_e + energy_band))
            ).order_by(
                models.TrackFeature.z_vector.l2_distance(ideal_z)
            ).first()

            # Fallback to pure 7D vector nearest-neighbor if the strict energy band is empty
            match = band_match or base_query.order_by(
                models.TrackFeature.z_vector.l2_distance(ideal_z)
            ).first()

            if match:
                excluded_ids.add(match.id)
                match_z = [float(x) for x in match.z_vector]
                rolling_seq = (rolling_seq + [match_z])[-5:]

                # Compute similarity score to the 5 seed songs
                dist_to_ideal = float(np.linalg.norm(np.array(match_z) - np.array(ideal_z)))
                generated_tracks.append({
                    "step": step_idx + 1,
                    "track_id": match.id,
                    "track_name": match.track_name,
                    "artist_name": match.artists,
                    "target_energy": round(target_e, 3),
                    "actual_energy": round(float(match.energy), 3),
                    "vector_distance": round(dist_to_ideal, 4),
                    "z_vector": match_z
                })

        return {
            "seed_count": len(ordered_seeds),
            "energy_curve": energy_targets,
            "playlist": generated_tracks,
            "total_tracks": len(generated_tracks)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

@app.get("/search_tracks")
def search_tracks(q: str = Query(..., min_length=1), limit: int = 10, db: Session = Depends(database.get_db)):
    """search database for tracks matching the query string"""
    safe_limit = max(1, min(limit, 50))
    results = db.query(models.TrackFeature).filter(
        or_(
            models.TrackFeature.track_name.ilike(f"%{q}%"),
            models.TrackFeature.artists.ilike(f"%{q}%")
        )
    ).limit(safe_limit).all()

    return {
        "tracks":[
            {
                "track_id": t.id,
                "track_name": t.track_name,
                "artist_name": t.artists,
                "energy": round(t.energy, 3),
                "valence": round(t.valence, 3),
                "tempo": round(t.tempo, 1)
            }
            for t in results
        ]
    }
