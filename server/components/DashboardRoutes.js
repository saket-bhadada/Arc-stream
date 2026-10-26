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
  try {
    const {
      access_token: accessToken,
      seed_track_ids: seedTrackIds = [],
      custom_energy_curve: customEnergyCurve,
      energy_curve: energyCurve,
      current_z_sequence: currentZSequence = [],
      session_history: sessionHistory = [],
      playlist_name: playlistName,
      track_count: trackCount,
      curve_type: curveType = 'arc',
      export_to_spotify: exportToSpotify = false,
    } = req.body || {};

    const resolvedCurve =
      Array.isArray(customEnergyCurve) && customEnergyCurve.length
        ? customEnergyCurve
        : Array.isArray(energyCurve) && energyCurve.length
          ? energyCurve
          : [0.3, 0.45, 0.6, 0.75, 0.85, 0.9, 0.8, 0.65, 0.5, 0.4];

    const mlData = await mlFetch('/generate_playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed_track_ids: Array.isArray(seedTrackIds) ? seedTrackIds : [],
        custom_energy_curve: resolvedCurve,
        energy_curve: resolvedCurve,
        current_z_sequence: Array.isArray(currentZSequence) ? currentZSequence : [],
        session_history: Array.isArray(sessionHistory) ? sessionHistory : [],
        track_count: Number(trackCount) || resolvedCurve.length || 10,
        curve_type: curveType,
      }),
    });

    const tracks = mlData.playlist || mlData.tracks || [];

    if (!exportToSpotify) {
      return res.status(200).json({
        success: true,
        preview: true,
        track_count: tracks.length,
        tracks,
        energy_curve: mlData.energy_curve || resolvedCurve,
      });
    }

    const name = playlistName || `Arc-Stream Mix ${new Date().toLocaleDateString('en-US')}`;

    try {
      if (!accessToken) {
        throw new Error('Missing Spotify access token');
      }

      const userProfile = await spotifyFetch('/me', accessToken);
      const newPlaylist = await spotifyFetch('/me/playlists', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: `Generated by Arc-Stream. Energy: [${resolvedCurve.map((v) => Number(v).toFixed(2)).join(', ')}]`,
          public: false,
        }),
      });

      const uris = tracks
        .map((track) => track.track_id)
        .filter(Boolean)
        .map((id) => (id.startsWith('spotify:track:') ? id : `spotify:track:${id}`));

      for (let index = 0; index < uris.length; index += 100) {
        const chunk = uris.slice(index, index + 100);
        try {
          await spotifyFetch(`/playlists/${newPlaylist.id}/tracks`, accessToken, {
            method: 'POST',
            body: JSON.stringify({ uris: chunk }),
          });
        } catch (err) {
          if (err.message && err.message.includes('403')) {
            console.warn('[Playlist] /tracks returned 403, attempting /items fallback...');
            await spotifyFetch(`/playlists/${newPlaylist.id}/items`, accessToken, {
              method: 'POST',
              body: JSON.stringify({ uris: chunk }),
            });
          } else {
            throw err;
          }
        }
      }

      try {
        const { rows } = await db.query(
          `INSERT INTO playlists
             (user_spotify_id, spotify_playlist_id, name, energy_curve, track_count)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [userProfile.id, newPlaylist.id, name, JSON.stringify(resolvedCurve), tracks.length],
        );
        const playlistId = rows[0]?.id;
        if (playlistId) {
          for (const [position, track] of tracks.entries()) {
            await db.query(
              'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)',
              [playlistId, track.track_id, position],
            );
          }
        }
      } catch (dbErr) {
        console.warn('[Playlist] Non-fatal DB save warning:', dbErr.message);
      }

      return res.status(200).json({
        success: true,
        exported: true,
        playlist_id: newPlaylist.id,
        playlist_url: newPlaylist.external_urls?.spotify,
        spotify_url: newPlaylist.external_urls?.spotify,
        name,
        track_count: tracks.length,
        tracks,
        energy_curve: mlData.energy_curve || resolvedCurve,
      });
    } catch (spErr) {
      console.warn('[Playlist] Spotify export failed, returning generated tracks anyway:', spErr.message);
      return res.status(200).json({
        success: true,
        exported: false,
        export_error: spErr.message,
        name,
        track_count: tracks.length,
        tracks,
        energy_curve: mlData.energy_curve || resolvedCurve,
      });
    }
  } catch (error) {
    console.error('[Playlist] Error:', error.message);
    return res.status(502).json({ error: error.message });
  }
};

router.post('/playlist', async (req, res) => {
  if (req.body?.action === 'export' && Array.isArray(req.body?.tracks) && req.body.tracks.length > 0 && !req.body?.seed_track_ids) {
    return exportPlaylist(req, res);
  }
  return createPlaylist(req, res);
});

router.post('/playList', createPlaylist);

const generatePlaylistPreview = async (req, res) => {
  req.body = { ...req.body, export_to_spotify: false };
  return createPlaylist(req, res);
};

const exportPlaylist = async (req, res) => {
  const {
    access_token: accessToken,
    playlist_name: playlistName,
    energy_curve: energyCurve = [],
  } = req.body;
  const tracks = Array.isArray(req.body.tracks) ? req.body.tracks : req.body.playlist;

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  if (!Array.isArray(tracks) || tracks.length === 0 || tracks.some((track) => !track?.track_id)) {
    return res.status(400).json({ error: 'tracks must be a non-empty array of tracks with track_id values' });
  }

  try {
    const userProfile = await spotifyFetch('/me', accessToken);
    const name = playlistName || `Arc-Stream Mix ${new Date().toLocaleDateString('en-US')}`;
    const newPlaylist = await spotifyFetch('/me/playlists', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: 'Generated by Arc-Stream.',
        public: false,
      }),
    });

    const uris = tracks.map((track) => `spotify:track:${track.track_id}`);
    for (let index = 0; index < uris.length; index += 100) {
      const chunk = uris.slice(index, index + 100);
      try {
        await spotifyFetch(`/playlists/${newPlaylist.id}/tracks`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ uris: chunk }),
        });
      } catch (error) {
        if (!error.message.includes('403')) throw error;
        await spotifyFetch(`/playlists/${newPlaylist.id}/items`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ uris: chunk }),
        });
      }
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

    return res.json({
      success: true,
      playlist_id: newPlaylist.id,
      playlist_url: newPlaylist.external_urls?.spotify,
      name,
      track_count: tracks.length,
      tracks,
    });
  } catch (error) {
    console.error('[Export Playlist] Error:', error.message);
    return res.status(502).json({ error: 'Failed to export playlist', detail: error.message });
  }
};

router.post('/generate-playlist', generatePlaylistPreview);
router.post('/export-playlist', exportPlaylist);

router.post('/queue-preview', async (req, res) => {
  const {
    seed_track_ids: seedTrackIds,
    target_energy: targetEnergy,
    count = 5,
    session_history: sessionHistory = [],
  } = req.body;

  if (
    !Array.isArray(seedTrackIds)
    || seedTrackIds.length < 1
    || seedTrackIds.length > 9
    || seedTrackIds.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    return res.status(400).json({ error: 'seed_track_ids must be an array of 1 to 9 non-empty string IDs' });
  }

  if (!Number.isFinite(targetEnergy) || targetEnergy < 0 || targetEnergy > 1) {
    return res.status(400).json({ error: 'target_energy must be a number between 0 and 1' });
  }

  const effectiveCount = Number.isInteger(count) ? count : 5;
  if (effectiveCount < 1 || effectiveCount > 10) {
    return res.status(400).json({ error: 'count must be an integer between 1 and 10' });
  }

  try {
    const upstreamRes = await fetch(`${ML_BASE}/predict_queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed_track_ids: seedTrackIds,
        target_energy: targetEnergy,
        count: effectiveCount,
        session_history: Array.isArray(sessionHistory) ? sessionHistory : [],
      }),
    });

    const body = await upstreamRes.json().catch(() => null);

    if (!upstreamRes.ok) {
      if (upstreamRes.status >= 400 && upstreamRes.status < 500) {
        return res.status(upstreamRes.status).json(body || { error: 'Upstream client error' });
      }
      return res.status(502).json({ error: 'ML service error', detail: body });
    }

    return res.json(body);
  } catch (error) {
    console.error('[Queue Preview] Error communicating with ML service:', error.message);
    return res.status(502).json({ error: 'ML service unreachable', detail: error.message });
  }
});

router.post('/queue-commit', async (req, res) => {
  const {
    access_token: accessToken,
    device_id: deviceId,
    session_id: clientSessionId,
    target_energy: targetEnergy,
    tracks,
  } = req.body;

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'tracks must be a non-empty array' });
  }

  if (!Number.isFinite(targetEnergy) || targetEnergy < 0 || targetEnergy > 1) {
    return res.status(400).json({ error: 'target_energy must be a number between 0 and 1' });
  }

  const sessionId = clientSessionId || randomUUID();
  const queued = [];
  const failed = [];

  const deviceQuery = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : '';

  for (const track of tracks) {
    const trackId = track?.track_id;
    if (!trackId) {
      failed.push({ track_id: null, error: 'Missing track_id' });
      continue;
    }

    try {
      await spotifyFetch(
        `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${trackId}`)}${deviceQuery}`,
        accessToken,
        { method: 'POST' },
      );
      queued.push(trackId);
    } catch (error) {
      console.warn(`[Queue Commit] Failed to queue track ${trackId}:`, error.message);
      failed.push({ track_id: trackId, error: error.message });
      if (error.message.includes('404')) {
        break;
      }
    }
  }

  if (queued.length > 0) {
    try {
      const userProfile = await spotifyFetch('/me', accessToken);
      const queuedSet = new Set(queued);
      const successfulTracks = tracks.filter((t) => queuedSet.has(t.track_id));

      for (const track of successfulTracks) {
        await db.query(
          `INSERT INTO prediction_history
            (session_id, user_spotify_id, target_energy, predicted_vector, recommended_track_id, seq_len)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sessionId,
            userProfile.id,
            targetEnergy,
            JSON.stringify(track.predicted_vector || []),
            track.track_id,
            5,
          ],
        );
      }
    } catch (dbError) {
      console.error('[Queue Commit] Error recording prediction_history:', dbError.message);
    }
  }

  return res.json({
    success: true,
    session_id: sessionId,
    queued,
    failed,
  });
});

router.get('/search-seeds', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : 'random';
    const data = await mlFetch('/search_tracks?q=' + encodeURIComponent(q || 'random') + '&limit=10');
    return res.json({ tracks: Array.isArray(data?.tracks) ? data.tracks : [] });
  } catch (error) {
    console.warn('[Search Seeds] mlFetch search failed, falling back to DB:', error.message);
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const isRandom = !q || q.toLowerCase() === 'random';
      const { rows } = isRandom
        ? await db.query(
            `SELECT id AS track_id, track_name, artists AS artist_name, energy, valence, tempo
             FROM track_features
             ORDER BY RANDOM()
             LIMIT 10`,
          )
        : await db.query(
            `SELECT id AS track_id, track_name, artists AS artist_name, energy, valence, tempo
             FROM track_features
             WHERE track_name ILIKE $1 OR artists ILIKE $1 OR id ILIKE $1
             ORDER BY track_name
             LIMIT 10`,
            [`%${q}%`],
          );
      return res.json({
        tracks: rows.map((row) => ({
          ...row,
          track_name: row.track_name || `Track ${String(row.track_id).slice(0, 8)}`,
          artist_name: row.artist_name || 'Unknown Artist',
          energy: Number(row.energy),
          valence: Number(row.valence),
          tempo: Number(row.tempo),
        })),
      });
    } catch (dbErr) {
      console.error('[Search Seeds] Database fallback failed:', dbErr.message);
      return res.status(502).json({ error: 'Failed to search tracks', detail: dbErr.message });
    }
  }
});

router.post('/recently-played', async (req, res) => {
  const accessToken = req.body?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    return res.status(400).json({ error: 'Missing access_token' });
  }

  try {
    const data = await spotifyFetch('/me/player/recently-played?limit=1', accessToken);
    const latest = data?.items?.[0];
    return res.json({
      track: latest?.track?.type === 'track' ? latest.track : null,
      played_at: latest?.played_at ?? null,
    });
  } catch (error) {
    console.error('[Recently Played] Spotify request failed:', error.message);
    return res.status(502).json({
      error: 'Failed to fetch the most recently played track',
      detail: error.message,
    });
  }
});

router.put('/play', async (req, res) => {
  const { access_token: accessToken, device_id: deviceId, uris } = req.body;
  if (!accessToken || !deviceId) {
    return res.status(400).json({ error: 'Missing access_token or device_id' });
  }

  try {
    await spotifyFetch('/me/player', accessToken, {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
    if (Array.isArray(uris) && uris.length > 0) {
      await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, accessToken, {
        method: 'PUT',
        body: JSON.stringify({ uris }),
      });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[Play] Error:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

export default router;
