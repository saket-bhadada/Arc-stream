"""
Arc-Stream Database Manager
Provides a clean interface for backend code to interact with the PostgreSQL database
"""

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
import json
from typing import List, Dict, Tuple, Optional
from datetime import datetime
import numpy as np


class ArcStreamDB:
    """Database manager for Arc-Stream music recommendation system"""
    
    def __init__(self, host: str, database: str, user: str, password: str, port: int = 5432):
        """
        Initialize database connection
        
        Args:
            host: Database host
            database: Database name
            user: Database user
            password: Database password
            port: Database port (default: 5432)
        """
        self.conn = None
        self.connect(host, database, user, password, port)
    
    def connect(self, host: str, database: str, user: str, password: str, port: int = 5432):
        """Establish database connection"""
        try:
            self.conn = psycopg2.connect(
                host=host,
                database=database,
                user=user,
                password=password,
                port=port
            )
            print(f"✓ Connected to database: {database}")
        except psycopg2.Error as e:
            print(f"✗ Database connection failed: {e}")
            raise
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            print("✓ Database connection closed")
    
    # ==================== TRACK OPERATIONS ====================
    
    def insert_track(self, track_data: Dict, z_vector: List[float]) -> int:
        """
        Insert a new track into the database
        
        Args:
            track_data: Dictionary with track information
            z_vector: 32D latent vector from autoencoder
            
        Returns:
            id: The database ID of the inserted track
        """
        query = """
        INSERT INTO arc_stream_tracks (
            track_id, track_name, artists, album_name, genre, 
            popularity, duration_ms, explicit,
            energy, danceability, valence, acousticness, instrumentalness,
            liveness, speechiness, loudness, tempo, key, mode, time_signature,
            z_vector, metadata
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s
        )
        ON CONFLICT (track_id) DO NOTHING
        RETURNING id;
        """
        
        with self.conn.cursor() as cursor:
            cursor.execute(query, (
                track_data.get('track_id'),
                track_data.get('track_name'),
                track_data.get('artists'),
                track_data.get('album_name'),
                track_data.get('track_genre'),
                track_data.get('popularity'),
                track_data.get('duration_ms'),
                track_data.get('explicit', False),
                track_data.get('energy'),
                track_data.get('danceability'),
                track_data.get('valence'),
                track_data.get('acousticness'),
                track_data.get('instrumentalness'),
                track_data.get('liveness'),
                track_data.get('speechiness'),
                track_data.get('loudness'),
                track_data.get('tempo'),
                track_data.get('key'),
                track_data.get('mode'),
                track_data.get('time_signature'),
                z_vector,
                json.dumps(track_data)  # Store full metadata as JSON
            ))
            
            result = cursor.fetchone()
            self.conn.commit()
            
            if result:
                return result[0]
            else:
                # Track already exists, fetch its ID
                cursor.execute("SELECT id FROM arc_stream_tracks WHERE track_id = %s", 
                             (track_data.get('track_id'),))
                return cursor.fetchone()[0]
    
    def insert_batch_tracks(self, tracks_data: List[Dict], z_vectors: np.ndarray) -> int:
        """
        Insert multiple tracks efficiently
        
        Args:
            tracks_data: List of track dictionaries
            z_vectors: NumPy array of shape (N, 32) with latent vectors
            
        Returns:
            count: Number of tracks inserted
        """
        query = """
        INSERT INTO arc_stream_tracks (
            track_id, track_name, artists, album_name, genre, 
            popularity, duration_ms, explicit,
            energy, danceability, valence, acousticness, instrumentalness,
            liveness, speechiness, loudness, tempo, key, mode, time_signature,
            z_vector, metadata
        ) VALUES %s
        ON CONFLICT (track_id) DO NOTHING;
        """
        
        rows = []
        for i, track in enumerate(tracks_data):
            rows.append((
                track.get('track_id'),
                track.get('track_name'),
                track.get('artists'),
                track.get('album_name'),
                track.get('track_genre'),
                track.get('popularity'),
                track.get('duration_ms'),
                track.get('explicit', False),
                track.get('energy'),
                track.get('danceability'),
                track.get('valence'),
                track.get('acousticness'),
                track.get('instrumentalness'),
                track.get('liveness'),
                track.get('speechiness'),
                track.get('loudness'),
                track.get('tempo'),
                track.get('key'),
                track.get('mode'),
                track.get('time_signature'),
                z_vectors[i].tolist(),
                json.dumps(track)
            ))
        
        with self.conn.cursor() as cursor:
            execute_values(cursor, query, rows)
            self.conn.commit()
            return cursor.rowcount
    
    def find_nearest_tracks(self, z_vector: List[float], 
                           num_results: int = 3, 
                           genre_filter: Optional[str] = None) -> List[Dict]:
        """
        Find nearest tracks using pgvector similarity search
        
        Args:
            z_vector: 32D latent vector
            num_results: Number of results to return
            genre_filter: Optional genre to filter by
            
        Returns:
            List of nearest tracks with metadata
        """
        if genre_filter:
            query = """
            SELECT 
                id, track_id, track_name, artists, energy, genre,
                z_vector <-> %s::vector AS distance
            FROM arc_stream_tracks
            WHERE genre = %s
            ORDER BY z_vector <-> %s::vector
            LIMIT %s;
            """
            params = (z_vector, genre_filter, z_vector, num_results)
        else:
            query = """
            SELECT 
                id, track_id, track_name, artists, energy, genre,
                z_vector <-> %s::vector AS distance
            FROM arc_stream_tracks
            ORDER BY z_vector <-> %s::vector
            LIMIT %s;
            """
            params = (z_vector, z_vector, num_results)
        
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)
            results = cursor.fetchall()
        
        return [dict(row) for row in results]
    
    def get_track_by_id(self, track_id: str) -> Optional[Dict]:
        """Get track details by track_id"""
        query = """
        SELECT * FROM arc_stream_tracks WHERE track_id = %s;
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, (track_id,))
            result = cursor.fetchone()
        return dict(result) if result else None
    
    def get_track_z_vector(self, track_id: str) -> Optional[List[float]]:
        """Get the z_vector for a track"""
        query = """
        SELECT z_vector FROM arc_stream_tracks WHERE track_id = %s;
        """
        with self.conn.cursor() as cursor:
            cursor.execute(query, (track_id,))
            result = cursor.fetchone()
        return result[0] if result else None
    
    # ==================== GENRE OPERATIONS ====================
    
    def get_all_genres(self) -> List[str]:
        """Get list of all unique genres"""
        query = "SELECT DISTINCT genre FROM arc_stream_tracks ORDER BY genre;"
        with self.conn.cursor() as cursor:
            cursor.execute(query)
            results = cursor.fetchall()
        return [row[0] for row in results]
    
    def get_genre_stats(self) -> List[Dict]:
        """Get statistics for each genre"""
        query = """
        SELECT 
            genre,
            COUNT(*) as track_count,
            AVG(energy) as avg_energy,
            AVG(danceability) as avg_danceability,
            AVG(valence) as avg_valence,
            AVG(popularity) as avg_popularity
        FROM arc_stream_tracks
        GROUP BY genre
        ORDER BY track_count DESC;
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query)
            results = cursor.fetchall()
        return [dict(row) for row in results]
    
    # ==================== PLAYLIST OPERATIONS ====================
    
    def create_playlist(self, playlist_name: str, user_id: str = None, 
                       description: str = None, is_public: bool = False) -> int:
        """
        Create a new playlist
        
        Returns:
            playlist_id: Database ID of created playlist
        """
        query = """
        INSERT INTO playlists (playlist_name, user_id, description, is_public)
        VALUES (%s, %s, %s, %s)
        RETURNING id;
        """
        with self.conn.cursor() as cursor:
            cursor.execute(query, (playlist_name, user_id, description, is_public))
            self.conn.commit()
            result = cursor.fetchone()
        return result[0]
    
    def add_track_to_playlist(self, playlist_id: int, track_id: int, position: int = None) -> bool:
        """Add a track to a playlist"""
        if position is None:
            # Get next position
            query = "SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = %s;"
            with self.conn.cursor() as cursor:
                cursor.execute(query, (playlist_id,))
                result = cursor.fetchone()
            position = (result[0] or 0) + 1
        
        query = """
        INSERT INTO playlist_tracks (playlist_id, track_id, position)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING;
        """
        with self.conn.cursor() as cursor:
            cursor.execute(query, (playlist_id, track_id, position))
            self.conn.commit()
        return cursor.rowcount > 0
    
    def get_playlist_tracks(self, playlist_id: int) -> List[Dict]:
        """Get all tracks in a playlist"""
        query = """
        SELECT 
            pt.id, pt.position,
            t.id as track_db_id, t.track_id, t.track_name, t.artists, 
            t.genre, t.energy, t.popularity, t.added_at
        FROM playlist_tracks pt
        JOIN arc_stream_tracks t ON pt.track_id = t.id
        WHERE pt.playlist_id = %s
        ORDER BY pt.position;
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, (playlist_id,))
            results = cursor.fetchall()
        return [dict(row) for row in results]
    
    # ==================== PREDICTION HISTORY OPERATIONS ====================
    
    def log_prediction(self, session_id: str, input_track_id: int, 
                      predicted_z_vector: List[float], 
                      recommended_track_id: int, distance_score: float) -> int:
        """Log an LSTM prediction"""
        query = """
        INSERT INTO prediction_history 
        (session_id, input_track_id, predicted_z_vector, recommended_track_id, distance_score)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id;
        """
        with self.conn.cursor() as cursor:
            cursor.execute(query, (session_id, input_track_id, predicted_z_vector, 
                                  recommended_track_id, distance_score))
            self.conn.commit()
            result = cursor.fetchone()
        return result[0]
    
    def update_prediction_feedback(self, prediction_id: int, feedback: str):
        """Update user feedback for a prediction"""
        query = """
        UPDATE prediction_history SET user_feedback = %s WHERE id = %s;
        """
        with self.conn.cursor() as cursor:
            cursor.execute(query, (feedback, prediction_id))
            self.conn.commit()
    
    def get_prediction_history(self, session_id: str) -> List[Dict]:
        """Get prediction history for a session"""
        query = """
        SELECT * FROM prediction_history WHERE session_id = %s ORDER BY created_at DESC;
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, (session_id,))
            results = cursor.fetchall()
        return [dict(row) for row in results]
    
    # ==================== STATISTICS ====================
    
    def get_database_stats(self) -> Dict:
        """Get overall database statistics"""
        query = """
        SELECT 
            COUNT(*) as total_tracks,
            COUNT(DISTINCT genre) as unique_genres,
            AVG(energy) as avg_energy,
            AVG(danceability) as avg_danceability,
            AVG(valence) as avg_valence,
            AVG(popularity) as avg_popularity,
            MIN(created_at) as earliest_track,
            MAX(created_at) as latest_track
        FROM arc_stream_tracks;
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query)
            result = cursor.fetchone()
        return dict(result) if result else {}


# Example usage
if __name__ == "__main__":
    # Initialize database connection
    db = ArcStreamDB(
        host="localhost",
        database="arc_stream",
        user="arc_stream_user",
        password="your_password",
        port=5432
    )
    
    # Get database stats
    stats = db.get_database_stats()
    print(f"Database Stats: {stats}")
    
    # Find nearest tracks to a 32D vector
    sample_vector = [0.1] * 32
    nearest = db.find_nearest_tracks(sample_vector, num_results=5)
    print(f"Nearest tracks: {nearest}")
    
    # Close connection
    db.close()
