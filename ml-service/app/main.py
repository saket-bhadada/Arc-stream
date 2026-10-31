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
from sqlalchemy import or_, func
from pydantic import BaseModel, Field
from typing import List, Optional
from contextlib import asynccontextmanager
import numpy as np

from . import models, database
from .inference import load_inference_model, predict_next_z_vector, predict_anchored_z_vector
from .trajectory import generate_energy_curve
from app.prompt.ollama_planner import plan_playlist_from_prompt

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
    seed_track_ids: Optional[List[str]] = []
    custom_energy_curve: Optional[List[float]] = None
    energy_curve: Optional[List[float]] = None
    current_z_sequence: Optional[List[List[float]]] = []
    session_history: Optional[List[str]] = []
    start_energy: float = Field(default=0.3, ge=0.0, le=1.0)
    target_energy: float = Field(default=0.8, ge=0.0, le=1.0)
    track_count: int = 10
    curve_type: str = "arc"
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


def get_camelot(key: Optional[int], mode: Optional[int]) -> tuple[int, str]:
    """Maps Spotify key (0-11) and mode (1=Major, 0=Minor) to Camelot key (e.g. 8B, 5A)."""
    if key is None or key < 0 or key > 11:
        return (8, "B" if mode == 1 else "A")
    major_map = {0: 8, 1: 3, 2: 10, 3: 5, 4: 12, 5: 7, 6: 2, 7: 9, 8: 4, 9: 11, 10: 6, 11: 1}
    minor_map = {0: 5, 1: 12, 2: 7, 3: 2, 4: 9, 5: 4, 6: 11, 7: 6, 8: 1, 9: 8, 10: 3, 11: 10}
    if mode == 1:
        return (major_map.get(key, 8), "B")
    return (minor_map.get(key, 5), "A")


def generate_playlist_core(payload: PlaylistRequest, db: Session) -> dict:
    raw_curve = (
        payload.custom_energy_curve
        if payload.custom_energy_curve and len(payload.custom_energy_curve) > 0
        else payload.energy_curve
    )
    effective_count = max(1, min(30, int(payload.track_count or (len(raw_curve) if raw_curve else 10))))

    if raw_curve and len(raw_curve) == effective_count:
        energy_targets = [float(np.clip(val, 0.0, 1.0)) for val in raw_curve]
    else:
        energy_targets = generate_energy_curve(
            start_energy=payload.start_energy,
            target_energy=payload.target_energy,
            count=effective_count,
            curve_type=payload.curve_type,
            custom_points=raw_curve,
        )

    seed_ids = [tid for tid in (payload.seed_track_ids or []) if tid]
    seed_vectors: List[List[float]] = []

    if seed_ids:
        seed_rows = (
            db.query(models.TrackFeature)
            .filter(models.TrackFeature.id.in_(seed_ids))
            .all()
        )
        seed_map = {row.id: row.z_vector for row in seed_rows if row.z_vector is not None}
        ordered_seeds = [seed_map[tid] for tid in seed_ids if tid in seed_map]
        seed_vectors = [[float(x) for x in vector] for vector in ordered_seeds]

    if not seed_vectors and payload.current_z_sequence:
        valid_seq = [
            [float(x) for x in vec[:LATENT_DIM]]
            for vec in payload.current_z_sequence
            if isinstance(vec, (list, tuple)) and len(vec) >= LATENT_DIM
        ]
        if valid_seq:
            seed_vectors = valid_seq[-5:]

    if not seed_vectors:
        start_e = float(energy_targets[0]) if energy_targets else 0.5
        fallback_rows = (
            db.query(models.TrackFeature)
            .order_by(func.abs(models.TrackFeature.energy - start_e))
            .limit(5)
            .all()
        )
        for row in fallback_rows:
            if row.z_vector is not None:
                seed_vectors.append([float(x) for x in row.z_vector])

    if not seed_vectors:
        seed_vectors = [[0.5] * LATENT_DIM for _ in range(5)]

    seed_count = len(seed_vectors)
    while len(seed_vectors) < 5:
        seed_vectors.insert(0, list(seed_vectors[0]))
    seed_vectors = seed_vectors[-5:]

    seed_centroid = np.mean(np.array(seed_vectors, dtype=np.float32), axis=0)
    rolling_seq = [list(vec) for vec in seed_vectors[-5:]]
    excluded_ids = set(seed_ids) | set(payload.session_history or [])
    generated_tracks = []

    for step_idx, target_e in enumerate(energy_targets):
        target_e_val = float(np.clip(target_e, 0.0, 1.0))

        # 1. Run LSTM on the 5-track rolling sequence
        lstm_pred = np.array(
            predict_next_z_vector(rolling_seq, target_e_val),
            dtype=np.float32,
        )

        # 2. Blend LSTM output with 5-Song Acoustic Centroid (0.55 * lstm_pred + 0.45 * seed_centroid)
        blended = 0.55 * lstm_pred + 0.45 * seed_centroid

        # 3. Strictly pin index 1 (energy) to target_e from the user's graph
        blended[1] = target_e_val
        ideal_z = [float(np.clip(x, 0.0, 1.0)) for x in blended]

        # 4. Query TrackFeature in PostgreSQL excluding already-used track IDs within ±0.08 energy band
        energy_band = 0.08
        base_query = db.query(models.TrackFeature)
        if excluded_ids:
            base_query = base_query.filter(~models.TrackFeature.id.in_(excluded_ids))

        band_match = (
            base_query.filter(
                models.TrackFeature.energy.between(
                    max(0.0, target_e_val - energy_band),
                    min(1.0, target_e_val + energy_band),
                )
            )
            .order_by(models.TrackFeature.z_vector.l2_distance(ideal_z))
            .first()
        )

        match = band_match or (
            base_query.order_by(models.TrackFeature.z_vector.l2_distance(ideal_z)).first()
        )

        if match:
            excluded_ids.add(match.id)
            match_z = [float(x) for x in match.z_vector]
            rolling_seq = (rolling_seq + [match_z])[-5:]

            dist_to_ideal = float(np.linalg.norm(np.array(match_z) - np.array(ideal_z)))
            generated_tracks.append({
                "step": step_idx + 1,
                "track_id": match.id,
                "track_name": match.track_name or f"Track {match.id[:8]}",
                "artist_name": match.artists or "Spotify Artist",
                "target_energy": round(target_e_val, 3),
                "actual_energy": round(float(match.energy), 3),
                "vector_distance": round(dist_to_ideal, 4),
                "z_vector": match_z,
            })

    return {
        "seed_count": seed_count,
        "energy_curve": energy_targets,
        "tracks": generated_tracks,
        "playlist": generated_tracks,
        "total_tracks": len(generated_tracks),
    }


@app.post("/generate_playlist")
async def generate_playlist(payload: PlaylistRequest, db: Session = Depends(database.get_db)):
    try:
        return generate_playlist_core(payload, db)
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
def search_tracks(q: str = Query(default="random"), limit: int = 10, db: Session = Depends(database.get_db)):
    """Search database for tracks matching the query string, or sample random tracks when q='random'."""
    safe_limit = max(1, min(limit, 50))
    clean_q = (q or "").strip()

    if not clean_q or clean_q.lower() == "random":
        results = db.query(models.TrackFeature).order_by(func.random()).limit(safe_limit).all()
    else:
        results = (
            db.query(models.TrackFeature)
            .filter(
                or_(
                    models.TrackFeature.track_name.ilike(f"%{clean_q}%"),
                    models.TrackFeature.artists.ilike(f"%{clean_q}%"),
                    models.TrackFeature.id.ilike(f"%{clean_q}%"),
                )
            )
            .limit(safe_limit)
            .all()
        )

    return {
        "tracks": [
            {
                "track_id": t.id,
                "track_name": t.track_name or f"Track {t.id[:8]}",
                "artist_name": t.artists or "Unknown Artist",
                "energy": round(float(t.energy or 0.0), 3),
                "valence": round(float(t.valence or 0.0), 3),
                "tempo": round(float(t.tempo or 0.0), 1),
            }
            for t in results
        ]
    }


class PromptPlaylistRequest(BaseModel):
    prompt: str = Field(..., min_length=2)
    track_count: int = Field(default=10, ge=5, le=25)
    seed_track_ids: Optional[List[str]] = Field(default=[])


@app.post("/generate_from_prompt")
async def generate_from_prompt(payload: PromptPlaylistRequest, db: Session = Depends(database.get_db)):
    try:
        # 1. If user selected seed songs in UI, load their actual 7D acoustic telemetry from PostgreSQL
        input_songs_metadata = []
        selected_rows = []
        clean_seeds = [tid for tid in (payload.seed_track_ids or []) if tid]
        if clean_seeds:
            selected_rows = (
                db.query(models.TrackFeature)
                .filter(models.TrackFeature.id.in_(clean_seeds))
                .all()
            )
            for r in selected_rows:
                c_num, c_let = get_camelot(r.key, r.mode)
                input_songs_metadata.append({
                    "track_id": r.id,
                    "track_name": r.track_name or r.id[:8],
                    "artist_name": r.artists or "Unknown Artist",
                    "energy": round(float(r.energy), 3) if r.energy is not None else 0.5,
                    "valence": round(float(r.valence), 3) if r.valence is not None else 0.5,
                    "tempo": round(float(r.tempo), 1) if r.tempo is not None else 120.0,
                    "camelot": f"{c_num}{c_let}",
                })

        # 2. Ask Ollama (with full seed telemetry) to plan the trajectory
        plan = await plan_playlist_from_prompt(
            prompt=payload.prompt,
            track_count=payload.track_count,
            input_songs=input_songs_metadata,
        )

        # 3. Prioritize user's explicitly selected track_ids first, then fill remaining slots with Ollama's suggestions
        matched_seeds = [r.id for r in selected_rows]
        for q in plan.seed_queries:
            if len(matched_seeds) >= 5:
                break
            match = (
                db.query(models.TrackFeature)
                .filter(
                    or_(
                        models.TrackFeature.track_name.ilike(f"%{q}%"),
                        models.TrackFeature.artists.ilike(f"%{q}%"),
                        models.TrackFeature.id.ilike(f"%{q}%"),
                    )
                )
                .first()
            )
            if match and match.id not in matched_seeds:
                matched_seeds.append(match.id)

        # 4. Run the PyTorch LSTM + 7D pgvector search
        req = PlaylistRequest(
            seed_track_ids=matched_seeds[:5],
            custom_energy_curve=plan.energy_curve,
            energy_curve=plan.energy_curve,
            track_count=len(plan.energy_curve),
            curve_type="custom",
        )
        result = generate_playlist_core(req, db)

        tracks = result.get("tracks", [])
        return {
            "success": True,
            "title": plan.playlist_title,
            "playlist_title": plan.playlist_title,
            "vibe_summary": plan.vibe_summary,
            "target_valence": plan.target_valence,
            "recommended_bpm_range": plan.recommended_bpm_range,
            "suggested_seeds": plan.seed_queries,
            "energy_curve": plan.energy_curve,
            "tracks": tracks,
            "playlist": tracks,
            "total_tracks": len(tracks),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
