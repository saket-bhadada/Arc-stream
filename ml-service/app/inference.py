"""Load trained weights and turn a feature sequence into a next-track vector."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import torch

from app.config import FEATURE_COLS, LATENT_DIM
from app.model_arch import ArcStreamLSTM

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_model_cache: ArcStreamLSTM | None = None


def load_model(weights_path: str | Path) -> ArcStreamLSTM | None:
    """Load trained weights, returning ``None`` when training has not run yet."""
    global _model_cache
    if _model_cache is not None:
        return _model_cache

    path = Path(weights_path)
    if not path.is_file():
        print(f"[Inference] No trained weights at {path}; using energy-matching fallback.")
        return None

    model = ArcStreamLSTM().to(DEVICE)
    state_dict = torch.load(path, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()
    _model_cache = model
    return model


def predict_next_latent_vector(
    model: ArcStreamLSTM | None,
    sequence_history: Sequence[Sequence[float]],
    target_energy: float,
) -> list[float]:
    """Predict the next vector, or use the last vector with target energy set."""
    if not sequence_history:
        raise ValueError("sequence_history must contain at least one vector")
    if any(len(vector) != LATENT_DIM for vector in sequence_history):
        raise ValueError(f"Every vector in sequence_history must be {LATENT_DIM}-dimensional")

    if model is None:
        prediction = list(sequence_history[-1])
        prediction[FEATURE_COLS.index("energy")] = target_energy
        return prediction

    augmented = [[*vector, target_energy] for vector in sequence_history]
    inputs = torch.tensor(augmented, dtype=torch.float32, device=DEVICE).unsqueeze(0)
    with torch.no_grad():
        prediction = model(inputs).sequeeze(0).cpu().tolist()

    return [max(0.0, min(1.0, float(value))) for value in prediction]
