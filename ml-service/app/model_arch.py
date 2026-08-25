import torch
import torch.nn as nn
from app.config import LSTM_INPUT, LSTM_HIDDEN, LSTM_LAYERS, LATENT_DIM

class ArcStreamLSTM(nn.Module):
    def __init__(self,input_dim:int = LSTM_INPUT,hidden_dim:int = LSTM_HIDDEN,num_layers:int = LSTM_LAYERS,output_dim:int = LATENT_DIM,dropout:float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size = input_dim,
            hidden_size = hidden_dim,
            num_layers = num_layers,
            batch_first = True,
            dropout = dropout,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.Tanh(),
            nn.Linear(64,output_dim),
        )
    def forward(self,x:torch.Tensor):
        lstm_out = self.lstm(x)
        last_hidden = lstm_out[:,-1,:]
        return self.head(last_hidden)