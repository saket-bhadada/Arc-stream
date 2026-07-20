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

def main():
    if not os.path.exists(CSV_PATH):
        print(f'csv not found')
        sys.exit(1)

    df = pd.read_csv(CSV_PATH)
    
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        print(f'[Populate] ERROR — CSV missing columns: {missing_cols}')
        sys.exit(1)
    df = df[REQUIRED].copy()
    before = len(df)
    df = df.dropna(subset=['id']+Z_COLS)
    df = df.drop_duplicates(subset='id')
    after = len(df)

    print(f'[Populate] {before:,} rows in CSV → {after:,} after dedup and null drop.')

    print('building z_vector string')
    df['z_vector_str'] = df.apply(build_z_vector_str,axis=1)

    print('Connecting to postgresql')
    conn = get_connected()
    cur = conn.cursor()

    cur.execute("SELECT extname from pg_extension where extname = 'vector'")
    if not cur.fetchone():
        print('[Populate] ERROR — pgvector extension not found in this database.')
        print('[Populate] Run: CREATE EXTENSION vector;  in psql first.')
        conn.close()
        sys.exit(1)

    INSERT_SQL = """
        insert into track_features
        (id, track_name, artists,danceability,energy,key,loudness,mode,tempo,valence,z_vector)
        values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        on conflict (id) do nothing;
    """
    rows = [
        (
            str(row['id']),
            str(row['track_name']),
            str(row['artists']),
            float(row['danceability']) if pd.notna(row['danceability']) else None,
            float(row['energy'])       if pd.notna(row['energy'])       else None,
            int(row['key'])            if pd.notna(row['key'])          else None,
            float(row['loudness'])     if pd.notna(row['loudness'])     else None,
            int(row['mode'])           if pd.notna(row['mode'])         else None,
            float(row['tempo'])        if pd.notna(row['tempo'])        else None,
            float(row['valence'])      if pd.notna(row['valence'])      else None,
            row['z_vector_str'],
        )
        for _, row in df.iterrows()
    ]
    
