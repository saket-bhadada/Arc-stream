// client/src/components/PlaylistGenerator.jsx
import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';

const NODE_BASE = import.meta.env.VITE_NODE_BASE ?? 'http://127.0.0.1:3000';
const API_BASE = `${NODE_BASE}/api/dashboard`;

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

const CurvePreview = ({ energyCurve }) => {
  const width = 100;
  const height = 100;
  const path = energyCurve
    .map((v, i) => {
      const x = (i / (energyCurve.length - 1)) * width;
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

const PlaylistGenerator = ({ onClose, onPlayTrack }) => {
  const accessToken = usePlayerStore((state) => state.accessToken);
  const sessionHistory = usePlayerStore((state) => state.sessionHistory);
  const trackMeta = usePlayerStore((state) => state.trackMeta);
  const currentZSequence = usePlayerStore((state) => state.currentZSequence);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSeeds, setSelectedSeeds] = useState([]);
  const [trackCount, setTrackCount] = useState(10);
  const [energyCurve, setEnergyCurve] = useState(() => previewCurve(0.3, 0.8, 'linear', 10));
  const [playlistName, setPlaylistName] = useState('My Custom Energy Arc');
  const [generatedTracks, setGeneratedTracks] = useState([]);
  const [spotifyUrl, setSpotifyUrl] = useState(null);
  const [exportNotice, setExportNotice] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2 || selectedSeeds.length >= 5) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `${NODE_BASE}/api/dashboard/search-seeds?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Search failed (${response.status})`);
        setSearchResults(Array.isArray(data.tracks) ? data.tracks : []);
        setSearchError('');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setSearchError(error.message || 'Could not search tracks.');
          setSearchResults([]);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, selectedSeeds.length]);

  const handleQuickFillSeeds = async () => {
    setSearchError('');
    setErrorMsg('');
    try {
      const recentSeeds = (sessionHistory || [])
        .slice(-5)
        .filter((id) => trackMeta?.[id]?.name)
        .map((id) => ({
          track_id: id,
          track_name: trackMeta[id].name,
          artist_name: trackMeta[id].artists || '',
        }));

      const response = await fetch(`${NODE_BASE}/api/dashboard/search-seeds?q=random`);
      const data = await response.json().catch(() => ({}));
      const sampleTracks = Array.isArray(data.tracks) ? data.tracks : [];

      const merged = [...recentSeeds];
      for (const track of sampleTracks) {
        if (merged.length >= 5) break;
        if (track?.track_id && !merged.some((s) => s.track_id === track.track_id)) {
          merged.push(track);
        }
      }

      if (merged.length > 0) {
        setSelectedSeeds(merged.slice(0, 5));
        setSearchQuery('');
        setSearchResults([]);
      } else {
        setSearchError('Could not load sample seed songs.');
      }
    } catch (err) {
      setSearchError(err.message || 'Could not load sample seed songs.');
    }
  };

  const handleTrackCountChange = (value) => {
    const nextCount = Math.max(5, Math.min(25, Math.floor(Number(value) || 5)));
    setEnergyCurve((previous) => Array.from({ length: nextCount }, (_, index) => {
      const ratio = nextCount === 1 ? 0 : index / (nextCount - 1);
      const oldIndex = Math.round(ratio * (previous.length - 1));
      return previous[oldIndex] ?? 0.5;
    }));
    setTrackCount(nextCount);
    setGeneratedTracks([]);
    setSpotifyUrl(null);
    setExportNotice('');
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearchError('');
    }
  };

  const applyPreset = (type) => {
    const nextCurve = previewCurve(0.25, 0.9, type, trackCount);
    setEnergyCurve(nextCurve);
    setGeneratedTracks([]);
    setSpotifyUrl(null);
    setExportNotice('');
  };

  const updateCurveNode = (index, value) => {
    setEnergyCurve((previous) => previous.map(
      (energy, nodeIndex) => nodeIndex === index ? Number(value) : energy,
    ));
    setGeneratedTracks([]);
    setSpotifyUrl(null);
    setExportNotice('');
  };

  const handleGenerate = async () => {
    setStatus('generating');
    setErrorMsg('');
    setSpotifyUrl(null);
    setExportNotice('');

    try {
      const normalizedCurve = energyCurve.map((value) => Number(Number(value).toFixed(4)));
      const response = await fetch(`${NODE_BASE}/api/dashboard/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          seed_track_ids: selectedSeeds.map((s) => s.track_id),
          custom_energy_curve: normalizedCurve,
          energy_curve: normalizedCurve,
          current_z_sequence: currentZSequence,
          session_history: sessionHistory,
          track_count: energyCurve.length,
          playlist_name: playlistName,
          export_to_spotify: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail?.message || data.detail || data.error || 'Playlist generation failed.');
      }
      const tracks = Array.isArray(data.tracks) ? data.tracks : data.playlist;
      if (!Array.isArray(tracks) || tracks.length === 0) {
        throw new Error('The generator did not return any tracks.');
      }

      setGeneratedTracks(tracks);
      setStatus('ready');
    } catch (error) {
      console.error('[PlaylistGenerator] Generation failed:', error);
      setErrorMsg(error.message || 'Could not generate the playlist.');
      setStatus('error');
    }
  };

  const handleExport = async () => {
    setStatus('exporting');
    setErrorMsg('');
    setSpotifyUrl(null);
    setExportNotice('');

    try {
      const normalizedCurve = energyCurve.map((value) => Number(Number(value).toFixed(4)));
      const response = await fetch(`${NODE_BASE}/api/dashboard/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          seed_track_ids: selectedSeeds.map((s) => s.track_id),
          custom_energy_curve: normalizedCurve,
          energy_curve: normalizedCurve,
          current_z_sequence: currentZSequence,
          session_history: sessionHistory,
          track_count: energyCurve.length,
          playlist_name: playlistName,
          export_to_spotify: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail?.message || data.detail || data.error || 'Playlist export failed.');
      }

      const tracks = Array.isArray(data.tracks) ? data.tracks : data.playlist;
      if (Array.isArray(tracks) && tracks.length > 0) {
        setGeneratedTracks(tracks);
      }

      const resolvedUrl = data.playlist_url || data.spotify_url || null;
      setSpotifyUrl(resolvedUrl);

      if (data.exported === false && !resolvedUrl) {
        setExportNotice(
          'Spotify Development Mode restricted direct playlist creation — your generated playlist is ready below to play or open track-by-track in Spotify.',
        );
      }
      setStatus('ready');
    } catch (error) {
      console.error('[PlaylistGenerator] Export failed:', error);
      setErrorMsg(error.message || 'Could not export the playlist.');
      setStatus('error');
    }
  };

  const addSeed = (track) => {
    setSelectedSeeds((seeds) => (
      seeds.length >= 5 || seeds.some((seed) => seed.track_id === track.track_id)
        ? seeds
        : [...seeds, track]
    ));
    setSearchQuery('');
    setSearchResults([]);
    setGeneratedTracks([]);
    setSpotifyUrl(null);
    setExportNotice('');
  };

  const removeSeed = (trackId) => {
    setSelectedSeeds((seeds) => seeds.filter((seed) => seed.track_id !== trackId));
    setGeneratedTracks([]);
    setSpotifyUrl(null);
    setExportNotice('');
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>Custom energy playlist</span>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={s.block}>
          <div style={{ ...s.curveHeader, marginBottom: 8 }}>
            <span style={{ ...s.blockLabel, marginBottom: 0 }}>
              Selected Seed Songs ({selectedSeeds.length}/5)
            </span>
            <button
              type="button"
              onClick={handleQuickFillSeeds}
              style={{
                padding: '4px 10px',
                borderRadius: 14,
                border: '1px solid #1DB954',
                backgroundColor: 'rgba(29, 185, 84, 0.12)',
                color: '#1DB954',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Use Current / Sample 5 Songs
            </button>
          </div>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={selectedSeeds.length === 5 ? 'Five seeds selected' : 'Search song to add as seed...'}
            disabled={selectedSeeds.length === 5}
            style={{ ...s.customCountInput, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}
          />
          {searchError && <p style={s.errorText}>{searchError}</p>}
          {searchResults.length > 0 && (
            <div style={s.searchResults}>
              {searchResults.map((track) => (
                <button
                  key={track.track_id}
                  type="button"
                  onClick={() => addSeed(track)}
                  style={s.searchResult}
                >
                  <span>
                    {track.track_name}
                    <small style={s.searchArtist}> — {track.artist_name}</small>
                  </span>
                  <span style={s.searchEnergy}>
                    {Math.round((track.energy || 0) * 100)}%
                  </span>
                </button>
              ))}
            </div>
          )}
          <div style={s.seedList}>
            {selectedSeeds.map((seed, index) => (
              <div key={seed.track_id} style={s.seedPill}>
                <span>#{index + 1} {seed.track_name}</span>
                <button
                  type="button"
                  onClick={() => removeSeed(seed.track_id)}
                  aria-label={`Remove ${seed.track_name}`}
                  style={s.removeSeed}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={s.block}>
          <div style={s.curveHeader}>
            <span style={s.blockLabel}>2. Set the energy curve</span>
            <label style={s.countControl}>
              Tracks
              <input
                type="number"
                min="5"
                max="25"
                step="1"
                value={trackCount}
                onChange={(event) => handleTrackCountChange(event.target.value)}
                style={s.countInput}
              />
            </label>
          </div>
          <div style={s.presetRow}>
            {CURVE_TYPES.map((curve) => (
              <button
                key={curve.id}
                type="button"
                onClick={() => applyPreset(curve.id)}
                style={s.presetButton}
              >
                {curve.label}
              </button>
            ))}
          </div>
          <CurvePreview energyCurve={energyCurve} />
          <div style={s.curveNodes}>
            {energyCurve.map((value, index) => (
              <label key={index} style={s.curveNode}>
                <span style={s.sliderValue}>{Math.round(value * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={value}
                  aria-label={`Energy for track ${index + 1}`}
                  onChange={(event) => updateCurveNode(index, event.target.value)}
                  style={s.verticalSlider}
                />
                <span style={s.trackPos}>{index + 1}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={s.block}>
          <span style={s.blockLabel}>3. Playlist details</span>
          <input
            type="text"
            value={playlistName}
            maxLength={100}
            onChange={(event) => setPlaylistName(event.target.value)}
            placeholder="Playlist name"
            style={{ ...s.customCountInput, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}
          />
        </div>

        {status === 'error' && <p style={s.errorText}>{errorMsg}</p>}
        {status === 'generating' && <p style={s.statusText}>Generating playlist…</p>}
        {status === 'exporting' && <p style={s.statusText}>Exporting to Spotify…</p>}
        {spotifyUrl && (
          <p style={s.spotifyNotice}>
            Exported to Spotify.{' '}
            <a href={spotifyUrl} target="_blank" rel="noreferrer" style={s.spotifyInlineLink}>
              Open Playlist in Spotify →
            </a>
          </p>
        )}
        {exportNotice && !spotifyUrl && (
          <p style={s.spotifyNotice}>{exportNotice}</p>
        )}

        <div style={s.actionRow}>
          <button
            type="button"
            style={{ ...s.secondaryBtn, ...(status === 'generating' || status === 'exporting' ? s.disabledBtn : {}) }}
            onClick={handleGenerate}
            disabled={status === 'generating' || status === 'exporting'}
          >
            {status === 'generating' ? 'Generating…' : 'Preview Playlist'}
          </button>
          <button
            type="button"
            style={{ ...s.generateBtn, ...(status === 'generating' || status === 'exporting' ? s.generateBtnLoading : {}) }}
            onClick={handleExport}
            disabled={status === 'generating' || status === 'exporting'}
          >
            {status === 'exporting' ? 'Exporting…' : 'Export to Spotify'}
          </button>
        </div>

        {generatedTracks.length > 0 && (
          <div style={s.block}>
            <span style={s.blockLabel}>Generated playlist ({generatedTracks.length} tracks)</span>
            <div style={s.trackPreviewList}>
              {generatedTracks.map((track, index) => {
                const targetPct = Math.round(((track.target_energy ?? energyCurve[index] ?? 0.5) * 100));
                const actualPct = typeof track.actual_energy === 'number'
                  ? Math.round(track.actual_energy * 100)
                  : targetPct;
                return (
                  <div key={`${track.track_id}-${index}`} style={s.trackRow}>
                    <span style={s.trackPos}>#{index + 1}</span>
                    <span style={s.trackName}>
                      {track.track_name || track.track_id}
                      {track.artist_name && <small style={s.searchArtist}> — {track.artist_name}</small>}
                    </span>
                    <span style={s.trackEnergy} title="Graph Target Energy → Actual Track Energy">
                      {targetPct}% → {actualPct}%
                    </span>
                    {onPlayTrack ? (
                      <button
                        type="button"
                        onClick={() => onPlayTrack(track.track_id)}
                        style={s.trackPlayBtn}
                      >
                        ▶ Play
                      </button>
                    ) : null}
                    <a
                      href={`https://open.spotify.com/track/${track.track_id}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...s.trackPlayBtn, textDecoration: 'none' }}
                    >
                      Open in Spotify
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
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
  searchResults: {
    maxHeight: 180, overflowY: 'auto', marginTop: 6,
    border: '1px solid #1a1a2e', borderRadius: 10, backgroundColor: '#090910',
  },
  searchResult: {
    width: '100%', display: 'flex', justifyContent: 'space-between', gap: 10,
    padding: '10px 12px', border: 0, borderBottom: '1px solid #1a1a2e',
    background: 'transparent', color: '#f3f4f6', textAlign: 'left', cursor: 'pointer',
  },
  searchArtist: { color: '#9ca3af', fontSize: 11 },
  searchEnergy: { color: '#1DB954', whiteSpace: 'nowrap', fontSize: 11 },
  seedList: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  seedPill: {
    display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%',
    padding: '6px 10px', border: '1px solid #1DB954', borderRadius: 20,
    backgroundColor: '#090910', color: '#f3f4f6', fontSize: 12,
  },
  removeSeed: {
    padding: 0, border: 0, background: 'transparent', color: '#f87171',
    fontSize: 18, lineHeight: 1, cursor: 'pointer',
  },
  curveHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  },
  countControl: { display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 },
  countInput: {
    width: 56, padding: '6px 8px', borderRadius: 8, border: '1px solid #2a2a3a',
    backgroundColor: '#090910', color: '#f3f4f6',
  },
  presetRow: { display: 'flex', gap: 8, marginBottom: 10 },
  presetButton: {
    flex: 1, padding: '7px 8px', borderRadius: 20, border: '1px solid #2a2a3a',
    backgroundColor: '#090910', color: '#9ca3af', fontSize: 11, cursor: 'pointer',
  },
  curveNodes: {
    display: 'flex', alignItems: 'stretch', gap: 6, height: 122, overflowX: 'auto',
    padding: '12px 8px', border: '1px solid #1a1a2e', borderRadius: 10,
    backgroundColor: '#090910', boxSizing: 'border-box',
  },
  curveNode: {
    flex: '1 0 20px', minWidth: 20, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'space-between',
  },
  verticalSlider: {
    width: 18, height: 70, margin: 0, accentColor: '#1DB954',
    writingMode: 'vertical-lr', direction: 'rtl', cursor: 'pointer',
  },
  statusText: { color: '#9ca3af', fontSize: 13, margin: '0 0 12px' },
  spotifyNotice: {
    padding: 10, margin: '0 0 14px', border: '1px solid #1DB954',
    borderRadius: 10, backgroundColor: 'rgba(29, 185, 84, 0.12)', fontSize: 13,
  },
  spotifyInlineLink: { color: '#1DB954', fontWeight: 700 },
  actionRow: { display: 'flex', gap: 10, marginBottom: 20 },
  secondaryBtn: {
    flex: 1, padding: '12px 10px', border: '1px solid #1DB954', borderRadius: 50,
    backgroundColor: 'transparent', color: '#f3f4f6', fontSize: 12,
    fontWeight: 700, cursor: 'pointer',
  },
  disabledBtn: { opacity: 0.55, cursor: 'default' },
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
  trackPlayBtn: {
    padding: '5px 10px', border: '1px solid #1DB954', borderRadius: 16,
    backgroundColor: 'transparent', color: '#1DB954', fontSize: 11,
    fontWeight: 700, cursor: 'pointer',
  },
  trackActualEnergy: { color: '#6b7280' },
  doneBtn: {
    width: '100%', backgroundColor: 'transparent', color: '#9ca3af',
    border: '1px solid #2a2a3a', padding: '12px 0', borderRadius: 50,
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
};

export default PlaylistGenerator;