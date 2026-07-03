import { useEffect,useRef } from "react";
import {create} from 'zustand';

export const usePlayerStore = create((set) => ({

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  accessToken:  null,
  refreshToken: null,
  expiresAt:    null,

  setTokens: (accessToken, refreshToken, expiresIn) => set({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  updateAccessToken: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  clearTokens: () => set({ accessToken: null, refreshToken: null, expiresAt: null }),

  // ─── SPOTIFY WEB PLAYBACK SDK ─────────────────────────────────────────────
  player:   null,
  deviceId: null,
  isActive: false,

  setPlayer:   (player)   => set({ player }),
  setDeviceId: (deviceId) => set({ deviceId }),
  setIsActive: (isActive) => set({ isActive }),

  // ─── PLAYBACK STATE ───────────────────────────────────────────────────────
  currentTrack: null,
  isPlaying:    false,
  position:     0,
  duration:     0,

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setIsPlaying:    (isPlaying)    => set({ isPlaying }),
  setPosition:     (position)     => set({ position }),
  setDuration:     (duration)     => set({ duration }),

  // ─── ARC-STREAM AI STATE (written by Phase 4) ─────────────────────────────
  sessionHistory:   [],
  currentZSequence: [],
  targetEnergy:     0.5,

  addToHistory:        (trackId)  => set((s) => ({ sessionHistory: [...s.sessionHistory, trackId] })),
  setCurrentZSequence: (sequence) => set({ currentZSequence: sequence }),
  setTargetEnergy:     (energy)   => set({ targetEnergy: energy }),
  resetSession: () => set({ sessionHistory: [], currentZSequence: [] }),
}));

const NODE_BASE = import.meta.env.VITE_API_URL||'http://localhost:3000';
const SPOTIFY_BASE = 'https://api.spotify.com/v1';

const transferPlayback = async(deviceId,accessToken,play=false)=>{
  const res = await fetch(`${SPOTIFY_BASE}/ME/PLAYER`,{
    method:'PUT',
    headers:{'Authorization':'Bearer '+accessToken,
      'content-type':'application/json',
    },
    body:JSON.stringify({device_ids:[deviceId],play}),
  });
  if(!res.ok&&res.status!==204){
    throw new Error(`Transfer Playback failed:${res.status}`);
  }
};

const refreshToken = async (refreshToken)=>{
  const res = await fetch(`${NODE_BASE}/refresh`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:refreshToken}),
  });
  if(!res.ok) throw new Error('Token refresh failed');
  return res.json();
};

const addToQueue = async (trackUri, accessToken) => {
  const res = await fetch(
    `${SPOTIFY_BASE}/me/player/queue?uri=${encodeURIComponent(trackUri)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Add to queue failed: ${res.status}`);
};

const useSpotifyPlayer = ()=>{
  const scriptInjected = useRef(false);

  const {
    accessToken,
    setPlayer,setDeviceId,setIsActive,
    setCurrentTrack, setIsPlaying,setPosition,setDuration,
    addToHistory,
  } = usePlayerStore();

  useEffect(()=>{
    if(!accessToken||scriptInjected.current) return;
    scriptInjected.current = true;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name:'Arc-Stream',
        getOAuthToken:(callback)=>callback(usePlayerStore.getState().accessToken),
        volume: 0.7,
      });

      player.addListner('ready',({device_id})=>{
        console.log('[Arc-Stream] player ready = device id: '+device_id);
        setDeviceId(device_id);
        setIsActive(true);
      });

      player.addListener('not_ready',({device_id})=>{
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
        console.error('[Arc-Stream] Account error (Spotify Premium required):', message)
      );

      player.addListener('player_state_changed',(state)=>{
        if(!state) return;

        const {current_track,next_track} = state.track_window;

        setCurrentTrack(current_track);
        setIsPlaying(!state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        if(current_track?.id) addToHistory(current_track.id);

        if(next_track.length<2)
          console.log('[Arc-Stream] Queue < 2 — buffer refill trigger ready for Phase 4.');

      });

      player.connect().then((success)=>{
        if(success) console.log('[Arc-Stream] Connected to Spotify Web Playback SDK.');
      });

      setPlayer(player);
    };

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
  },[accessToken]);
};

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
// };


// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD PAGE (the actual page component)
// ════════════════════════════════════════════════════════════════════════════
const DashboardPage = () => {
  useSpotifyPlayer(); // 🔌 boots the SDK once

  const {
    deviceId, isActive,
    accessToken, refreshToken, expiresAt,
    updateAccessToken,
    targetEnergy, setTargetEnergy,
  } = usePlayerStore();

  // Silent token refresh — fires 60 s before expiry
  useEffect(() => {
    if (!expiresAt || !refreshToken) return;
    const delay = expiresAt - Date.now() - 60_000;
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      try {
        const { access_token, expires_in } = await refreshAccessToken(refreshToken);
        updateAccessToken(access_token, expires_in);
        console.log('[Arc-Stream] Access token silently refreshed.');
      } catch (err) {
        console.error('[Arc-Stream] Silent refresh failed:', err);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [expiresAt, refreshToken]);

  const handleActivate = async () => {
    try {
      await transferPlayback(deviceId, accessToken, false);
    } catch (err) {
      console.error('[Arc-Stream] Playback transfer failed:', err);
    }
  };

  return (
    <div style={s.page}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header style={s.header}>
        <span style={s.logo}>ARC-STREAM</span>
        <div style={s.headerRight}>
          <span style={s.statusLabel}>
            {isActive ? 'LIVE' : deviceId ? 'READY' : 'CONNECTING'}
          </span>
          <span style={s.statusDot(isActive)} />
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────── */}
      <main style={s.main}>
        {isActive ? (
          <div style={s.playerView}>

            <NowPlaying />

            {/* Energy target — Phase 4: wires to /api/ai/buffer */}
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
                <span>Chill</span>
                <span>Mid</span>
                <span>Hype</span>
              </div>
              {/* TODO (Phase 4): on slider release, call /api/ai/buffer with new targetEnergy */}
            </div>

            {/* Queue preview placeholder — Phase 4 */}
            <div style={s.queuePlaceholder}>
              <p style={s.queueHint}>
                Queue preview — available in Phase 4 once FastAPI is connected.
              </p>
            </div>

          </div>
        ) : (
          <div style={s.activateWrap}>
            <div style={s.icon}>{deviceId ? '🎛️' : '⏳'}</div>
            <h2 style={s.activateTitle}>
              {deviceId ? 'Player Ready' : 'Connecting to Spotify…'}
            </h2>
            <p style={s.hint}>
              {deviceId
                ? 'Transfer playback to Arc-Stream to take control of your queue.'
                : 'Initialising the Spotify Web Playback SDK in your browser.'}
            </p>
            {deviceId && (
              <button style={s.activateBtn} onClick={handleActivate}>
                ⚡ Activate Arc-Stream Player
              </button>
            )}
          </div>
        )}
      </main>

    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════════════════════
const s = {
  page: {
    minHeight: '100vh', backgroundColor: '#090910',
    color: '#f3f4f6', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 40px', borderBottom: '1px solid #111118',
  },
  logo: { fontSize: 13, fontWeight: 800, letterSpacing: '5px', color: '#1DB954' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  statusLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#6b7280' },
  statusDot: (active) => ({
    width: 8, height: 8, borderRadius: '50%',
    backgroundColor: active ? '#1DB954' : '#374151',
    boxShadow: active ? '0 0 8px #1DB954' : 'none',
    transition: 'all 0.4s ease',
  }),
  main: {
    flex: 1, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    padding: '24px 0',
  },

  // ── Activate state ───────────────────────────────────────────
  activateWrap: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 16,
    textAlign: 'center', maxWidth: 380, padding: '0 24px',
  },
  icon:          { fontSize: 48 },
  activateTitle: { margin: 0, fontSize: 22, fontWeight: 700, color: '#f3f4f6' },
  hint:          { margin: 0, color: '#6b7280', fontSize: 14, lineHeight: 1.7 },
  activateBtn: {
    marginTop: 8, backgroundColor: '#1DB954', color: '#000',
    border: 'none', padding: '14px 36px', borderRadius: 50,
    fontSize: 13, fontWeight: 800, letterSpacing: '1px', cursor: 'pointer',
  },

  // ── Player state ────────────────────────────────────────────
  playerView: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 32,
    padding: '0 24px', width: '100%',
    maxWidth: 420, margin: '0 auto', boxSizing: 'border-box',
  },
  card: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 24,
    padding: '36px 44px', background: '#111118',
    borderRadius: 20, border: '1px solid #1a1a2e',
    width: '100%', boxSizing: 'border-box',
  },
  art: {
    width: 220, height: 220, borderRadius: 12, objectFit: 'cover',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  artPlaceholder: {
    width: 220, height: 220, borderRadius: 12, background: '#1a1a2e',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 56, color: '#374151',
  },
  meta:    { textAlign: 'center', width: '100%' },
  track:   { margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#f3f4f6' },
  artist:  { margin: 0, fontSize: 13, color: '#9ca3af' },
  controls:{ display: 'flex', alignItems: 'center', gap: 24 },
  btn: {
    background: 'none', border: 'none',
    color: '#9ca3af', fontSize: 22, cursor: 'pointer', padding: 8,
  },
  playBtn: {
    width: 52, height: 52, borderRadius: '50%',
    background: '#1DB954', border: 'none', color: '#000',
    fontSize: 20, display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', fontWeight: 800,
  },
  energyWrap: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10 },
  energyHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  energyLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '3px', color: '#6b7280' },
  energyValue: { fontSize: 13, fontWeight: 700, color: '#1DB954', fontFamily: 'monospace' },
  slider: { width: '100%', accentColor: '#1DB954', cursor: 'pointer', height: 4 },
  sliderTicks: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, color: '#374151',
  },
  queuePlaceholder: {
    width: '100%', padding: '20px',
    border: '1px dashed #1a1a2e', borderRadius: 12,
    textAlign: 'center', boxSizing: 'border-box',
  },
  queueHint: { margin: 0, color: '#374151', fontSize: 12, lineHeight: 1.6 },
};

export default DashboardPage;