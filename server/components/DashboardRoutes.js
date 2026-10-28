import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { Router } from 'express';

import db from '../db.js';
import spotifyApi from '../spotifyservice.js';

dotenv.config();

const router = Router();
const ML_BASE = process.env.ML_SERVICE_URL || process.env.ML_BASE || 'http://localhost:8000';
const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const REFRESH_COOKIE_NAME = 'arc_stream_token';
const REFRESH_COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

const cookieOption = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: REFRESH_COOKIE_MAX_AGE,
  path: '/',
});

const parseVectorString = (raw) => {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw !== 'string') return null;
  const values = raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((v) => Number.parseFloat(v.trim()))
    .filter(Number.isFinite);
  return values.length === 7 ? values : null;
};

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
    const errorText = await response.text();
    const error = new Error(`Spotify ${response.status} on ${path}: ${errorText}`);
    error.status = response.status;
    error.body = errorText;
    throw error;
  }
  return response.json();
};

const refreshSpotifyAccessToken = async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!refreshToken) return null;
  try {
    spotifyApi.setRefreshToken(refreshToken);
    const data = await spotifyApi.refreshAccessToken();
    const { access_token: accessToken, refresh_token: rotated } = data.body || {};
    if (accessToken && res && !res.headersSent) {
      res.cookie(REFRESH_COOKIE_NAME, rotated || refreshToken, cookieOption());
    }
    return accessToken || null;
  } catch (error) {
    console.warn('[Spotify Auth] Refresh token grant failed:', error.message);
    return null;
  }
};

const spotifyFetchWithRefresh = async (req, res, tokenState, path, options = {}) => {
  if (!tokenState.accessToken) {
    const refreshed = await refreshSpotifyAccessToken(req, res);
    if (refreshed) {
      tokenState.accessToken = refreshed;
      tokenState.refreshed = true;
    }
  }
  if (!tokenState.accessToken) {
    const err = new Error('Missing Spotify access token. Please log in with Spotify.');
    err.status = 401;
    throw err;
  }

  try {
    return await spotifyFetch(path, tokenState.accessToken, options);
  } catch (error) {
    if (error.status === 401) {
      const refreshed = await refreshSpotifyAccessToken(req, res);
      if (refreshed) {
        tokenState.accessToken = refreshed;
        tokenState.refreshed = true;
        return spotifyFetch(path, tokenState.accessToken, options);
      }
    }
    throw error;
  }
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

router.post('/track-vectors', async (req, res) => {
  const trackIds = Array.isArray(req.body?.track_ids)
    ? req.body.track_ids.filter((id) => typeof id === 'string' && id.trim())
    : [];

  if (trackIds.length === 0) {
    return res.json({ vectors: {} });
  }

  try {
    const { rows } = await db.query(
      `SELECT id AS track_id, z_vector::text AS z_vector
       FROM track_features
       WHERE id = ANY($1::text[])`,
      [trackIds],
    );
    const vectors = {};
    for (const id of trackIds) vectors[id] = null;
    for (const row of rows) {
      vectors[row.track_id] = parseVectorString(row.z_vector);
    }
    return res.json({ vectors });
  } catch (error) {
    console.error('[Track vectors] Error:', error.message);
    return res.status(502).json({ error: 'Failed to fetch track vectors', detail: error.message });
  }
});

router.post('/buffer', async (req, res) => {
  const {
    access_token: accessToken,
    target_energy: targetEnergy,
    session_history: sessionHistory = [],
    current_z_sequence: currentZSequence,
  } = req.body;

  const tokenState = { accessToken, refreshed: false };
  if (!tokenState.accessToken) {
    const refreshed = await refreshSpotifyAccessToken(req, res);
    if (refreshed) {
      tokenState.accessToken = refreshed;
      tokenState.refreshed = true;
    }
  }

  if (!tokenState.accessToken) {
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
      await spotifyFetchWithRefresh(
        req,
        res,
        tokenState,
        `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${track.track_id}`)}`,
        { method: 'POST' },
      );
    }

    const userProfile = await spotifyFetchWithRefresh(req, res, tokenState, '/me');
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

    res.json({
      success: true,
      session_id: sessionId,
      tracks,
      access_token: tokenState.refreshed ? tokenState.accessToken : undefined,
    });
  } catch (error) {
    console.error('[Buffer] Error:', error.message);
    res.status(502).json({ error: error.message });
  }
});

const extractTrackId = (track) => {
  const raw = track?.track_id || track?.id || track?.uri;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('spotify:track:')) {
    return trimmed.slice('spotify:track:'.length);
  }
  const match = trimmed.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (match) return match[1];
  return trimmed;
};

const exportTracksToSpotify = async (req, res, {
  accessToken,
  tracks,
  playlistName,
  resolvedCurve = [],
}) => {
  const tokenState = { accessToken, refreshed: false };
  const cleanTrackIds = tracks.map(extractTrackId).filter(Boolean);
  if (cleanTrackIds.length === 0) {
    throw new Error('No valid Spotify track IDs found in generated playlist.');
  }

  const name = (playlistName && String(playlistName).trim())
    || `Arc-Stream Mix ${new Date().toLocaleDateString('en-US')}`;
  const curveSummary = Array.isArray(resolvedCurve) && resolvedCurve.length > 0
    ? ` Energy curve: [${resolvedCurve.map((v) => Number(v).toFixed(2)).join(', ')}]`
    : '';
  const description = `Generated by Arc-Stream AI LSTM.${curveSummary}`.slice(0, 300);

  let userProfile = null;
  try {
    userProfile = await spotifyFetchWithRefresh(req, res, tokenState, '/me');
  } catch (profileErr) {
    console.warn('[Playlist Export] Could not read /me profile, continuing with /me/playlists:', profileErr.message);
  }

  const createEndpoints = [];
  if (userProfile?.id) {
    createEndpoints.push({
      path: `/users/${encodeURIComponent(userProfile.id)}/playlists`,
      body: { name, description, public: false },
    });
  }
  createEndpoints.push({
    path: '/me/playlists',
    body: { name, description, public: false },
  });
  if (userProfile?.id) {
    createEndpoints.push({
      path: `/users/${encodeURIComponent(userProfile.id)}/playlists`,
      body: { name, description, public: true },
    });
  }
  createEndpoints.push({
    path: '/me/playlists',
    body: { name, description, public: true },
  });

  let newPlaylist = null;
  let lastCreateError = null;
  for (const candidate of createEndpoints) {
    try {
      newPlaylist = await spotifyFetchWithRefresh(req, res, tokenState, candidate.path, {
        method: 'POST',
        body: JSON.stringify(candidate.body),
      });
      if (newPlaylist?.id) break;
    } catch (err) {
      lastCreateError = err;
      console.warn(`[Playlist Export] Create attempt on ${candidate.path} (public=${candidate.body.public}) failed:`, err.message);
    }
  }

  if (!newPlaylist?.id) {
    throw lastCreateError || new Error('Spotify did not return a created playlist ID.');
  }

  const uris = cleanTrackIds.map((id) => `spotify:track:${id}`);
  for (let index = 0; index < uris.length; index += 100) {
    const chunk = uris.slice(index, index + 100);
    const playlistIdEncoded = encodeURIComponent(newPlaylist.id);
    try {
      await spotifyFetchWithRefresh(req, res, tokenState, `/playlists/${playlistIdEncoded}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ uris: chunk }),
      });
    } catch (tracksErr) {
      console.warn('[Playlist Export] /tracks endpoint failed, trying /items fallback:', tracksErr.message);
      await spotifyFetchWithRefresh(req, res, tokenState, `/playlists/${playlistIdEncoded}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: chunk }),
      });
    }
  }

  try {
    const userSpotifyId = userProfile?.id || newPlaylist.owner?.id || 'spotify_user';
    const { rows } = await db.query(
      `INSERT INTO playlists
         (user_spotify_id, spotify_playlist_id, name, energy_curve, track_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (spotify_playlist_id) DO UPDATE
         SET name = EXCLUDED.name,
             energy_curve = EXCLUDED.energy_curve,
             track_count = EXCLUDED.track_count
       RETURNING id`,
      [userSpotifyId, newPlaylist.id, name, JSON.stringify(resolvedCurve), cleanTrackIds.length],
    );
    const dbPlaylistId = rows[0]?.id;
    if (dbPlaylistId) {
      for (const [position, trackId] of cleanTrackIds.entries()) {
        await db.query(
          `INSERT INTO playlist_tracks (playlist_id, track_id, position)
           VALUES ($1, $2, $3)
           ON CONFLICT (playlist_id, position) DO UPDATE SET track_id = EXCLUDED.track_id`,
          [dbPlaylistId, trackId, position],
        );
      }
    }
  } catch (dbErr) {
    console.warn('[Playlist Export] Non-fatal DB save warning:', dbErr.message);
  }

  const playlistUrl = newPlaylist.external_urls?.spotify || `https://open.spotify.com/playlist/${newPlaylist.id}`;
  return {
    exported: true,
    playlist_id: newPlaylist.id,
    playlist_url: playlistUrl,
    spotify_url: playlistUrl,
    playlist_uri: newPlaylist.uri || `spotify:playlist:${newPlaylist.id}`,
    name,
    access_token: tokenState.refreshed ? tokenState.accessToken : undefined,
  };
};

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
      tracks: preGeneratedTracks,
      playlist: preGeneratedPlaylist,
    } = req.body || {};

    const resolvedCurve =
      Array.isArray(customEnergyCurve) && customEnergyCurve.length
        ? customEnergyCurve
        : Array.isArray(energyCurve) && energyCurve.length
          ? energyCurve
          : [0.3, 0.45, 0.6, 0.75, 0.85, 0.9, 0.8, 0.65, 0.5, 0.4];

    const existingTracks = Array.isArray(preGeneratedTracks) && preGeneratedTracks.length > 0
      ? preGeneratedTracks
      : Array.isArray(preGeneratedPlaylist) && preGeneratedPlaylist.length > 0
        ? preGeneratedPlaylist
        : null;

    let tracks = existingTracks;
    let finalCurve = resolvedCurve;

    if (!tracks || !exportToSpotify) {
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

      tracks = mlData.playlist || mlData.tracks || [];
      finalCurve = mlData.energy_curve || resolvedCurve;
    }

    if (!exportToSpotify) {
      return res.status(200).json({
        success: true,
        preview: true,
        track_count: tracks.length,
        tracks,
        playlist: tracks,
        energy_curve: finalCurve,
      });
    }

    const name = playlistName || `Arc-Stream Mix ${new Date().toLocaleDateString('en-US')}`;

    try {
      const exportResult = await exportTracksToSpotify(req, res, {
        accessToken,
        tracks,
        playlistName: name,
        resolvedCurve: finalCurve,
      });

      return res.status(200).json({
        success: true,
        ...exportResult,
        track_count: tracks.length,
        tracks,
        playlist: tracks,
        energy_curve: finalCurve,
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
        playlist: tracks,
        energy_curve: finalCurve,
      });
    }
  } catch (error) {
    console.error('[Playlist] Error:', error.message);
    return res.status(502).json({ error: error.message });
  }
};

const exportPlaylist = async (req, res) => {
  const {
    access_token: accessToken,
    playlist_name: playlistName,
    energy_curve: energyCurve = [],
  } = req.body || {};
  const tracks = Array.isArray(req.body?.tracks)
    ? req.body.tracks
    : Array.isArray(req.body?.playlist)
      ? req.body.playlist
      : [];

  if (!Array.isArray(tracks) || tracks.length === 0 || tracks.some((track) => !extractTrackId(track))) {
    return res.status(400).json({ error: 'tracks must be a non-empty array of tracks with track_id values' });
  }

  try {
    const exportResult = await exportTracksToSpotify(req, res, {
      accessToken,
      tracks,
      playlistName,
      resolvedCurve: energyCurve,
    });

    return res.json({
      success: true,
      ...exportResult,
      track_count: tracks.length,
      tracks,
      playlist: tracks,
    });
  } catch (error) {
    console.error('[Export Playlist] Error:', error.message);
    return res.status(error.status === 401 ? 401 : 502).json({
      error: 'Failed to export playlist to Spotify',
      detail: error.message,
    });
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

  const tokenState = { accessToken, refreshed: false };
  if (!tokenState.accessToken) {
    const refreshed = await refreshSpotifyAccessToken(req, res);
    if (refreshed) {
      tokenState.accessToken = refreshed;
      tokenState.refreshed = true;
    }
  }

  if (!tokenState.accessToken) {
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
    const trackId = extractTrackId(track);
    if (!trackId) {
      failed.push({ track_id: null, error: 'Missing track_id' });
      continue;
    }

    try {
      await spotifyFetchWithRefresh(
        req,
        res,
        tokenState,
        `/me/player/queue?uri=${encodeURIComponent(`spotify:track:${trackId}`)}${deviceQuery}`,
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
      const userProfile = await spotifyFetchWithRefresh(req, res, tokenState, '/me');
      const queuedSet = new Set(queued);
      const successfulTracks = tracks.filter((t) => queuedSet.has(extractTrackId(t)));

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
            extractTrackId(track),
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
    access_token: tokenState.refreshed ? tokenState.accessToken : undefined,
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
  const tokenState = { accessToken, refreshed: false };

  try {
    const data = await spotifyFetchWithRefresh(
      req,
      res,
      tokenState,
      '/me/player/recently-played?limit=1',
    );
    const latest = data?.items?.[0];
    return res.json({
      track: latest?.track?.type === 'track' ? latest.track : null,
      played_at: latest?.played_at ?? null,
      access_token: tokenState.refreshed ? tokenState.accessToken : undefined,
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
  const tokenState = { accessToken, refreshed: false };
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing device_id' });
  }

  try {
    await spotifyFetchWithRefresh(req, res, tokenState, '/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
    if (Array.isArray(uris) && uris.length > 0) {
      await spotifyFetchWithRefresh(
        req,
        res,
        tokenState,
        `/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ uris }),
        },
      );
    }
    return res.json({
      success: true,
      access_token: tokenState.refreshed ? tokenState.accessToken : undefined,
    });
  } catch (error) {
    console.error('[Play] Error:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

export default router;
