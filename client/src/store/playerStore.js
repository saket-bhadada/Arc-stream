// client/src/store/playerStore.js
import { create } from 'zustand';

const HISTORY_CAP = 200;

export const usePlayerStore = create((set) => ({

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  accessToken:  null,
  expiresAt:    null,

  setTokens: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  updateAccessToken: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  clearTokens: () => set({ accessToken: null, expiresAt: null }),

  // ─── SPOTIFY WEB PLAYBACK SDK ─────────────────────────────────────────────
  player:   null,
  deviceId: null,
  isActive: false,

  setPlayer:   (player)   => set({ player }),
  setDeviceId: (deviceId) => set({ deviceId }),
  setIsActive: (isActive) => set({ isActive }),

  // ─── PLAYBACK STATE ───────────────────────────────────────────────────────
  currentTrack:      null,
  isPlaying:         false,
  position:          0,
  duration:          0,
  positionUpdatedAt: 0,   // Date.now() when `position` was last reported by the SDK

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setIsPlaying:    (isPlaying)    => set({ isPlaying }),
  setPosition:     (position)     => set({ position, positionUpdatedAt: Date.now() }),
  setDuration:     (duration)     => set({ duration }),

  // ─── ARC-STREAM AI STATE ──────────────────────────────────────────────────
  sessionId:        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null,
  sessionHistory:   [],          // track IDs, oldest -> newest (also sent as server-side exclusions)
  trackMeta:        {},          // id -> { name, artists, image }
  currentZSequence: [],
  targetEnergy:     0.5,

  // ─── UP NEXT QUEUE STATE (Phase 8) ────────────────────────────────────────
  upNext:           [],
  analysis:         null,
  upNextStatus:     'idle', // 'idle' | 'loading' | 'ready' | 'unmapped' | 'error'
  upNextError:      null,
  queuedIds:        [],

  setUpNext:        (upNext) => set({ upNext }),
  setAnalysis:      (analysis) => set({ analysis }),
  setUpNextStatus:  (upNextStatus) => set({ upNextStatus }),
  setUpNextError:   (upNextError) => set({ upNextError }),
  setQueuedIds:     (queuedIds) => set({ queuedIds }),
  addQueuedIds:     (ids) => set((state) => ({
    queuedIds: [...state.queuedIds, ...(Array.isArray(ids) ? ids : [ids])],
  })),

  appendDatasetTrack: (trackId, vector) => set((state) => {
    if (state.sessionHistory[state.sessionHistory.length - 1] === trackId) return state;
    return {
      sessionHistory: [...state.sessionHistory, trackId].slice(-HISTORY_CAP),
      currentZSequence: [...state.currentZSequence, vector].slice(-9),
    };
  }),
  setSessionId: (sessionId) => set({ sessionId }),

  // ─── PHASE 9 ──────────────────────────────────────────────────────────────
  upcomingQueue:   [],           // [{ track_id, track_name, artists, predicted_vector, step }]
  stepCounter:     0,
  currentVector:   null,         // 7D normalized features of the playing track
  predictedVector: null,         // latest z-hat returned by the engine

  addToHistory: (trackId) => set((s) =>
    s.sessionHistory[s.sessionHistory.length - 1] === trackId
      ? s
      : { sessionHistory: [...s.sessionHistory, trackId].slice(-HISTORY_CAP) }
  ),

  // Called on every player_state_changed. Idempotent: pause/seek events for the
  // same track change nothing. Also drains the track from the upcoming queue
  // once it actually starts playing.
  registerPlayedTrack: (track) => set((s) => {
    const id = track?.id;
    if (!id) return s;

    const isRepeat  = s.sessionHistory[s.sessionHistory.length - 1] === id;
    const hasMeta   = Boolean(s.trackMeta[id]);
    const wasQueued = s.upcomingQueue.some((t) => t.track_id === id);
    if (isRepeat && hasMeta && !wasQueued) return s;

    return {
      sessionHistory: isRepeat ? s.sessionHistory : [...s.sessionHistory, id].slice(-HISTORY_CAP),
      trackMeta: hasMeta ? s.trackMeta : {
        ...s.trackMeta,
        [id]: {
          name:    track.name,
          artists: track.artists?.map((a) => a.name).join(', ') ?? '',
          image:   track.album?.images?.[0]?.url ?? null,
        },
      },
      upcomingQueue: wasQueued ? s.upcomingQueue.filter((t) => t.track_id !== id) : s.upcomingQueue,
    };
  }),

  enqueueUpcoming: (tracks) => set((s) => ({
    upcomingQueue: [
      ...s.upcomingQueue,
      ...tracks.map((t, i) => ({ ...t, step: s.stepCounter + i + 1 })),
    ],
    stepCounter: s.stepCounter + tracks.length,
  })),

  setCurrentVector:    (currentVector)   => set({ currentVector }),
  setPredictedVector:  (predictedVector) => set({ predictedVector }),
  setCurrentZSequence: (sequence)        => set({ currentZSequence: sequence }),
  setTargetEnergy:     (energy)          => set({ targetEnergy: energy }),

  resetSession: () => set({
    sessionId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null,
    sessionHistory: [],
    trackMeta: {},
    currentZSequence: [],
    upcomingQueue: [],
    stepCounter: 0,
    currentVector: null,
    predictedVector: null,
    upNext: [],
    analysis: null,
    upNextStatus: 'idle',
    upNextError: null,
    queuedIds: [],
  }),
}));
