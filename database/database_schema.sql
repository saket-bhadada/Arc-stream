-- Arc-Stream data schema.
-- A track vector contains the seven normalized values in app/config.py:
-- danceability, energy, key, loudness, mode, tempo, valence.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS track_features (
    id           VARCHAR(64) PRIMARY KEY,
    track_name   TEXT        NOT NULL,
    artists      TEXT        NOT NULL,
    danceability FLOAT       NOT NULL,
    energy       FLOAT       NOT NULL,
    key          INTEGER     NOT NULL,
    loudness     FLOAT       NOT NULL,
    mode         INTEGER     NOT NULL,
    tempo        FLOAT       NOT NULL,
    valence      FLOAT       NOT NULL,
    z_vector     vector(7)   NOT NULL
);

-- Older revisions created track_features without metadata or with a 32/33
-- dimensional vector. Add the metadata safely and migrate only an empty table;
-- converting populated vectors would silently corrupt the feature contract.
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS track_name TEXT;
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS artists TEXT;
DROP INDEX IF EXISTS track_features_z_vector_idx;

DO $$
DECLARE
    vector_type TEXT;
BEGIN
    SELECT format_type(attribute.atttypid, attribute.atttypmod)
      INTO vector_type
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = current_schema()
       AND relation.relname = 'track_features'
       AND attribute.attname = 'z_vector'
       AND NOT attribute.attisdropped;

    IF vector_type IS DISTINCT FROM 'vector(7)' THEN
        IF EXISTS (SELECT 1 FROM track_features) THEN
            RAISE EXCEPTION
                'track_features uses % and contains data. Rebuild/import it with 7-dimensional vectors before applying this schema.',
                vector_type;
        END IF;

        ALTER TABLE track_features
            ALTER COLUMN z_vector TYPE vector(7)
            USING z_vector::vector(7);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS track_features_z_vector_idx
    ON track_features
    USING hnsw (z_vector vector_l2_ops)
    WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS prediction_history (
    id                   SERIAL       PRIMARY KEY,
    session_id           UUID         NOT NULL,
    user_spotify_id      VARCHAR(128) NOT NULL,
    target_energy        FLOAT        NOT NULL CHECK (target_energy BETWEEN 0 AND 1),
    predicted_vector     JSONB        NOT NULL,
    recommended_track_id VARCHAR(64)  NOT NULL,
    seq_len              INTEGER      NOT NULL CHECK (seq_len BETWEEN 5 AND 9),
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prediction_history_session_idx
    ON prediction_history (session_id);
CREATE INDEX IF NOT EXISTS prediction_history_user_idx
    ON prediction_history (user_spotify_id);

CREATE TABLE IF NOT EXISTS playlists (
    id                  SERIAL       PRIMARY KEY,
    user_spotify_id     VARCHAR(128) NOT NULL,
    spotify_playlist_id VARCHAR(64)  NOT NULL UNIQUE,
    name                VARCHAR(255) NOT NULL,
    energy_curve        JSONB        NOT NULL,
    track_count         INTEGER      NOT NULL CHECK (track_count >= 0),
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playlists_user_idx ON playlists (user_spotify_id);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          SERIAL      PRIMARY KEY,
    playlist_id INTEGER     NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    track_id    VARCHAR(64) NOT NULL,
    position    INTEGER     NOT NULL CHECK (position >= 0),
    UNIQUE (playlist_id, position)
);

CREATE INDEX IF NOT EXISTS playlist_tracks_order_idx
    ON playlist_tracks (playlist_id, position);
