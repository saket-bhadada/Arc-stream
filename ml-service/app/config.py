# ml-service/app/config.py
MIN_SEQ_LEN = 5
MAX_SEQ_LEN = 9

# Raw, normalized Spotify audio features — this codebase has no autoencoder
# step, so these ARE the latent space for now, not a learned compression.
# Extend this list if your dataset.csv actually has more numeric columns
# (acousticness, instrumentalness, liveness, speechiness, etc.) — check the
# real CSV header, the audit only confirmed these seven exist.
FEATURE_COLS = ['danceability', 'energy', 'key', 'loudness', 'mode', 'tempo', 'valence']
LATENT_DIM   = len(FEATURE_COLS)   # 7
LSTM_INPUT   = LATENT_DIM + 1       # 7 features + 1 target_energy = 8
LSTM_HIDDEN  = 128
LSTM_LAYERS  = 2