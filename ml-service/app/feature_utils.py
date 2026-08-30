# ml-service/app/feature_utils.py
from app.config import FEATURE_COLS


def normalize_row(row) -> list:
    """
    Converts one track's raw audio-feature values into a [0,1] vector,
    in the exact order of FEATURE_COLS. Works with a dict or pandas Series.
    """
    out = []
    for col in FEATURE_COLS:
        v = float(row[col])

        if col == 'key':
            v = max(v, 0.0) / 11.0                                  # -1..11 -> 0..1
        elif col == 'loudness':
            v = (max(min(v, 0.0), -60.0) + 60.0) / 60.0              # -60..0dB -> 0..1
        elif col == 'tempo':
            v = min(v, 250.0) / 250.0                                 # BPM -> 0..1
        # danceability, energy, valence, mode already 0.0-1.0

        out.append(round(v, 8))
    return out