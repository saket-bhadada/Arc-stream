create Extension if not exists vector;

create table if not exists track_features(
    id varchar(50) primary key,
    danceability float,
    energy float,
    key integer,
    loudness float,
    mode integer,
    tempo float,
    valence float,
    z_vector vector(33) not null
);

create index if not exists track_features_z_vector_idx
on track_features
using hnsw (z_vector vector_12_ops)
with (m=16,ef_construction=64);

CREATE TABLE IF NOT EXISTS prediction_history (
    id                   SERIAL       PRIMARY KEY,
    session_id           UUID         NOT NULL,
    user_spotify_id      VARCHAR(128) NOT NULL,      -- ← Phase 4: which user
    target_energy        FLOAT        NOT NULL,
    predicted_vector     JSONB        NOT NULL,
    recommended_track_id VARCHAR(64)  NOT NULL,
    seq_len              INTEGER      NOT NULL,
    created_at           TIMESTAMP    DEFAULT NOW()
);

create index if not exists prediction_history_session_idx
on prediction_history (session_id);

create index if not exists prediction_history_user_idx
on prediction_history (user_spotify_id);

create table if not exists playlist(
    id SERIAL primary key,
    user_spotify_id VARCHAR(128) not null,
    spotify_playlist_id VARCHAR(64) not null,
    name VARCHAR(255) not null,
    energy_curve JSONB not null,
    track_count integer not null,
    created_at TIMESTAMP DEFAULT now()
);

create index if not exists playlist_user_idx
on playlist (user_spotify_id);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          SERIAL      PRIMARY KEY,
    playlist_id INTEGER     NOT NULL,
    track_id    VARCHAR(64) NOT NULL,
    position    INTEGER     NOT NULL,

    FOREIGN KEY (playlist_id)
        REFERENCES playlists (id)
        ON DELETE CASCADE,

    UNIQUE (playlist_id, position)
);

CREATE INDEX IF NOT EXISTS playlist_tracks_order_idx
    ON playlist_tracks (playlist_id, position);