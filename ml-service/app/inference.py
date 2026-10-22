import os
import torch
import numpy as np
from typing import List, Optional
from .model_arch import ArcStreamLSTM
from .config import WEIGHTS_PATH, LATENT_DIM, CONDITIONED_INPUT_DIM

_MODEL_INSTANCE: Optional[ArcStreamLSTM] = None

def load_inference_model() -> ArcStreamLSTM:
    global _MODEL_INSTANCE
    if _MODEL_INSTANCE is not None:
        return _MODEL_INSTANCE

    model = ArcStreamLSTM(input_dim=CONDITIONED_INPUT_DIM, output_dim=LATENT_DIM)
    if os.path.exists(WEIGHTS_PATH):
        try:
            state = torch.load(WEIGHTS_PATH, map_location=torch.device("cpu"))
            model.load_state_dict(state)
            print("Loaded trained ArcStream LSTM weights.")
        except Exception as e:
            print(f"Warning: Failed to load weights ({e}). Using baseline initialization.")
    model.eval()
    _MODEL_INSTANCE = model
    return _MODEL_INSTANCE

def predict_next_z_vector(
    history_vectors: List[List[float]],
    target_energy: float
) -> List[float]:
    model = load_inference_model()
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