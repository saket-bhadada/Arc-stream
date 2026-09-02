"""Populate ``track_features`` from the ML service training dataset."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Final

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from psycopg2.extensions import connection as PgConnection
from psycopg2.extras import execute_batch

PROJECT_ROOT: Final = Path(__file__).resolve().parent.parent
ML_SERVICE_DIR: Final = PROJECT_ROOT / "ml-service"
CSV_PATH: Final = ML_SERVICE_DIR / "training" / "archive" / "tracks_features.csv"
BATCH_SIZE: Final = 500

# The ML service directory is not an installable Python package (its name contains
# a hyphen), so add it before importing the shared normalization implementation.
if str(ML_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_DIR))

from app.config import FEATURE_COLS  # noqa: E402
from app.feature_utils import normalize_row  # noqa: E402

load_dotenv(PROJECT_ROOT / "server" / ".env")

# tracks_features.csv uses Spotify's ``id`` and ``name`` column names.
ID_COL: Final = "id"
NAME_COL: Final = "name"
ARTIST_COL: Final = "artists"
REQUIRED_COLUMNS: Final = [ID_COL, NAME_COL, ARTIST_COL, *FEATURE_COLS]

INSERT_SQL: Final = """
    INSERT INTO track_features
        (id, track_name, artists, danceability, energy, key, loudness, mode, tempo, valence, z_vector)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (id) DO NOTHING;
"""


def get_connection() -> PgConnection:
    """Return a configured database connection, or stop with a clear error."""
    database_name = os.getenv("DB_DATABASE") or os.getenv("DB_NAME")
    required_env = ("DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD")
    missing = [key for key in required_env if not os.getenv(key)]
    if not database_name:
        missing.append("DB_DATABASE or DB_NAME")
    if missing:
        raise SystemExit(f"[Populate] ERROR - missing env vars: {', '.join(missing)}")

    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ["DB_PORT"]),
        dbname=database_name,
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def build_rows(dataframe: pd.DataFrame) -> list[tuple[object, ...]]:
    """Convert dataset rows to parameter tuples accepted by ``execute_batch``."""
    return [
        (
            str(row[ID_COL]),
            str(row[NAME_COL]),
            str(row[ARTIST_COL]),
            float(row["danceability"]),
            float(row["energy"]),
            int(row["key"]),
            float(row["loudness"]),
            int(row["mode"]),
            float(row["tempo"]),
            float(row["valence"]),
            str(row["z_vector_str"]),
        )
        for _, row in dataframe.iterrows()
    ]


def main() -> None:
    """Load the dataset, normalize audio features, and insert it in batches."""
    if not CSV_PATH.is_file():
        raise SystemExit(f"[Populate] ERROR - CSV not found: {CSV_PATH}")

    print(f"[Populate] Reading {CSV_PATH} ...")
    dataframe = pd.read_csv(CSV_PATH)

    missing_columns = [column for column in REQUIRED_COLUMNS if column not in dataframe.columns]
    if missing_columns:
        raise SystemExit(f"[Populate] ERROR - CSV missing columns: {missing_columns}")

    before_count = len(dataframe)
    dataframe = dataframe.dropna(subset=REQUIRED_COLUMNS).drop_duplicates(subset=ID_COL)
    print(f"[Populate] {before_count:,} rows -> {len(dataframe):,} after dedup/null drop.")

    print("[Populate] Normalizing real audio features into z_vector ...")
    dataframe["z_vector_str"] = dataframe.apply(
        lambda row: "[" + ",".join(str(value) for value in normalize_row(row)) + "]",
        axis=1,
    )
    rows = build_rows(dataframe)

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            if cursor.fetchone() is None:
                raise SystemExit("[Populate] ERROR - pgvector extension not installed.")

            total_rows = len(rows)
            inserted_rows = 0
            start_time = time.monotonic()
            for start_index in range(0, total_rows, BATCH_SIZE):
                batch = rows[start_index : start_index + BATCH_SIZE]
                execute_batch(cursor, INSERT_SQL, batch, page_size=BATCH_SIZE)
                connection.commit()
                inserted_rows += len(batch)
                elapsed = time.monotonic() - start_time
                print(f"[Populate]   {inserted_rows:,}/{total_rows:,} - {elapsed:.1f}s")
    print(f"[Populate] Done - {len(rows):,} rows. z_vector is now real, not random.")


if __name__ == "__main__":
    main()
