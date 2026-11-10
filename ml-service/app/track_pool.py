from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

LLM_TOP_N = max(1, int(os.getenv("LLM_TOP_N", "10000")))


@dataclass(frozen=True)
class PoolTrack:
    track_id: str
    track_name: str
    artists: str
    popularity: float
    energy: float
    valence: float
    danceability: float
    tempo: float


@dataclass(frozen=True)
class TrackPool:
    tracks: tuple[PoolTrack, ...]
    ids: frozenset[str]
    popularity_cutoff: float


_track_pool: TrackPool | None = None


def _numeric(value: Any, default: float) -> float:
    number = pd.to_numeric(value, errors="coerce")
    return float(number) if pd.notna(number) else default


def _csv_path(path: str | Path | None) -> Path:
    configured = path or os.getenv("LLM_POOL_CSV_PATH")
    if configured:
        csv_path = Path(configured)
        if not csv_path.is_absolute():
            csv_path = Path(__file__).resolve().parents[1] / csv_path
        return csv_path
    return Path(__file__).resolve().parents[1] / "training" / "dataset.csv"


def load_track_pool(path: str | Path | None = None) -> TrackPool:
    global _track_pool
    _track_pool = None
    csv_path = _csv_path(path)
    if not csv_path.is_file():
        raise FileNotFoundError(f"Prompt DJ pool CSV was not found: {csv_path}")

    frame = pd.read_csv(csv_path)
    aliases = {"id": "track_id", "name": "track_name"}
    frame = frame.rename(columns={key: value for key, value in aliases.items() if key in frame})
    required = {
        "track_id",
        "track_name",
        "artists",
        "popularity",
        "energy",
        "valence",
        "danceability",
        "tempo",
    }
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(
            "Prompt DJ pool CSV is missing required columns: "
            + ", ".join(sorted(missing))
        )

    frame = frame.dropna(subset=["track_id", "track_name", "artists", "popularity"]).copy()
    for column in ("track_id", "track_name", "artists"):
        frame[column] = frame[column].astype(str).str.strip()
    frame = frame[
        (frame["track_id"] != "")
        & (frame["track_name"] != "")
        & (frame["artists"] != "")
    ]
    frame["popularity"] = pd.to_numeric(frame["popularity"], errors="coerce")
    frame = frame.dropna(subset=["popularity"])
    frame = frame.sort_values(
        ["popularity", "track_id"],
        ascending=[False, True],
        kind="mergesort",
    )
    frame = frame.drop_duplicates(subset=["track_id"], keep="first")
    frame["_name_key"] = frame["track_name"].str.casefold()
    frame["_artists_key"] = frame["artists"].str.casefold()
    frame = frame.drop_duplicates(subset=["_name_key", "_artists_key"], keep="first")
    frame = frame.head(LLM_TOP_N)

    tracks = tuple(
        PoolTrack(
            track_id=str(row.track_id),
            track_name=str(row.track_name),
            artists=str(row.artists),
            popularity=_numeric(row.popularity, 0.0),
            energy=_numeric(row.energy, 0.5),
            valence=_numeric(row.valence, 0.5),
            danceability=_numeric(row.danceability, 0.5),
            tempo=_numeric(row.tempo, 120.0),
        )
        for row in frame.itertuples(index=False)
    )
    if not tracks:
        raise ValueError("Prompt DJ pool CSV contains no usable tracks.")

    _track_pool = TrackPool(
        tracks=tracks,
        ids=frozenset(track.track_id for track in tracks),
        popularity_cutoff=tracks[-1].popularity,
    )
    logger.info(
        "[Track Pool] Loaded %s tracks; popularity cutoff=%s.",
        len(tracks),
        _track_pool.popularity_cutoff,
    )
    return _track_pool


def get_track_pool() -> TrackPool | None:
    return _track_pool
