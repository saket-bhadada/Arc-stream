from __future__ import annotations

import logging
import os
import numpy as np
import time
from threading import Lock
from typing import TYPE_CHECKING, List, Optional, Sequence

from .config import CONDITIONED_INPUT_DIM, LATENT_DIM, WEIGHTS_PATH

if TYPE_CHECKING:
    from .model_arch import ArcStreamLSTM

logger = logging.getLogger(__name__)
_MODEL_INSTANCE: Optional[ArcStreamLSTM] = None
_MODEL_LOCK = Lock()


def load_inference_model() -> ArcStreamLSTM:
    global _MODEL_INSTANCE
    if _MODEL_INSTANCE is not None:
        return _MODEL_INSTANCE

    with _MODEL_LOCK:
        if _MODEL_INSTANCE is not None:
            return _MODEL_INSTANCE

        started_at = time.perf_counter()
        import torch
        from .model_arch import ArcStreamLSTM

        torch.set_num_threads(1)
        model = ArcStreamLSTM(input_dim=CONDITIONED_INPUT_DIM, output_dim=LATENT_DIM)
        if os.path.exists(WEIGHTS_PATH):
            try:
                state = torch.load(
                    WEIGHTS_PATH,
                    map_location=torch.device("cpu"),
                    weights_only=True,
                )
                model.load_state_dict(state)
                logger.info("[Model] Loaded trained CPU weights.")
            except Exception as error:
                logger.warning(
                    "[Model] Failed to load weights (%s); using baseline initialization.",
                    type(error).__name__,
                )
        else:
            logger.warning("[Model] Weights file not found; using baseline initialization.")

        model.eval()
        _MODEL_INSTANCE = model
        logger.info("[Model] CPU model ready in %.2fs.", time.perf_counter() - started_at)
    return _MODEL_INSTANCE


def is_model_loaded() -> bool:
    return _MODEL_INSTANCE is not None


def predict_next_z_vector(
    history_vectors: Sequence[Sequence[float]],
    target_energy: float
) -> List[float]:
    model = load_inference_model()
    import torch

    if not history_vectors:
        history_vectors = [[0.5] * LATENT_DIM]

    # Take the last 5 steps to match the LSTM training window (seq_len=5)
    recent_window = history_vectors[-5:]
    conditioned_seq = []
    for vec in recent_window:
        clean_v = (list(vec) + [0.5] * LATENT_DIM)[:LATENT_DIM]
        conditioned_seq.append(clean_v + [float(target_energy)])

    input_tensor = torch.tensor([conditioned_seq], dtype=torch.float32)
    with torch.no_grad():
        pred = model(input_tensor)
        predicted_vec = pred[0].cpu().numpy().tolist()

    return [float(x) for x in predicted_vec]

def load_model(weights_path=None) -> ArcStreamLSTM:
    """Compatibility wrapper; configured weights load on the first inference."""
    return load_inference_model()

def predict_next_latent_vector(
    model,
    sequence_history: Sequence[Sequence[float]],
    target_energy: float
) -> List[float]:
    """Compatibility wrapper used by main.py endpoints."""
    return predict_next_z_vector(list(sequence_history), target_energy)


def predict_anchored_z_vector(
    rolling_sequence: List[List[float]],
    seed_vectors: List[List[float]],
    step_target_energy: float,
    anchor_weight: float = 0.45
) -> List[float]:
    """
    Combines the LSTM's sequential prediction with the acoustic centroid of the
    user's 5 seed songs, while strictly enforcing `step_target_energy` at index 1.
    Feature order: [danceability(0), energy(1), key(2), loudness(3), mode(4), tempo(5), valence(6)]
    """
    raw_lstm_pred = np.array(predict_next_z_vector(rolling_sequence, step_target_energy))

    if seed_vectors:
        seed_centroid = np.mean(np.array(seed_vectors), axis=0)
        # Blend LSTM transition dynamics with the 5-song acoustic centroid
        blended = (1.0 - anchor_weight) * raw_lstm_pred + (anchor_weight * seed_centroid)
    else:
        blended = raw_lstm_pred

    # Strictly pin Energy (index 1) to the user's graph value at step t
    blended[1] = float(np.clip(step_target_energy, 0.0, 1.0))

    # Couple loudness (index 3) slightly with energy so high-energy tracks aren't quiet
    blended[3] = float(np.clip(0.7 * blended[3] + 0.3 * step_target_energy, 0.0, 1.0))

    return [float(np.clip(x, 0.0, 1.0)) for x in blended]