// client/src/components/PlaylistGenerator.jsx
import { useMemo, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';

const NODE_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const previewCurve = (startEnergy, targetEnergy, curveType, points = 24) => {
  const out = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    let v;
    if (curveType === 'linear') {
      v = startEnergy + (targetEnergy - startEnergy) * t;
    } else if (curveType === 'arc') {
      const peak = 0.65;
      if (t <= peak) {
        const localT = t / peak;
        const eased = localT * localT * (3 - 2 * localT);
        v = startEnergy + (targetEnergy - startEnergy) * eased;
      } else {
        const finish = startEnergy + (targetEnergy - startEnergy) * 0.5;
        const localT = (t - peak) / (1 - peak);
        const eased = localT * localT * (3 - 2 * localT);
        v = targetEnergy + (finish - targetEnergy) * eased;
      }
    } else {
      const center = (startEnergy + targetEnergy) / 2;
      const amplitude = Math.abs(targetEnergy - startEnergy) / 2;
      v = center + amplitude * Math.sin(2 * Math.PI * 2 * t - Math.PI / 2);
    }
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
};

const CURVE_TYPES = [
  {
    id: 'linear',
    label: 'Linear',
    glyph: (color) => (
      <svg viewBox="0 0 32 20" width="32" height="20">
        <path d="M3 17 L29 3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'arc',
    label: 'Arc',
    glyph: (color) => (
      <svg viewBox="0 0 32 20" width="32" height="20">
        <path d="M3 17 Q 18 -2 29 12" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'wave',
    label: 'Wave',
    glyph: (color) => (
      <svg viewBox="0 0 32 20" width="32" height="20">
        <path d="M2 10 Q 8 1 14 10 T 26 10 T 30 10" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];

const TRACK_COUNT_PRESETS = [5, 10, 15, 20];

const CurvePreview = ({ startEnergy, targetEnergy, curveType }) => {
  const points = useMemo(
    () => previewCurve(startEnergy, targetEnergy, curveType),
    [startEnergy, targetEnergy, curveType]
  );

  const width = 100;
  const height = 100;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - v * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={s.previewSvg}
    >
      {[0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={0} x2={width}
          y1={height * frac} y2={height * frac}
          stroke="#1a1a2e" strokeWidth="1"
        />
      ))}
      <path d={path} fill="none" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const PlaylistGenerator = ({ onClose }) => {
  const { accessToken, sessionHistory } = usePlayerStore();

  const [startEnergy, setStartEnergy]   = useState(0.3);
  const [targetEnergy, setTargetEnergy] = useState(0.8);
  const [trackCount, setTrackCount]     = useState(10);
  const [customCount, setCustomCount]   = useState('');
  const [curveType, setCurveType]       = useState('linear');

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);

  const effectiveTrackCount = customCount ? parseInt(customCount, 10) : trackCount;

  const handleTrackCountPreset = (count) => {
    setTrackCount(count);
    setCustomCount('');
  };

  const handleCustomCountChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setCustomCount(raw);
  };

  const handleGenerate = async () => {
    if (!accessToken) {
      setStatus('error');
      setErrorMsg('Not connected to Spotify — log in again.');
      return;
    }
    if (!effectiveTrackCount || effectiveTrackCount < 3 || effectiveTrackCount > 30) {
      setStatus('error');
      setErrorMsg('Track count must be between 3 and 30.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const n = effectiveTrackCount;
      const energyCurve = previewCurve(startEnergy, targetEnergy, curveType, n)
        .map((v) => Number(v.toFixed(4)));

      const res = await fetch(`${NODE_BASE}/api/ai/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          access_token:    accessToken,
          energy_curve:    energyCurve,
          session_history: sessionHistory.slice(-5),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Playlist generation failed');

      setResult({ ...data, spotify_url: data.playlist_url });
      setStatus('success');
    } catch (err) {
      console.error('[PlaylistGenerator] Export failed:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Something went wrong — try again.');
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>

        <div style={s.header}>
          <span style={s.title}>Generate energy playlist</span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {status === 'success' && result ? (
          <div style={s.successWrap}>
            <div style={s.successIcon}>✓</div>
            <p style={s.successTitle}>Playlist exported to Spotify</p>
            <p style={s.successHint}>{result.tracks.length} tracks, {curveType} curve</p>

            {result.spotify_url && (
              <a href={result.spotify_url} target="_blank" rel="noreferrer" style={s.spotifyLink}>
                Open in Spotify
              </a>
            )}

            <div style={s.trackPreviewList}>
              {result.tracks.map((t) => (
                <div key={`${t.track_id}-${t.position}`} style={s.trackRow}>
                  <span style={s.trackPos}>{t.position + 1}</span>
                  <span style={s.trackName}>{t.track_name || t.track_id}</span>
                  <span style={s.trackEnergy}>
                    {t.target_energy?.toFixed(2)}
                    {typeof t.actual_energy === 'number' && (
                      <span style={s.trackActualEnergy}> · {t.actual_energy.toFixed(2)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <button style={s.doneBtn} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <CurvePreview startEnergy={startEnergy} targetEnergy={targetEnergy} curveType={curveType} />

            <div style={s.sliderBlock}>
              <div style={s.sliderHeader}>
                <span style={s.sliderLabel}>Start energy</span>
                <span style={s.sliderValue}>{startEnergy.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={startEnergy}
                onChange={(e) => setStartEnergy(parseFloat(e.target.value))}
                style={s.slider}
              />
            </div>

            <div style={s.sliderBlock}>
              <div style={s.sliderHeader}>
                <span style={s.sliderLabel}>Peak / target energy</span>
                <span style={s.sliderValue}>{targetEnergy.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={targetEnergy}
                onChange={(e) => setTargetEnergy(parseFloat(e.target.value))}
                style={s.slider}
              />
            </div>

            <div style={s.block}>
              <span style={s.blockLabel}>Curve shape</span>
              <div style={s.curveToggleRow}>
                {CURVE_TYPES.map((c) => {
                  const active = curveType === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCurveType(c.id)}
                      style={{ ...s.curveToggle, ...(active ? s.curveToggleActive : {}) }}
                    >
                      {c.glyph(active ? '#000' : '#9ca3af')}
                      <span style={{ color: active ? '#000' : '#9ca3af' }}>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={s.block}>
              <span style={s.blockLabel}>Track count</span>
              <div style={s.countRow}>
                {TRACK_COUNT_PRESETS.map((count) => {
                  const active = !customCount && trackCount === count;
                  return (
                    <button
                      key={count}
                      onClick={() => handleTrackCountPreset(count)}
                      style={{ ...s.countPill, ...(active ? s.countPillActive : {}) }}
                    >
                      {count}
                    </button>
                  );
                })}
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Custom"
                  value={customCount}
                  onChange={handleCustomCountChange}
                  style={s.customCountInput}
                />
              </div>
            </div>

            {status === 'error' && (
              <p style={s.errorText}>{errorMsg}</p>
            )}

            <button
              style={{ ...s.generateBtn, ...(status === 'loading' ? s.generateBtnLoading : {}) }}
              onClick={handleGenerate}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Generating…' : 'Generate & export to Spotify'}
            </button>
          </>
        )}

      </div>
    </div>
  );
};

const s = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20, boxSizing: 'border-box',
  },
  modal: {
    width: '100%', maxWidth: 440,
    backgroundColor: '#111118', border: '1px solid #1a1a2e',
    borderRadius: 20, padding: '28px 28px 24px',
    boxSizing: 'border-box', maxHeight: '88vh', overflowY: 'auto',
    color: '#f3f4f6',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: { fontSize: 17, fontWeight: 700, color: '#f3f4f6' },
  closeBtn: {
    background: 'none', border: 'none', color: '#6b7280',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4,
  },
  previewSvg: {
    width: '100%', height: 110,
    backgroundColor: '#090910', borderRadius: 12,
    border: '1px solid #1a1a2e', marginBottom: 24,
  },
  sliderBlock: { marginBottom: 20 },
  sliderHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabel: { fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', color: '#9ca3af' },
  sliderValue: { fontSize: 13, fontWeight: 700, color: '#1DB954', fontFamily: 'monospace' },
  slider: { width: '100%', accentColor: '#1DB954', cursor: 'pointer', height: 4 },
  block: { marginBottom: 22 },
  blockLabel: {
    display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px',
    color: '#9ca3af', marginBottom: 10,
  },
  curveToggleRow: { display: 'flex', gap: 8 },
  curveToggle: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '10px 8px', borderRadius: 12,
    border: '1px solid #1a1a2e', backgroundColor: '#090910',
    cursor: 'pointer', fontSize: 11, fontWeight: 700,
  },
  curveToggleActive: {
    backgroundColor: '#1DB954', borderColor: '#1DB954',
  },
  countRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  countPill: {
    padding: '8px 16px', borderRadius: 20,
    border: '1px solid #1a1a2e', backgroundColor: '#090910',
    color: '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  countPillActive: {
    backgroundColor: '#1DB954', borderColor: '#1DB954', color: '#000',
  },
  customCountInput: {
    width: 72, padding: '8px 10px', borderRadius: 20,
    border: '1px solid #1a1a2e', backgroundColor: '#090910',
    color: '#f3f4f6', fontSize: 13, textAlign: 'center',
    outline: 'none',
  },
  errorText: {
    color: '#f87171', fontSize: 13, margin: '0 0 14px', lineHeight: 1.5,
  },
  generateBtn: {
    width: '100%', backgroundColor: '#1DB954', color: '#000',
    border: 'none', padding: '14px 0', borderRadius: 50,
    fontSize: 14, fontWeight: 800, letterSpacing: '0.5px', cursor: 'pointer',
  },
  generateBtnLoading: {
    backgroundColor: '#12833c', cursor: 'default',
  },
  successWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    textAlign: 'center', paddingTop: 4,
  },
  successIcon: {
    width: 48, height: 48, borderRadius: '50%', backgroundColor: '#1DB954',
    color: '#000', fontSize: 24, fontWeight: 800,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  successTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#f3f4f6' },
  successHint: { margin: '0 0 14px', fontSize: 13, color: '#6b7280' },
  spotifyLink: {
    display: 'inline-block', marginBottom: 20,
    backgroundColor: 'transparent', color: '#1DB954',
    border: '1px solid #1DB954', borderRadius: 50,
    padding: '10px 24px', fontSize: 13, fontWeight: 700,
    textDecoration: 'none',
  },
  trackPreviewList: {
    width: '100%', display: 'flex', flexDirection: 'column', gap: 2,
    maxHeight: 220, overflowY: 'auto', marginBottom: 20,
    border: '1px solid #1a1a2e', borderRadius: 12, padding: 6,
    boxSizing: 'border-box',
  },
  trackRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', borderRadius: 8, textAlign: 'left',
  },
  trackPos: { fontSize: 11, color: '#374151', fontFamily: 'monospace', width: 18 },
  trackName: {
    flex: 1, fontSize: 13, color: '#f3f4f6',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  trackEnergy: { fontSize: 11, fontFamily: 'monospace', color: '#1DB954' },
  trackActualEnergy: { color: '#6b7280' },
  doneBtn: {
    width: '100%', backgroundColor: 'transparent', color: '#9ca3af',
    border: '1px solid #2a2a3a', padding: '12px 0', borderRadius: 50,
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
};

export default PlaylistGenerator;