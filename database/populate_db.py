import psycopg2
from os import getenv
import os
import sys
import time
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__),'../service/.env'))

CSV_PATH = os.path.join(
    os.path.dirname(__file__),
    '../ml-service/training/arc_stream_dataset.csv'
)
BATCH_SIZE = 500
Z_COLS = [f'z_{i}' for i in range(32)]
META_COLS = [
    'id',
    'track_name',
    'artists',
    'energy',
    'key',
    'loudness',
    'mode',
    'tempo',
    'valence'
]
REQUIRED = META_COLS + Z_COLS

def build_z_vector_str(row:pd.Series) -> str:
    values = [str(round(float(row[col]),8)) for col in Z_COLS]
    return '[' + ','.join(values) + ']'

def get_connected():
    required_env = ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']
    missing = [k for k in required_env if not getenv(k)]
    if missing:
        print(f'[Populate] ERROR — missing env vars: {", ".join(missing)}')
        print('[Populate] Make sure server/.env exists with DB_* variables.')
        sys.exit(1)
    
    return psycopg2.connect(
        host= os.getenv('DB_HOST'),
        port = int(getenv('DB_PORT')),
        dbname= os.getenv('DB_NAME'),
        user = os.getenv('DB_USER'),
        password = os.getenv('DB_PASSWORD')
    )