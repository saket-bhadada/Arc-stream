import os
import sys
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from torch.optim import AdamW
from torch.optim.lr_sechduler import ReduceLROnPlateau

from database.populate_db import BATCH_SIZE
# sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))

from model_arch import ArcStreamLSTM
# from app.model_arch import ArcStreamLSTM
from config import FEATURE_COLS, MIN_SEQ_LEN
from feature_utils import normalize_row

CSV_PATH = os.path.join(os.path.dirname(__file__),'..','training','dataset.csv')
WEIGHTS_PATH = os.path.join(os.path.dirname(__file__),'weights','arc_stream_lstm.pth')
SEQ_LEN = MIN_SEQ_LEN
BATCH_SIZE = 64
EPOCHS = 50
LR = 1e-3

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

class SequenceDataset(Dataset):
    def __init__(self,df:pd.DataFrame, seq_len:int=SEQ_LEN):
        self.seq_len = seq_len
        self.X, self.y = self._build_windows(df)

    def _build_windows(self,df:pd.DataFrame):
        X_list,y_list = [],[]
        if 'playlist_id' in df.columns and 'track_position' in df.columns:
            print('[Train] Grouping windows by playlist_id (real sequence order).')
            groups = [g.sort_values('track_position') for _, g in df.groupby(['playlist_id'])]
        else:
            print('[Train] No playlist_id/track_position — using row order as one')
            print('[Train] pseudo-sequence. Real session data trains a better model.')
            groups = [df]

        for group in groups:
            feats = np.array([normalize_row(r) for _, r in group.iterrows()],dtype=np.float32)
            energy = feats[:,FEATURE_COLS.index('energy')]

            n = len(group)
            if n<=self.seq_len:
                continue
            for i in range(n-self.seq_len):
                windows_feats = feats[i:i+self.seq_len]
                taget_energy = energy[i:i+self.seq_len]
                window_energy = np.full((self.seq_len,),target_energy=taget_energy,dtype=np.float32)
                x = np.concatenate([windows_feats, window_energy[:None]],axis=1)
                y = feats[i+self.seq_len]
                X_list.append(x)
                y_list.append(y)

            return (
                torch.tensor(np.stack(X_list),dtype=torch.float32),
                torch.tensor(np.stack(y_list),dtype=torch.float32)
            )

    def __len__(self):
        return len(self.X)
    def __getitem__(self,idx):
        return self.X[idx],self.y[idx]


def main():
    if not os.path.exists(CSV_PATH):
        print(f'[Train] ERROR CSV not found at {CSV_PATH}')
        sys.exit(1)

    print(f'[Train] Loading weights from {CSV_PATH}')
    df = pd.read_csv(CSV_PATH)
    missing = [c for c in df.columns if c not in df.columns]
    if missing:
        print(f'[Train] ERROR — CSV missing columns: {missing}')
        print('[Train] Update FEATURE_COLS in app/config.py to match your CSV header.')
        sys.exit(1)
    df = df.dropna(subset=FEATURE_COLS)
    dataset = SequenceDataset(df,seq_len=SEQ_LEN)
    print(f'[Train] {len(dataset):,} training windows built (seq_len={SEQ_LEN}).')

    if len(dataset) < 10:
        print('[Train] ERROR — too few windows to train. Check dataset.csv row count.')
        sys.exit(1)

    val_size = max(1,int(len(dataset)*0.1))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset,[train_size,val_size])
    train_loader = DataLoader(train_ds,batch_size=BATCH_SIZE,shuffle=True)
    val_loader = DataLoader(val_ds,batch_size=BATCH_SIZE,shuffle=False)
    model = ArcStreamLSTM().to(DEVICE)
    criterion = nn.MSELoss()
    optimizer = AdamW(model.parameters(),lr=LR)
    scheduler = ReduceLROnPlateau(optimizer,mode='min',factor=0.5,patience=3)
    best_val_loss = float('inf')
