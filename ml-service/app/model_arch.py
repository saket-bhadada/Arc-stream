"""PyTorch model used to predict the next normalized track-feature vector."""

from __future__ import annotations

import torch
from torch import nn

from app.config import LATENT_DIM, LSTM_HIDDEN, LSTM_INPUT, LSTM_LAYERS


class ArcStreamLSTM(nn.Module):
    """Predict a seven-dimensional normalized track vector from a sequence."""

    def __init__(
        self,
        input_dim: int = LSTM_INPUT,
        hidden_dim: int = LSTM_HIDDEN,
        num_layers: int = LSTM_LAYERS,
        output_dim: int = LATENT_DIM,
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.Tanh(),
            nn.Linear(64, output_dim),
            nn.Sigmoid(),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        """Return one normalized feature vector for every batch item."""
        sequence_output, _ = self.lstm(inputs)
        return self.head(sequence_output[:, -1, :])
