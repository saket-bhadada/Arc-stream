import psycopg2
from os import getenv
import os
import sys
import time
import random
import pandas as pd
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../server/.env'))

CSV_PATH = os.path.join(
    os.path.dirname(__file__),
    '../ml-service/training/dataset.csv'
)
BATCH_SIZE = 500

# Columns we actually require from the Kaggle dataset.csv
# 'track_id' is mapped to 'id' in our table
CSV_COLS = [
    'track_id',
    'track_name',
    'artists',
    'danceability',
    'energy',
    'key',
    'loudness',
    'mode',
    'tempo',
    'valence'
]

def generate_mock_z_vector(track_id: str) -> str:
    # Deterministically generate a 33-dimensional float vector using track_id as seed
    rng = random.Random(track_id)
    vector = [rng.random() for _ in range(33)]
    return '[' + ','.join(f"{v:.8f}" for v in vector) + ']'

def get_connected():
    db_name = getenv('DB_DATABASE') or getenv('DB_NAME')
    required_env = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']
    missing = [k for k in required_env if not getenv(k)]
    if not db_name:
        missing.append('DB_DATABASE or DB_NAME')
    if missing:
        print(f'[Populate] ERROR — missing env vars: {", ".join(missing)}')
        print('[Populate] Make sure server/.env exists with DB_* variables.')
        sys.exit(1)
    
    return psycopg2.connect(
        host=os.getenv('DB_HOST'),
        port=int(getenv('DB_PORT')),
        dbname=db_name,
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD')
    )

def main():
    if not os.path.exists(CSV_PATH):
        print(f'csv not found: {CSV_PATH}')
        sys.exit(1)

    df = pd.read_csv(CSV_PATH)
    
    missing_cols = [c for c in CSV_COLS if c not in df.columns]
    if missing_cols:
        print(f'[Populate] ERROR — CSV missing columns: {missing_cols}')
        sys.exit(1)
        
    df = df[CSV_COLS].copy()
    before = len(df)
    # Drop rows where critical track identifying information is null
    df = df.dropna(subset=['track_id', 'track_name', 'artists'])
    df = df.drop_duplicates(subset='track_id')
    after = len(df)

    print(f'[Populate] {before:,} rows in CSV -> {after:,} after dedup and null drop.')

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
        (id, track_name, artists, danceability, energy, key, loudness, mode, tempo, valence, z_vector)
        values(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (id) do nothing;
    """
    
    print('Preparing database rows...')
    rows = [
        (
            str(row['track_id']),
            str(row['track_name']),
            str(row['artists']),
            float(row['danceability']) if pd.notna(row['danceability']) else None,
            float(row['energy'])       if pd.notna(row['energy'])       else None,
            int(row['key'])            if pd.notna(row['key'])          else None,
            float(row['loudness'])     if pd.notna(row['loudness'])     else None,
            int(row['mode'])           if pd.notna(row['mode'])         else None,
            float(row['tempo'])        if pd.notna(row['tempo'])        else None,
            float(row['valence'])      if pd.notna(row['valence'])      else None,
            generate_mock_z_vector(str(row['track_id'])),
        )
        for _, row in df.iterrows()
    ]
    
    total = len(rows)
    inserted = 0
    start_time = time.time()

    print(f'Inserting {total:,} rows in batches of {BATCH_SIZE}')
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i+BATCH_SIZE]
        execute_batch(cur, INSERT_SQL, batch, page_size=BATCH_SIZE)
        conn.commit()
        inserted += len(batch)
        pct = (inserted/total)*100
        elapsed = time.time()-start_time
        print(f'[Populate]   {inserted:,}/{total:,} ({pct:.1f}%) — {elapsed:.1f}s elapsed')

    cur.close()
    conn.close()

    elapsed = time.time() - start_time
    print(f'[Populate] Done — {inserted:,} rows in {elapsed:.1f}s.')
    print('[Populate] track_features is ready for pgvector search.')

if __name__ == '__main__':
    main()
