# from importlib.metadata import version
from random import random
import random
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel

# Initialize the FastAPI instance
app = FastAPI(
    title = 'Arc-Stream AI Mock Engine',
    description='phase 4 mock',
    version = '0.4.0',
)

MIN_SEQ_LEN = 5
MAX_SEQ_LEN = 9

class BufferRequest(BaseModel):
    target_energy: float
    session_history: list[str]
    current_z_sequence: list[list[float]]


class PlaylistRequest(BaseModel):
    energy_curve: list[float]
    current_z_sequence: list[list[float]]
    session_history: list[str]

MOCK_TRACKS=[
    {
        'track_id':   '3n3Ppam7vgaVa1iaRUIOKE',
        'track_name': 'Mr. Brightside',
        'artists':    'The Killers',
        'energy':     0.92,
    },
    {
        'track_id':   '7ouMYWpwJ422jRcDASZB7P',
        'track_name': 'Knights of Cydonia',
        'artists':    'Muse',
        'energy':     0.88,
    },
    {
        'track_id':   '0VjIjW4GlUZAMYd2vXMi3b',
        'track_name': 'Blinding Lights',
        'artists':    'The Weeknd',
        'energy':     0.73,
    },
    {
        'track_id':   '6UelLqGlWMcVH1E5c4H7lY',
        'track_name': 'Watermelon Sugar',
        'artists':    'Harry Styles',
        'energy':     0.82,
    },
    {
        'track_id':   '2takcwOaAZWiXQijPHIx7B',
        'track_name': 'drivers license',
        'artists':    'Olivia Rodrigo',
        'energy':     0.43,
    },
]

def mock_predicted_vector()->list[float]:
    return [round(random.uniform(-1.0,1.0),6)for _ in range(32)]


@app.get('/')
def health():
    return {
        'status':'ok',
        'service':'Arc-Stream AI mock Engine',
        'phase': 4,
        'note':'replace with real lstm engine in phase 5'
    }

@app.post('/predict_buffer')
def predict_buffer(payload:BufferRequest):
    seq_len = len(payload.current_z_sequence)
    if not (MIN_SEQ_LEN <= seq_len <= MAX_SEQ_LEN):
        raise HTTPException(status_code=400,
        detail=f'current_z_sequence length must be between '
                f'{MIN_SEQ_LEN} and {MAX_SEQ_LEN}, got {seq_len}')
    chosen = random.sample(MOCK_TRACKS,k=3)
    tracks = [
        {**track, 'predicted_vector':mock_predicted_vector()}
        for track in chosen
    ]
    return {
        'tracks':tracks,
        'seq_len':seq_len,
    }

@app.post('/generate_playlist')
def generate_playlist(payload:PlaylistRequest):
    seq_len = len(payload.current_z_sequence)
    curve_len = len(payload.energy_curve)

    if not (MIN_SEQ_LEN<=seq_len<=MAX_SEQ_LEN):
        raise HTTPException(status_code=400,
        detail=(
            f'current_z_sequence length must be between '
            f'{MIN_SEQ_LEN} and {MAX_SEQ_LEN}, got {seq_len}'
        ))
    if curve_len == 0:
        raise HTTPException(
            status_code=400,
            detail=('Energy must not be empty')
        )
    tracks=[
        random.choice(MOCK_TRACKS)
        for _ in range(curve_len)
    ]
    return {
        'tracks':    tracks,
        'seq_len':   seq_len,
        'curve_len': curve_len,
    }