import torch
import torch.nn as nn
from app.config import LSTM_INPUT, LSTM_HIDDEN, LSTM_LAYERS, LATENT_DIM

class ArcStreamLSTM(nn.Module):
