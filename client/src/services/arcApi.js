// client/src/services/arcApi.js
// API callers for the Node gateway. Node never runs ML; it forwards to FastAPI.

// Single source of truth for the Node base URL. Must be the same host the
// OAuth redirect uses (127.0.0.1) or the httpOnly refresh cookie won't be sent.
export const NODE_BASE = import.meta.env.VITE_NODE_BASE ?? 'http://127.0.0.1:3000';

// trackId -> number[7] | null (null = track not in the catalogue).
const vectorCache = new Map();

export const fetchTrackVectors = async (trackIds) => {
  const unique = [...new Set(trackIds)];
  const missing = unique.filter((id) => !vectorCache.has(id));

  if (missing.length > 0) {
    const res = await fetch(`${NODE_BASE}/api/ai/track-vectors`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_ids: missing }),
    });
    if (!res.ok) throw new Error(`track-vectors failed (${res.status})`);
    const { vectors = {} } = await res.json();
    for (const id of missing) vectorCache.set(id, vectors[id] ?? null);
  }

  return Object.fromEntries(unique.map((id) => [id, vectorCache.get(id)]));
};

export const requestBuffer = async (payload) => {
  const res = await fetch(`${NODE_BASE}/api/ai/buffer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `buffer failed (${res.status})`);
  return data; // { success, tracks: [{ track_id, track_name, artists, predicted_vector }] }
};

export const searchSeedTracks = async (query = 'random', signal) => {
  const res = await fetch(
    `${NODE_BASE}/api/dashboard/search-seeds?q=${encodeURIComponent(query || 'random')}`,
    {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `search-seeds failed (${res.status})`);
  return Array.isArray(data.tracks) ? data.tracks : [];
};

export const requestPlaylist = async (payload) => {
  const res = await fetch(`${NODE_BASE}/api/dashboard/playlist`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail?.message || data.detail || data.error || `playlist failed (${res.status})`);
  return data;
};
