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
    if not sequence_history:
        raise ValueError('sequence_history must contain at least one element')
    if any(len(v) != LATENT_DIM for v in sequence_history):
        raise ValueError(f'Every vector in sequence_history must be {LATENT_DIM}-dimensional')

    augmented = [[*v,target_energy] for v in sequence_history]
    x = torch.tensor(augmented,dtype=torch.float32).to(DEVICE).unsqueeze(0)

    with torch.no_grad():
        prediction = model(x)
    return prediction.sequeeze(0).cpu().tolist()
