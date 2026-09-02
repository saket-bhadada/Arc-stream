import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import db from '../db.js';

const router = Router();
const ML_BASE = process.env.ML_SERVICE_URL || process.env.ML_BASE || 'http://localhost:8000';
const SPOTIFY_BASE = 'https://api.spotify.com/v1';

const spotifyFetch = async (path, accessToken, options = {}) => {
  const response = await fetch(`${SPOTIFY_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Spotify ${response.status} on ${path}: ${await response.text()}`);
  }
  return response.json();
};

const mlFetch = async (path, options = {}) => {
  const response = await fetch(`${ML_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`ML service ${response.status} on ${path}: ${await response.text()}`);
  }
  return response.json();
};

const isValidSequence = (sequence) => (
  Array.isArray(sequence)
  && sequence.length >= 5
  && sequence.length <= 9
  && sequence.every((vector) => (
    Array.isArray(vector)
    && vector.length === 7
    && vector.every(Number.isFinite)
  ))
);

router.get('/track-vector/:trackId', async (req, res) => {
  try {
    const data = await mlFetch(`/track_vector/${encodeURIComponent(req.params.trackId)}`);
    res.json(data);
  } catch (error) {
    console.error('[Track vector] Error:', error.message);
    res.status(404).json({ error: error.message });
  }
});

router.post('/buffer', async (req, res) => {
  const {
    access_token: accessToken,
    target_energy: targetEnergy,
    session_history: sessionHistory = [],
    current_z_sequence: currentZSequence,
  } = req.body;

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  if (!isValidSequence(currentZSequence)) {
    return res.status(400).json({ error: 'current_z_sequence must contain 5 to 9 seven-dimensional vectors' });
  }
  if (!Number.isFinite(targetEnergy) || targetEnergy < 0 || targetEnergy > 1) {
    return res.status(400).json({ error: 'target_energy must be between 0 and 1' });
  }

  const sessionId = req.body.session_id || randomUUID();
  try {
    const { tracks } = await mlFetch('/predict_buffer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_energy: targetEnergy,
        session_history: sessionHistory,
        current_z_sequence: currentZSequence,
      }),
    });

    for (const track of tracks) {
      await spotifyFetch(
        `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${track.track_id}`)}`,
        accessToken,
        { method: 'POST' },
      );
    }

    const userProfile = await spotifyFetch('/me', accessToken);
    for (const track of tracks) {
      await db.query(
        `INSERT INTO prediction_history
          (session_id, user_spotify_id, target_energy, predicted_vector, recommended_track_id, seq_len)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          userProfile.id,
          targetEnergy,
          JSON.stringify(track.predicted_vector),
          track.track_id,
          currentZSequence.length,
        ],
      );
    }

    res.json({ success: true, session_id: sessionId, tracks });
  } catch (error) {
    console.error('[Buffer] Error:', error.message);
    res.status(502).json({ error: error.message });
  }
});

const createPlaylist = async (req, res) => {
  const {
    access_token: accessToken,
    energy_curve: energyCurve,
    current_z_sequence: currentZSequence = [],
    session_history: sessionHistory = [],
    playlist_name: playlistName,
  } = req.body;

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  if (!Array.isArray(energyCurve) || !energyCurve.length || energyCurve.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return res.status(400).json({ error: 'energy_curve must be a non-empty array of values from 0 to 1' });
  }
  if (currentZSequence.length && !isValidSequence(currentZSequence)) {
    return res.status(400).json({ error: 'current_z_sequence must be empty or contain 5 to 9 seven-dimensional vectors' });
  }

  try {
    const { tracks } = await mlFetch('/generate_playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        energy_curve: energyCurve,
        current_z_sequence: currentZSequence,
        session_history: sessionHistory,
      }),
    });
    const userProfile = await spotifyFetch('/me', accessToken);
    const name = playlistName || `Arc-Stream Mix ${new Date().toLocaleDateString('en-US')}`;

    const newPlaylist = await spotifyFetch(`/users/${userProfile.id}/playlists`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: `Generated by Arc-Stream. Energy: [${energyCurve.join(', ')}]`,
        public: false,
      }),
    });

    const uris = tracks.map((track) => `spotify:track:${track.track_id}`);
    for (let index = 0; index < uris.length; index += 100) {
      await spotifyFetch(`/playlists/${newPlaylist.id}/tracks`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ uris: uris.slice(index, index + 100) }),
      });
    }

    const { rows } = await db.query(
      `INSERT INTO playlists
         (user_spotify_id, spotify_playlist_id, name, energy_curve, track_count)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userProfile.id, newPlaylist.id, name, JSON.stringify(energyCurve), tracks.length],
    );
    const playlistId = rows[0].id;
    for (const [position, track] of tracks.entries()) {
      await db.query(
        'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)',
        [playlistId, track.track_id, position],
      );
    }

    res.json({
      success: true,
      playlist_id: newPlaylist.id,
      playlist_url: newPlaylist.external_urls?.spotify,
      name,
      track_count: tracks.length,
      tracks,
    });
  } catch (error) {
    console.error('[Playlist] Error:', error.message);
    res.status(502).json({ error: error.message });
  }
};

router.post('/playlist', createPlaylist);
router.post('/playList', createPlaylist);

export default router;
