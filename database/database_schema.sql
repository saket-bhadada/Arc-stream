-- database/database_schema.sql
-- Phase 6: adds track_name/artists to track_features (bug fix — populate_db.py
-- always inserted these but the table never defined them).
-- ALTER TABLE ... IF NOT EXISTS is safe to re-run on every db.js startup.

CREATE EXTENSION IF NOT EXISTS vector;


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE 1: track_features
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS track_features (
    id           VARCHAR(64)  PRIMARY KEY,
    danceability FLOAT,
    energy       FLOAT,
    key          INTEGER,
    loudness     FLOAT,
    mode         INTEGER,
    tempo        FLOAT,
    valence      FLOAT,
    z_vector     vector(33)   NOT NULL
);

-- Phase 6 patch — required for /predict_buffer to return readable track info
-- without a join. Safe on existing databases: skips if column already exists.
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS track_name TEXT;
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS artists    TEXT;

CREATE INDEX IF NOT EXISTS track_features_z_vector_idx
    ON track_features
    USING hnsw (z_vector vector_l2_ops)
    WITH (m = 16, ef_construction = 64);


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE 2: prediction_history
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS prediction_history (
    id                   SERIAL       PRIMARY KEY,
    session_id           UUID         NOT NULL,
    user_spotify_id      VARCHAR(128) NOT NULL,
    target_energy        FLOAT        NOT NULL,
    predicted_vector     JSONB        NOT NULL,
    recommended_track_id VARCHAR(64)  NOT NULL,
    seq_len              INTEGER      NOT NULL,
    created_at           TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prediction_history_session_idx
    ON prediction_history (session_id);

CREATE INDEX IF NOT EXISTS prediction_history_user_idx
    ON prediction_history (user_spotify_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE 3: playlists
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS playlists (
    id                   SERIAL       PRIMARY KEY,
    user_spotify_id      VARCHAR(128) NOT NULL,
    spotify_playlist_id  VARCHAR(64)  NOT NULL UNIQUE,
    name                 VARCHAR(255) NOT NULL,
    energy_curve         JSONB        NOT NULL,
    track_count          INTEGER      NOT NULL,
    created_at           TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playlists_user_idx
    ON playlists (user_spotify_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE 4: playlist_tracks
-- ═════════════════════════════════════════════════════════════════════════════
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


-- Phase 7 fix: z_vector was declared vector(33) but populate_db.py only ever
-- built 32 dimensions. Energy is a per-request target, not a track attribute —
-- it doesn't belong baked into a static row. Safe to run since track_features
-- has not yet been successfully populated (the 33-dim declaration would have
-- rejected every insert).
DROP INDEX IF EXISTS track_features_z_vector_idx;
ALTER TABLE track_features ALTER COLUMN z_vector TYPE vector(32);
CREATE INDEX IF NOT EXISTS track_features_z_vector_idx
    ON track_features
    USING hnsw (z_vector vector_l2_ops)
    WITH (m = 16, ef_construction = 64);