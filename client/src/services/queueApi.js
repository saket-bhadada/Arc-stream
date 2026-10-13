const NODE_BASE = import.meta.env.VITE_NODE_BASE ?? 'http://127.0.0.1:3000';

export class QueueApiError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', status = 500, details = null) {
    super(message);
    this.name = 'QueueApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function fetchQueuePreview({
  seedTrackIds,
  targetEnergy,
  count = 5,
  sessionHistory = [],
  signal,
}) {
  const response = await fetch(`${NODE_BASE}/api/ai/queue-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seed_track_ids: seedTrackIds,
      target_energy: targetEnergy,
      count,
      session_history: sessionHistory,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const code =
      errorBody?.detail?.code
      || errorBody?.code
      || (response.status === 422 ? 'NO_MAPPED_SEEDS' : `HTTP_${response.status}`);
    const message =
      errorBody?.detail?.message
      || errorBody?.message
      || errorBody?.error
      || `Queue preview request failed with status ${response.status}`;

    throw new QueueApiError(message, code, response.status, errorBody);
  }

  return response.json();
}

export async function commitQueue({
  accessToken,
  deviceId,
  sessionId,
  targetEnergy,
  tracks,
  signal,
}) {
  const response = await fetch(`${NODE_BASE}/api/ai/queue-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      device_id: deviceId,
      session_id: sessionId,
      target_energy: targetEnergy,
      tracks,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const code = errorBody?.code || `HTTP_${response.status}`;
    const message = errorBody?.error || errorBody?.message || `Queue commit failed with status ${response.status}`;
    throw new QueueApiError(message, code, response.status, errorBody);
  }

  return response.json();
}
