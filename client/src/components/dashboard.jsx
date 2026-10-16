// client/src/components/dashboard.jsx
import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { NODE_BASE, fetchTrackVectors, requestBuffer } from '../services/arcApi';
import VectorRadarChart from './VectorRadarChart';
import TrajectoryGraph from './TrajectoryGraph';
import QueueTray from './QueueTray';
import PlaylistGenerator from './PlaylistGenerator'; // Phase 8

const SPOTIFY_BASE = 'https://api.spotify.com/v1';

// LSTM was trained on 5-step windows, so inference uses the last 5 tracks.
const SEQ_LEN = 5;
const MIN_SEQ_LEN = 5;                  // server accepts 5–9
const AUTO_DJ_THRESHOLD_MS = 25_000;
const AUTO_DJ_TICK_MS = 1000;


// ── Cookie-driven refresh helper ────────────────────────────────────────────
const refreshAccessToken = async () => {
  const res = await fetch(`${NODE_BASE}/refresh`, {
    method:      'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json();
};

const logoutRequest = async () => {
  await fetch(`${NODE_BASE}/logout`, {
    method:      'POST',
    credentials: 'include',
  });
};


// ── Spotify service functions ────────────────────────────────────────────────
const transferPlayback = async (deviceId, accessToken, play = false) => {
  const res = await fetch(`${SPOTIFY_BASE}/me/player`, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Transfer playback failed: ${res.status}`);
  }
};


// ── useSpotifyPlayer hook ─────────────────────────────────────────────────────
const useSpotifyPlayer = () => {
  const {
    accessToken,
    setPlayer, setDeviceId, setIsActive,
    setCurrentTrack, setIsPlaying, setPosition, setDuration,
    registerPlayedTrack,
  } = usePlayerStore();

  useEffect(() => {
    if (!accessToken) return;

    const initPlayer = () => {
      if (usePlayerStore.getState().player) return;

      const player = new window.Spotify.Player({
        name: 'Arc-Stream',
        getOAuthToken: (cb) => cb(usePlayerStore.getState().accessToken),
        volume: 0.7,
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('[Arc-Stream] Player ready — Device ID:', device_id);
        setDeviceId(device_id);
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.warn('[Arc-Stream] Device offline:', device_id);
        setIsActive(false);
      });

      player.addListener('initialization_error', ({ message }) =>
        console.error('[Arc-Stream] Init error:', message)
      );
      player.addListener('authentication_error', ({ message }) =>
        console.error('[Arc-Stream] Auth error:', message)
      );
      player.addListener('account_error', ({ message }) =>
        console.error('[Arc-Stream] Account error (Premium required):', message)
      );

      player.addListener('player_state_changed', (state) => {
        if (!state) {
          setIsActive(false);
          return;
        }
        setIsActive(true);

        const { current_track } = state.track_window;

        setCurrentTrack(current_track);
        setIsPlaying(!state.paused);
        setPosition(state.position);   // also stamps positionUpdatedAt
        setDuration(state.duration);

        // Idempotent: history + metadata once per track, and drains the
        // upcoming queue when a buffered track starts playing.
        registerPlayedTrack(current_track);
      });

      player.connect().then((success) => {
        if (success) console.log('[Arc-Stream] Connected to Spotify Web Playback SDK.');
      });

      setPlayer(player);
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;

      if (!document.getElementById('spotify-sdk')) {
        const script = document.createElement('script');
        script.id    = 'spotify-sdk';
        script.src   = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    }
  }, [accessToken]);
};


// ── useAutoDJ hook ────────────────────────────────────────────────────────────
// player_state_changed only fires on play/pause/seek/track change, never on a
// timer, so a pure event handler would never see the 25 s mark. The event
// supplies position + duration (stored with a timestamp); this 1 s tick
// extrapolates the live position from it.
//
// Fires onTrigger when: enabled AND playing AND remaining <= 25 s AND the AI
// queue is empty AND this track ID hasn't triggered yet.
const useAutoDJ = (isAutoDJEnabled, onTrigger) => {
  const [remainingMs, setRemainingMs] = useState(null);

  const hasTriggeredForTrack = useRef(null);   // id of the last track that fired
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

  useEffect(() => {
    if (!isAutoDJEnabled) return;

    const tick = () => {
      const st = usePlayerStore.getState();
      const trackId = st.currentTrack?.id;
      if (!trackId || !st.isPlaying || st.duration <= 0) return;

      const position = st.position + (Date.now() - st.positionUpdatedAt);
      const remaining = st.duration - position;
      setRemainingMs(remaining);

      if (remaining > AUTO_DJ_THRESHOLD_MS) return;
      if (st.upcomingQueue.length > 0) return;
      if (hasTriggeredForTrack.current === trackId) return;

      hasTriggeredForTrack.current = trackId;  // once per track, even if the call fails
      onTriggerRef.current();
    };

    const id = setInterval(tick, AUTO_DJ_TICK_MS);
    return () => clearInterval(id);
  }, [isAutoDJEnabled]);

  return isAutoDJEnabled ? remainingMs : null;
};


// ── Small UI pieces ───────────────────────────────────────────────────────────
const fmtTime = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const Switch = ({ checked, onChange, label, hint }) => (
  <div style={s.switchRow}>
    <div>
      <div style={s.switchLabel}>{label}</div>
      {hint && <div style={s.switchHint}>{hint}</div>}
    </div>
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)} style={s.switchTrack(checked)}
    >
      <span style={s.switchKnob} />
    </button>
  </div>
);

const NowPlaying = () => {
  const { currentTrack, isPlaying, player } = usePlayerStore();

  const albumArt   = currentTrack?.album?.images?.[0]?.url;
  const trackName  = currentTrack?.name  ?? 'Nothing Playing';
  const artistName = currentTrack?.artists?.map((a) => a.name).join(', ') ?? '—';

  return (
    <div style={s.card}>
      {albumArt
        ? <img src={albumArt} alt={trackName} style={s.art} />
        : <div style={s.artPlaceholder}>♪</div>
      }
      <div style={s.meta}>
        <p style={s.track}>{trackName}</p>
        <p style={s.artist}>{artistName}</p>
      </div>
      <div style={s.controls}>
        <button style={s.btn}     onClick={() => player?.previousTrack()}>⏮</button>
        <button style={s.playBtn} onClick={() => player?.togglePlay()}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button style={s.btn}     onClick={() => player?.nextTrack()}>⏭</button>
      </div>
    </div>
  );
};

const CURVES = [
  { id: 'linear', label: 'Linear' },
  { id: 'arc',    label: 'Arc' },
  { id: 'wave',   label: 'Wave' },
];

// Drawer: trajectory preview + planner controls, with a hand-off to the Phase 8
// PlaylistGenerator. Once a playlist is generated, generatedTracks overlays the
// actual energies on the planned curve.
const PlannerDrawer = ({ onClose, generatedTracks, onOpenGenerator }) => {
  const [startEnergy,  setStartEnergy]  = useState(0.3);
  const [targetEnergy, setTargetEnergy] = useState(0.8);
  const [trackCount,   setTrackCount]   = useState(10);
  const [curveType,    setCurveType]    = useState('arc');

  const sliders = [
    ['Start energy',  startEnergy,  setStartEnergy,  0, 1,  0.01, (v) => v.toFixed(2)],
    ['Target energy', targetEnergy, setTargetEnergy, 0, 1,  0.01, (v) => v.toFixed(2)],
    ['Tracks',        trackCount,   setTrackCount,   5, 30, 1,    (v) => v],
  ];

  return (
    <>
      <div style={s.overlay} onClick={onClose} />
      <aside style={s.drawer}>
        <div style={s.drawerHead}>
          <span style={s.sectionLabel}>TRAJECTORY PLANNER</span>
          <button style={s.ghostBtn} onClick={onClose}>Close</button>
        </div>

        <TrajectoryGraph
          startEnergy={startEnergy} targetEnergy={targetEnergy}
          trackCount={trackCount}   curveType={curveType}
          generatedTracks={generatedTracks}
        />

        <div style={s.curveRow}>
          {CURVES.map((c) => (
            <button
              key={c.id} type="button" onClick={() => setCurveType(c.id)}
              style={s.pill(curveType === c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {sliders.map(([label, value, setter, min, max, step, fmt]) => (
          <div key={label} style={s.energyWrap}>
            <div style={s.energyHeader}>
              <span style={s.energyLabel}>{label.toUpperCase()}</span>
              <span style={s.energyValue}>{fmt(value)}</span>
            </div>
            <input
              type="range" min={min} max={max} step={step} value={value}
              onChange={(e) => setter(parseFloat(e.target.value))}
              style={s.slider}
            />
          </div>
        ))}

        <button style={s.queueBtn} onClick={onOpenGenerator}>Open playlist generator</button>
      </aside>
    </>
  );
};


// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD PAGE
// ════════════════════════════════════════════════════════════════════════════
const DashboardPage = () => {
  useSpotifyPlayer();

  const {
    deviceId, isActive, accessToken, expiresAt,
    updateAccessToken, clearTokens,
    targetEnergy, setTargetEnergy,
    currentTrack, currentVector, predictedVector,
    upcomingQueue, sessionHistory, trackMeta, setCurrentVector,
  } = usePlayerStore();

  const [isAutoDJEnabled, setIsAutoDJEnabled] = useState(false);
  const [queueStatus, setQueueStatus] = useState({ kind: 'idle', msg: '' });
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatedTracks, setGeneratedTracks] = useState([]);
  const queueInFlightRef = useRef(false);

  // Silent token refresh
  useEffect(() => {
    if (!expiresAt) return;
    const delay = expiresAt - Date.now() - 60_000;
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      try {
        const { access_token, expires_in } = await refreshAccessToken();
        updateAccessToken(access_token, expires_in);
        console.log('[Arc-Stream] Access token silently refreshed.');
      } catch (err) {
        console.error('[Arc-Stream] Silent refresh failed — session likely expired:', err);
        clearTokens();
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [expiresAt]);

  // Resolve the playing track's 7D vector for the radar chart
  const currentTrackId = currentTrack?.id;
  useEffect(() => {
    if (!currentTrackId) return;
    let cancelled = false;
    fetchTrackVectors([currentTrackId])
      .then((map) => { if (!cancelled) setCurrentVector(map[currentTrackId] ?? null); })
      .catch((err) => {
        console.error('[Arc-Stream] Vector lookup failed:', err);
        if (!cancelled) setCurrentVector(null);
      });
    return () => { cancelled = true; };
  }, [currentTrackId]);

  // ── Queue the next AI-predicted track ───────────────────────────────────────
  const handleQueueNextTrack = async () => {
    if (queueInFlightRef.current) return;
    queueInFlightRef.current = true;
    setQueueStatus({ kind: 'loading', msg: 'Asking the LSTM for the next track…' });

    try {
      const st = usePlayerStore.getState();

      const contextIds = st.sessionHistory.slice(-SEQ_LEN);
      if (contextIds.length === 0) {
        throw new Error('Play a track first — the LSTM needs at least one track of context.');
      }

      const vecMap = await fetchTrackVectors(contextIds);
      const zSeq = contextIds.map((id) => vecMap[id]).filter(Boolean);
      if (zSeq.length === 0) {
        throw new Error('None of the recent tracks exist in the catalogue.');
      }
      // Server requires 5–9 vectors: left-pad a short history with its oldest vector.
      while (zSeq.length < MIN_SEQ_LEN) zSeq.unshift(zSeq[0]);

      // Exclude played AND already-buffered tracks so the engine can't re-pick them.
      const exclusions = [...new Set([...st.sessionHistory, ...st.upcomingQueue.map((t) => t.track_id)])];

      const { tracks } = await requestBuffer({
        session_id:         st.sessionId,
        access_token:       usePlayerStore.getState().accessToken, // freshest token
        target_energy:      st.targetEnergy,
        session_history:    exclusions,
        current_z_sequence: zSeq,
      });

      const store = usePlayerStore.getState();
      store.enqueueUpcoming(tracks);
      store.setCurrentZSequence(zSeq);
      store.setPredictedVector(tracks[tracks.length - 1]?.predicted_vector ?? null);

      setQueueStatus({ kind: 'ok', msg: `Queued “${tracks[0]?.track_name ?? 'track'}”` });
    } catch (err) {
      console.error('[Arc-Stream] Queue next failed:', err);
      setQueueStatus({ kind: 'error', msg: err.message });
    } finally {
      queueInFlightRef.current = false;
    }
  };

  const remainingMs = useAutoDJ(isAutoDJEnabled, handleQueueNextTrack);

  const handleActivate = async () => {
    try {
      await transferPlayback(deviceId, accessToken, false);
    } catch (err) {
      console.error('[Arc-Stream] Playback transfer failed:', err);
    }
  };

  const handleLogout = async () => {
    await logoutRequest();
    clearTokens();
    window.location.replace('/');
  };

  const historyTracks = sessionHistory
    .slice().reverse().slice(0, 50)
    .map((id) => ({ id, name: id, artists: '', ...trackMeta[id] }));

  const loading = queueStatus.kind === 'loading';

  return (
    <div style={s.page}>

      {/* 1 ─ Top bar: logo, SDK/active-device status, actions */}
      <header style={s.header}>
        <span style={s.logo}>ARC-STREAM</span>

        <div style={s.statusPill(isActive)}>
          <span style={s.statusDot(isActive)} />
          <span style={s.statusText}>
            {isActive ? 'LIVE · Arc-Stream device active'
              : deviceId ? 'READY · transfer playback to start'
              : 'CONNECTING · initialising Web Playback SDK'}
          </span>
          {deviceId && !isActive && (
            <button style={s.activateBtn} onClick={handleActivate}>⚡ Activate</button>
          )}
        </div>

        <div style={s.headerRight}>
          <button style={s.ghostBtn} onClick={() => setPlannerOpen(true)}>Playlist planner</button>
          <button style={s.ghostBtn} onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main style={s.grid}>

        {/* 2 ─ Left/main pane: artwork, controller, target energy, Auto-DJ */}
        <div style={s.col}>
          <NowPlaying />

          <div style={s.panel}>
            <div style={s.energyWrap}>
              <div style={s.energyHeader}>
                <span style={s.energyLabel}>TARGET ENERGY</span>
                <span style={s.energyValue}>{targetEnergy.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={targetEnergy}
                onChange={(e) => setTargetEnergy(parseFloat(e.target.value))}
                style={s.slider}
              />
              <div style={s.sliderTicks}>
                <span>Chill</span><span>Mid</span><span>Hype</span>
              </div>
            </div>

            <Switch
              checked={isAutoDJEnabled}
              onChange={setIsAutoDJEnabled}
              label="Auto-DJ Continuous Mode"
              hint={remainingMs !== null
                ? `Queues at 0:25 if the AI queue is empty — ${fmtTime(remainingMs)} left`
                : 'Queues the next track when ≤ 25 s remain and the AI queue is empty'}
            />

            <button
              style={{ ...s.queueBtn, opacity: !isActive || loading ? 0.5 : 1 }}
              onClick={handleQueueNextTrack} disabled={!isActive || loading}
            >
              {loading ? 'Predicting…' : 'Queue next track now'}
            </button>

            {queueStatus.msg && <p style={s.status(queueStatus.kind)}>{queueStatus.msg}</p>}
          </div>
        </div>

        {/* 3 ─ Center pane: current track vs predicted ẑ */}
        <div style={s.panel}>
          <span style={s.sectionLabel}>ACOUSTIC VECTOR · 7D</span>
          <VectorRadarChart currentTrackVector={currentVector} predictedVector={predictedVector} />
        </div>

        {/* 4 ─ Right pane: queue tray */}
        <div style={s.panel}>
          <QueueTray
            sessionHistory={historyTracks}
            upcomingQueue={upcomingQueue}
            currentEnergy={currentVector?.[1]}
            currentTrackId={currentTrackId}
          />
        </div>
      </main>

      {/* 5 ─ Modal/drawer: TrajectoryGraph + PlaylistGenerator */}
      {plannerOpen && (
        <PlannerDrawer
          onClose={() => setPlannerOpen(false)}
          generatedTracks={generatedTracks}
          onOpenGenerator={() => setGeneratorOpen(true)}
        />
      )}
      {generatorOpen && (
        <PlaylistGenerator
          accessToken={accessToken}
          onClose={() => setGeneratorOpen(false)}
          onGenerated={(tracks) => setGeneratedTracks(tracks ?? [])}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════════════════════
const GREEN = '#1DB954';
const WHITE = '#FFFFFF';
const MUTED = '#B3B3B3';
const CARD  = '#181818';
const LINE  = '#282828';

const s = {
  page: {
    minHeight: '100vh', backgroundColor: '#121212',
    color: WHITE, display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 12, padding: '16px 24px', borderBottom: `1px solid ${LINE}`,
  },
  logo: { fontSize: 13, fontWeight: 800, letterSpacing: '5px', color: GREEN },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  ghostBtn: {
    background: 'none', border: '1px solid #333', color: MUTED,
    fontSize: 10, fontWeight: 700, letterSpacing: '1px',
    padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
  },
  statusPill: (active) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 14px', background: CARD, borderRadius: 20,
    border: `1px solid ${active ? 'rgba(29,185,84,0.5)' : LINE}`,
  }),
  statusText: { fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: MUTED },
  statusDot: (active) => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    backgroundColor: active ? GREEN : '#535353',
    boxShadow: active ? `0 0 8px ${GREEN}` : 'none',
    transition: 'all 0.4s ease',
  }),
  activateBtn: {
    backgroundColor: GREEN, color: '#000', border: 'none',
    padding: '5px 14px', borderRadius: 50,
    fontSize: 11, fontWeight: 800, letterSpacing: '1px', cursor: 'pointer',
  },

  // auto-fit: three columns when there's room, wraps to fewer on narrow screens
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 20, alignItems: 'start', padding: 24, boxSizing: 'border-box', width: '100%',
  },
  col: { display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 },
  panel: {
    background: CARD, border: `1px solid ${LINE}`, borderRadius: 16,
    padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
    boxSizing: 'border-box', minWidth: 0,
  },
  sectionLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '3px', color: MUTED, textAlign: 'left' },

  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
    padding: '28px 32px', background: CARD,
    borderRadius: 16, border: `1px solid ${LINE}`, boxSizing: 'border-box',
  },
  art: { width: 200, height: 200, borderRadius: 10, objectFit: 'cover', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  artPlaceholder: {
    width: 200, height: 200, borderRadius: 10, background: LINE,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, color: MUTED,
  },
  meta:    { textAlign: 'center', width: '100%' },
  track:   { margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: WHITE },
  artist:  { margin: 0, fontSize: 13, color: MUTED },
  controls:{ display: 'flex', alignItems: 'center', gap: 24 },
  btn: { background: 'none', border: 'none', color: MUTED, fontSize: 22, cursor: 'pointer', padding: 8 },
  playBtn: {
    width: 52, height: 52, borderRadius: '50%', background: GREEN, border: 'none', color: '#000',
    fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 800,
  },

  energyWrap: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10 },
  energyHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  energyLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '3px', color: MUTED },
  energyValue: { fontSize: 13, fontWeight: 700, color: GREEN, fontFamily: 'monospace' },
  slider: { width: '100%', accentColor: GREEN, cursor: 'pointer', height: 4 },
  sliderTicks: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED },

  switchRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, textAlign: 'left' },
  switchLabel: { fontSize: 13, fontWeight: 700, color: WHITE },
  switchHint: { fontSize: 11, color: MUTED, marginTop: 2, fontFamily: 'monospace', lineHeight: 1.5 },
  switchTrack: (on) => ({
    width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2, cursor: 'pointer',
    background: on ? GREEN : '#535353', transition: 'background 0.2s', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
  }),
  switchKnob: { width: 20, height: 20, borderRadius: '50%', background: WHITE, display: 'block' },

  queueBtn: {
    background: 'none', border: `1px solid ${GREEN}`, color: GREEN, borderRadius: 50,
    padding: '10px 20px', fontSize: 12, fontWeight: 800, letterSpacing: '1px', cursor: 'pointer',
  },
  status: (kind) => ({
    margin: 0, fontSize: 12, lineHeight: 1.5, textAlign: 'left',
    color: kind === 'error' ? '#FF6B6B' : kind === 'ok' ? GREEN : MUTED,
  }),

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10 },
  drawer: {
    position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', zIndex: 11,
    background: CARD, borderLeft: `1px solid ${LINE}`, padding: 24, boxSizing: 'border-box',
    overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20,
  },
  drawerHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  curveRow: { display: 'flex', gap: 8, justifyContent: 'center' },
  pill: (on) => ({
    background: on ? GREEN : 'none', color: on ? '#000' : MUTED,
    border: `1px solid ${on ? GREEN : '#333'}`, borderRadius: 20,
    padding: '6px 16px', fontSize: 11, fontWeight: 800, letterSpacing: '1px', cursor: 'pointer',
  }),
};

export default DashboardPage;
