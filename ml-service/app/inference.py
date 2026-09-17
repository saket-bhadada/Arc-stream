import os
import torch
from typing import List,Optional
from model_arch import ArcStreamLSTM
from config import LATENT_DIM

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_model_cache: Optional[ArcStreamLSTM] = None

def load_model(weights_path:str)->ArcStreamLSTM:
    global _model_cache
    if _model_cache is not None:
        return _model_cache
    model = ArcStreamLSTM().to(DEVICE)

    if os.path.exists(weights_path):
        model.load_state_dict(torch.load(weights_path,map_location=DEVICE))
    else:
        print(f'[Inference] WARNING — no weights at {weights_path}')
    model.eval()
    _model_cache = model
    return model

def predict_next_latent_vector(model,sequence_history:List[List[float]],target_energy:float)->List[float]:
    """
    Legacy entry point (Phase 6/7 buffer mode). Kept as-is — DashboardRoutes.js
    /buffer -> /predict_buffer still calls through this path via main.py.
    """
    if not sequence_history:
        raise ValueError('sequence_history must contain at least one element')
    if any(len(v) != LATENT_DIM for v in sequence_history):
        raise ValueError(f'Every vector in sequence_history must be {LATENT_DIM}-dimensional')

    augmented = [[*v,target_energy] for v in sequence_history]
    x = torch.tensor(augmented,dtype=torch.float32).to(DEVICE).unsqueeze(0)

    with torch.no_grad():
        prediction = model(x)
    return prediction.squeeze(0).cpu().tolist()


def predict_next_z_vector(model, sequence_history: List[List[float]], target_energy: float) -> List[float]:
    """
    Phase 8 autoregressive entry point. Functionally identical to
    predict_next_latent_vector — same LATENT_DIM contract (7D feature
    vectors, +1 appended target_energy scalar -> 8D LSTM input) — but
    named to match the generate_playlist autoregressive loop's vocabulary
    ("z_vector" is used throughout database_manager.py / models.py for
    the per-track feature vector, even though there's no autoencoder
    producing it anymore).

    sequence_history: 5-9 rows of LATENT_DIM-dimensional (7D) feature
    vectors — the rolling context window. target_energy: scalar in
    [0,1] for this specific generation step, appended to every row
    exactly like at training time (see train_lstm.py SequenceDataset).
    """
    return predict_next_latent_vector(model, sequence_history, target_energy)