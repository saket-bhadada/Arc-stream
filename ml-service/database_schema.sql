-- Arc-Stream Database Schema for PostgreSQL with pgvector
-- This schema is designed for production backend use

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main tracks table
CREATE TABLE IF NOT EXISTS arc_stream_tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(255) UNIQUE NOT NULL,
    track_name VARCHAR(500) NOT NULL,
    artists TEXT NOT NULL,
    album_name VARCHAR(500),
    genre VARCHAR(100) NOT NULL,
    popularity INTEGER,
    duration_ms INTEGER,
    explicit BOOLEAN DEFAULT FALSE,
    
    -- Audio features
    energy FLOAT,
    danceability FLOAT,
    valence FLOAT,
    acousticness FLOAT,
    instrumentalness FLOAT,
    liveness FLOAT,
    speechiness FLOAT,
    loudness FLOAT,
    tempo FLOAT,
    key INTEGER,
    mode INTEGER,
    time_signature INTEGER,
    
    -- 32D latent vector from autoencoder
    z_vector vector(32) NOT NULL,
    
    -- Metadata stored as JSON for flexibility
    metadata JSONB,
    
    -- Timestamps for tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_genre ON arc_stream_tracks(genre),
    INDEX idx_popularity ON arc_stream_tracks(popularity),
    INDEX idx_created_at ON arc_stream_tracks(created_at)
);

-- Create index for vector similarity search (pgvector)
CREATE INDEX ON arc_stream_tracks USING ivfflat (z_vector vector_cosine_ops)
WITH (lists = 100);

-- Playlists table for user/session playlists
CREATE TABLE IF NOT EXISTS playlists (
    id SERIAL PRIMARY KEY,
    playlist_id VARCHAR(255) UNIQUE NOT NULL,
    playlist_name VARCHAR(500) NOT NULL,
    description TEXT,
    user_id VARCHAR(255),
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_id ON playlists(user_id),
    INDEX idx_created_at ON playlists(created_at)
);

-- Playlist tracks junction table
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER NOT NULL,
    track_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_playlist FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    CONSTRAINT fk_track FOREIGN KEY (track_id) REFERENCES arc_stream_tracks(id) ON DELETE CASCADE,
    
    UNIQUE (playlist_id, position),
    INDEX idx_playlist_id ON playlist_tracks(playlist_id),
    INDEX idx_track_id ON playlist_tracks(track_id)
);

-- Prediction history table for tracking LSTM predictions
CREATE TABLE IF NOT EXISTS prediction_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    input_track_id INTEGER,
    predicted_z_vector vector(32),
    recommended_track_id INTEGER,
    distance_score FLOAT,
    user_feedback VARCHAR(50), -- 'liked', 'skipped', 'neutral'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_input_track FOREIGN KEY (input_track_id) REFERENCES arc_stream_tracks(id),
    CONSTRAINT fk_recommended_track FOREIGN KEY (recommended_track_id) REFERENCES arc_stream_tracks(id),
    
    INDEX idx_session_id ON prediction_history(session_id),
    INDEX idx_created_at ON prediction_history(created_at)
);

-- Genre mapping table
CREATE TABLE IF NOT EXISTS genres (
    id SERIAL PRIMARY KEY,
    genre_name VARCHAR(100) UNIQUE NOT NULL,
    genre_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_genre_name ON genres(genre_name)
);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers for auto-updating timestamps
CREATE TRIGGER update_tracks_timestamp
BEFORE UPDATE ON arc_stream_tracks
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_playlists_timestamp
BEFORE UPDATE ON playlists
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Summary statistics view
CREATE VIEW arc_stream_stats AS
SELECT 
    COUNT(*) as total_tracks,
    COUNT(DISTINCT genre) as unique_genres,
    AVG(energy) as avg_energy,
    AVG(danceability) as avg_danceability,
    AVG(valence) as avg_valence,
    AVG(popularity) as avg_popularity
FROM arc_stream_tracks;

-- Grant permissions (adjust user as needed)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO arc_stream_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO arc_stream_user;
