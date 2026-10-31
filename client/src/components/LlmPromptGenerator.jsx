// client/src/components/LlmPromptGenerator.jsx
import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { NODE_BASE, generatePromptPlaylist } from '../services/arcApi';

const PROMPT_PRESETS = [
  {
    icon: '🌃',
    label: 'Cyberpunk Night Drive',
    prompt: 'Neon-drenched cyberpunk night drive through Tokyo, dark retro synthwave building into a driving electro peak.',
    count: 10,
  },
  {
    icon: '🏋️',
    label: 'Gym Phonk Peak',
    prompt: 'Aggressive high-intensity gym phonk workout ramping from heavy warm-up to a relentless 150 BPM energetic peak.',
    count: 12,
  },
  {
    icon: '☕',
    label: 'Rainy Lo-Fi Study',
    prompt: 'Rainy window study session, mellow nostalgic lofi hip-hop with warm acoustic guitar and vinyl crackle.',
    count: 8,
  },
  {
    icon: '🌅',
    label: 'Sunrise Melodic Techno',
    prompt: 'Progressive melodic techno arc, transitioning smoothly from introspective deep house into an ecstatic sunrise drop.',
    count: 12,
  },
  {
    icon: '🌊',
    label: 'Sunset Beach Club',
    prompt: 'Golden hour sunset beach party, breezy tropical deep house with soulful vocals and uplifting summer rhythms.',
    count: 10,
  },
  {
    icon: '⚡',
    label: 'Liquid Drum & Bass',
    prompt: 'Atmospheric liquid drum and bass escalation, building gradually from ambient float into rolling 174 BPM breaks.',
    count: 10,
  },
];

const TrajectorySvg = ({ curve = [], actuals = [] }) => {
  if (!curve || curve.length === 0) return null;
  const width = 360;
  const height = 90;
  const count = curve.length;

  const points = curve.map((v, i) => {
    const x = count <= 1 ? width / 2 : (i / (count - 1)) * (width - 24) + 12;
    const y = height - v * (height - 24) - 12;
    return { x, y, v };
  });

  const pathD = points.reduce(
    (acc, pt, i) => (i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`),
    '',
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={s.svgCanvas}>
      {[0.25, 0.5, 0.75].map((lvl) => (
        <line
          key={lvl}
          x1={8}
          x2={width - 8}
          y1={height - lvl * (height - 24) - 12}
          y2={height - lvl * (height - 24) - 12}
          stroke="#1e1e2e"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ))}
      {/* Planned LLM Curve */}
      <path
        d={pathD}
        fill="none"
        stroke="#1DB954"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((pt, i) => (
        <circle key={i} cx={pt.x} cy={pt.y} r="3" fill="#1DB954" />
      ))}
      {/* Actual Retrieved Track Energies */}
      {actuals.map((act, i) => {
        if (typeof act !== 'number') return null;
        const x = count <= 1 ? width / 2 : (i / (count - 1)) * (width - 24) + 12;
        const y = height - act * (height - 24) - 12;
        return (
          <circle
            key={`act-${i}`}
            cx={x}
            cy={y}
            r="4"
            fill="#00F0FF"
            stroke="#090910"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
};

const LlmPromptGenerator = ({
  onClose,
  onPlayTrack,
  onPlayPlaylist,
  onTransferToPlanner,
}) => {
  const accessToken = usePlayerStore((state) => state.accessToken);
  const updateAccessToken = usePlayerStore((state) => state.updateAccessToken);
  const sessionHistory = usePlayerStore((state) => state.sessionHistory);
  const trackMeta = usePlayerStore((state) => state.trackMeta);

  const [prompt, setPrompt] = useState('');
  const [trackCount, setTrackCount] = useState(10);
  const [selectedSeeds, setSelectedSeeds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');

  const [status, setStatus] = useState('idle'); // 'idle' | 'generating' | 'exporting' | 'ready' | 'error'
  const [loadingPhase, setLoadingPhase] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultPlan, setResultPlan] = useState(null);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [spotifyUrl, setSpotifyUrl] = useState(null);
  const [spotifyPlaylistId, setSpotifyPlaylistId] = useState(null);
  const [exportNotice, setExportNotice] = useState('');
  const [copiedNotice, setCopiedNotice] = useState('');

  // Search seeds in dataset
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || selectedSeeds.length >= 5) {
      setSearchResults([]);
      return undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `${NODE_BASE}/api/dashboard/search-seeds?q=${encodeURIComponent(q)}`,
          { signal: controller.signal, credentials: 'include' },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Search failed (${response.status})`);
        setSearchResults(Array.isArray(data.tracks) ? data.tracks : []);
        setSearchError('');
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSearchError(err.message || 'Could not search tracks.');
          setSearchResults([]);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, selectedSeeds.length]);

  const ensureValidAccessToken = async () => {
    const current = usePlayerStore.getState().accessToken;
    const expiresAt = usePlayerStore.getState().expiresAt;
    if (current && (!expiresAt || expiresAt - Date.now() > 30_000)) {
      return current;
    }
    try {
      const res = await fetch(`${NODE_BASE}/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const fresh = data.access_token || data.accessToken;
        if (fresh) {
          updateAccessToken(fresh, data.expires_in || 3600);
          return fresh;
        }
      }
    } catch {
      // Fallback to cookie-based session
    }
    return current;
  };

  const handleQuickFillSeeds = async () => {
    setSearchError('');
    try {
      const recentSeeds = (sessionHistory || [])
        .slice(-5)
        .filter((id) => trackMeta?.[id]?.name)
        .map((id) => ({
          track_id: id,
          track_name: trackMeta[id].name,
          artist_name: trackMeta[id].artists || '',
        }));

      const res = await fetch(`${NODE_BASE}/api/dashboard/search-seeds?q=random`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      const sampleTracks = Array.isArray(data.tracks) ? data.tracks : [];

      const merged = [...recentSeeds];
      for (const t of sampleTracks) {
        if (merged.length >= 5) break;
        if (t?.track_id && !merged.some((s) => s.track_id === t.track_id)) {
          merged.push(t);
        }
      }

      if (merged.length > 0) {
        setSelectedSeeds(merged.slice(0, 5));
        setSearchQuery('');
        setSearchResults([]);
      } else {
        setSearchError('Could not load sample seeds.');
      }
    } catch (err) {
      setSearchError(err.message || 'Could not load seeds.');
    }
  };

  const addSeed = (track) => {
    setSelectedSeeds((prev) => (
      prev.length >= 5 || prev.some((s) => s.track_id === track.track_id)
        ? prev
        : [...prev, track]
    ));
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeSeed = (trackId) => {
    setSelectedSeeds((prev) => prev.filter((s) => s.track_id !== trackId));
  };

  const applyPreset = (preset) => {
    setPrompt(preset.prompt);
    setTrackCount(preset.count || 10);
    setErrorMsg('');
  };

  const handleGenerate = async (exportDirectly = false) => {
    if (!prompt.trim() || prompt.trim().length < 2) {
      setErrorMsg('Please enter a descriptive prompt for the AI model.');
      return;
    }

    setStatus(exportDirectly ? 'exporting' : 'generating');
    setLoadingPhase('Asking LLM to analyze harmonic narrative & shape energy trajectory...');
    setErrorMsg('');
    setSpotifyUrl(null);
    setSpotifyPlaylistId(null);
    setExportNotice('');
    setCopiedNotice('');

    const phaseTimer = setTimeout(() => {
      setLoadingPhase('Solving PyTorch LSTM acoustic transitions & pgvector matches...');
    }, 2800);

    try {
      const token = await ensureValidAccessToken();
      const payload = {
        prompt: prompt.trim(),
        track_count: Number(trackCount) || 10,
        seed_track_ids: selectedSeeds.map((s) => s.track_id),
        access_token: token,
        playlist_name: playlistTitle.trim() || undefined,
        export_to_spotify: exportDirectly,
      };

      const data = await generatePromptPlaylist(payload);
      clearTimeout(phaseTimer);

      if (data.access_token) {
        updateAccessToken(data.access_token, 3600);
      }

      const tracks = Array.isArray(data.tracks) ? data.tracks : data.playlist;
      if (!Array.isArray(tracks) || tracks.length === 0) {
        throw new Error('The model did not return any matching tracks for this vibe.');
      }

      setResultPlan(data);
      setPlaylistTitle(data.title || data.playlist_title || `Arc-Stream: ${prompt.slice(0, 24).trim()}`);

      const resolvedUrl =
        data.playlist_url
        || data.spotify_url
        || (data.playlist_id ? `https://open.spotify.com/playlist/${data.playlist_id}` : null);

      if (resolvedUrl) {
        setSpotifyUrl(resolvedUrl);
        setSpotifyPlaylistId(data.playlist_id || null);
      } else if (exportDirectly && data.exported === false) {
        setExportNotice(
          `Spotify API could not export directly (${data.export_error || 'check account allowlist'}). You can play all tracks now or copy track links into Spotify!`,
        );
      }

      setStatus('ready');
    } catch (err) {
      clearTimeout(phaseTimer);
      console.error('[LlmPromptGenerator] Generation failed:', err);
      setErrorMsg(err.message || 'Failed to synthesize playlist from prompt.');
      setStatus('error');
    }
  };

  const handleExportExisting = async () => {
    if (!resultPlan || !resultPlan.tracks?.length) return;

    setStatus('exporting');
    setLoadingPhase('Exporting LLM mix to your Spotify account...');
    setErrorMsg('');
    setSpotifyUrl(null);
    setSpotifyPlaylistId(null);
    setExportNotice('');
    setCopiedNotice('');

    try {
      const token = await ensureValidAccessToken();
      const response = await fetch(`${NODE_BASE}/api/dashboard/playlist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          playlist_name: playlistTitle || resultPlan.title || 'Arc-Stream LLM Mix',
          energy_curve: resultPlan.energy_curve || [],
          tracks: resultPlan.tracks,
          export_to_spotify: true,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail?.message || data.detail || data.error || 'Export failed.');
      }
      if (data.access_token) {
        updateAccessToken(data.access_token, 3600);
      }

      const resolvedUrl =
        data.playlist_url
        || data.spotify_url
        || (data.playlist_id ? `https://open.spotify.com/playlist/${data.playlist_id}` : null);

      if (resolvedUrl) {
        setSpotifyUrl(resolvedUrl);
        setSpotifyPlaylistId(data.playlist_id || null);
      } else if (data.exported === false) {
        setExportNotice('Export restricted by Spotify Development Mode. Play directly or copy links below.');
      }
      setStatus('ready');
    } catch (err) {
      console.error('[LlmPromptGenerator] Export failed:', err);
      setErrorMsg(err.message || 'Could not export to Spotify.');
      setStatus('error');
    }
  };

  const handleCopySpotifyLinks = async () => {
    const tracks = resultPlan?.tracks || [];
    if (!tracks.length) return;
    const links = tracks
      .map((t) => `https://open.spotify.com/track/${t.track_id}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(links);
      setCopiedNotice('Copied Spotify track links! Press Ctrl+V in Spotify to paste into any playlist.');
    } catch {
      setCopiedNotice('Could not access clipboard.');
    }
  };

  const handleTransferToPlanner = () => {
    if (!resultPlan?.energy_curve?.length) return;
    onTransferToPlanner?.({
      curve: resultPlan.energy_curve,
      tracks: resultPlan.tracks,
      title: playlistTitle,
    });
    onClose?.();
  };

  const valencePct = Math.round(((resultPlan?.target_valence ?? 0.5) * 100));
  const bpmRange = resultPlan?.recommended_bpm_range || [100, 128];
  const actualEnergies = (resultPlan?.tracks || []).map((t) => (typeof t.actual_energy === 'number' ? t.actual_energy : null));

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={s.aiBadge}>✨ LLM STUDIO</div>
            <div>
              <h2 style={s.title}>AI DJ Prompt Model</h2>
              <p style={s.sub}>
                Natural language musicology & acoustic trajectory synthesis
              </p>
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Prompt Input Section */}
        <div style={s.block}>
          <div style={s.sectionHeader}>
            <span style={s.blockLabel}>1. Describe your vibe or narrative</span>
            <span style={s.pillModel}>Ollama · Qwen2.5 / Adaptive AI</span>
          </div>

          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Neon-drenched late night cyberpunk drive through Tokyo, dark synthwave building into an intense electro peak..."
            style={s.promptArea}
          />

          {/* Quick inspiration chips */}
          <div style={s.presetsWrap}>
            <span style={s.presetLabel}>Quick Presets:</span>
            <div style={s.presetsScroll}>
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  style={s.presetChip}
                >
                  <span>{preset.icon}</span> {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Track Count & Anchor Seeds (Collapsible/Fine-tuning) */}
        <div style={s.block}>
          <div style={s.curveHeader}>
            <span style={s.blockLabel}>2. Mixing Controls & Seed Anchors</span>
            <label style={s.countControl}>
              Tracks:
              <input
                type="number"
                min="5"
                max="25"
                value={trackCount}
                onChange={(e) => setTrackCount(Math.max(5, Math.min(25, Number(e.target.value) || 10)))}
                style={s.countInput}
              />
            </label>
          </div>

          {/* Seed selector */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                Anchor Seeds ({selectedSeeds.length}/5) - Optional
              </span>
              <button
                type="button"
                onClick={handleQuickFillSeeds}
                style={s.quickFillBtn}
              >
                Use My Recent Tracks
              </button>
            </div>

            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedSeeds.length >= 5 ? 'Maximum 5 anchor tracks selected' : 'Search song or artist to anchor the mix...'}
              disabled={selectedSeeds.length >= 5}
              style={s.searchInput}
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
                      ⚡ {Math.round((track.energy || 0) * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            )}

            {selectedSeeds.length > 0 && (
              <div style={s.seedList}>
                {selectedSeeds.map((seed, idx) => (
                  <div key={seed.track_id} style={s.seedPill}>
                    <span>#{idx + 1} {seed.track_name}</span>
                    <button
                      type="button"
                      onClick={() => removeSeed(seed.track_id)}
                      style={s.removeSeed}
                      aria-label="Remove seed"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status / Errors / Loading States */}
        {status === 'error' && <p style={s.errorText}>{errorMsg}</p>}
        {(status === 'generating' || status === 'exporting') && (
          <div style={s.loadingContainer}>
            <div style={s.spinner} />
            <p style={s.loadingText}>{loadingPhase || 'Synthesizing with AI Model...'}</p>
          </div>
        )}

        {/* Generate Actions */}
        <div style={s.actionRow}>
          <button
            type="button"
            style={{
              ...s.generateBtn,
              ...(status === 'generating' || status === 'exporting' ? s.btnDisabled : {}),
            }}
            onClick={() => handleGenerate(false)}
            disabled={status === 'generating' || status === 'exporting'}
          >
            {status === 'generating' ? 'Synthesizing...' : '✨ Generate with LLM'}
          </button>
          <button
            type="button"
            style={{
              ...s.secondaryBtn,
              ...(status === 'generating' || status === 'exporting' ? s.btnDisabled : {}),
            }}
            onClick={() => handleGenerate(true)}
            disabled={status === 'generating' || status === 'exporting'}
          >
            ⚡ Generate & Export to Spotify
          </button>
        </div>

        {/* LLM Synthesis Results & Blueprint */}
        {resultPlan && (
          <div style={s.resultContainer}>
            <div style={s.resultHeader}>
              <div style={s.titleRow}>
                <span style={s.blueprintTag}>LLM SYNTHESIS BLUEPRINT</span>
                <input
                  type="text"
                  value={playlistTitle}
                  onChange={(e) => setPlaylistTitle(e.target.value)}
                  style={s.playlistTitleInput}
                  title="Click to rename before Spotify export"
                />
              </div>

              {resultPlan.vibe_summary && (
                <div style={s.vibeSummaryBox}>
                  <span style={s.vibeQuote}>“</span>
                  <p style={s.vibeSummaryText}>{resultPlan.vibe_summary}</p>
                </div>
              )}

              {/* Acoustic Telemetry Chips */}
              <div style={s.telemetryGrid}>
                <div style={s.telemetryChip}>
                  <span style={s.telemetryLabel}>MOOD / VALENCE</span>
                  <span style={s.telemetryVal}>
                    {valencePct}% · {valencePct > 50 ? 'Uplifting' : 'Dark/Moody'}
                  </span>
                </div>
                <div style={s.telemetryChip}>
                  <span style={s.telemetryLabel}>RECOMMENDED TEMPO</span>
                  <span style={s.telemetryVal}>
                    {bpmRange[0]} – {bpmRange[1]} BPM
                  </span>
                </div>
                <div style={s.telemetryChip}>
                  <span style={s.telemetryLabel}>ENERGY ARC</span>
                  <span style={s.telemetryVal}>
                    {resultPlan.energy_curve ? `${resultPlan.energy_curve.length} Steps` : 'Custom'}
                  </span>
                </div>
              </div>

              {/* Trajectory Graph Visualizer */}
              {resultPlan.energy_curve && (
                <div style={s.curveWrap}>
                  <div style={s.curveMeta}>
                    <span>Planned Energy Arc (Green) vs Actual Song Energy (Cyan)</span>
                  </div>
                  <TrajectorySvg curve={resultPlan.energy_curve} actuals={actualEnergies} />
                </div>
              )}

              {/* Spotify Link / Notices */}
              {spotifyUrl && (
                <div style={s.spotifyNotice}>
                  <div>
                    ✓ Exported to Spotify!{' '}
                    <a href={spotifyUrl} target="_blank" rel="noreferrer" style={s.spotifyInlineLink}>
                      Open Playlist in Spotify →
                    </a>
                  </div>
                  {spotifyPlaylistId && (
                    <iframe
                      title="Spotify Playlist"
                      src={`https://open.spotify.com/embed/playlist/${encodeURIComponent(spotifyPlaylistId)}?utm_source=generator&theme=0`}
                      width="100%"
                      height="152"
                      style={{ border: 0, borderRadius: 10, marginTop: 10 }}
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                    />
                  )}
                </div>
              )}

              {exportNotice && !spotifyUrl && (
                <div style={s.spotifyNotice}>
                  <div>{exportNotice}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <a href={`${NODE_BASE}/login`} style={s.spotifyInlineLink}>
                      Reconnect Spotify Scopes →
                    </a>
                  </div>
                </div>
              )}

              {copiedNotice && (
                <p style={s.spotifyNotice}>{copiedNotice}</p>
              )}

              {/* Action Toolbar for Generated Mix */}
              <div style={s.resultActions}>
                <button
                  type="button"
                  onClick={handleExportExisting}
                  disabled={status === 'exporting'}
                  style={s.spotifyExportBtn}
                >
                  {status === 'exporting' ? 'Exporting...' : 'Export Mix to Spotify'}
                </button>
                {onPlayPlaylist && (
                  <button
                    type="button"
                    onClick={() => onPlayPlaylist(resultPlan.tracks)}
                    style={s.playAllBtn}
                  >
                    ▶ Play All Tracks
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopySpotifyLinks}
                  style={s.toolBtn}
                >
                  Copy Links
                </button>
                {onTransferToPlanner && (
                  <button
                    type="button"
                    onClick={handleTransferToPlanner}
                    style={s.toolBtn}
                  >
                    Tweak in Curve Editor →
                  </button>
                )}
              </div>
            </div>

            {/* Generated Song List */}
            <div style={s.trackPreviewList}>
              <div style={s.trackListHeader}>
                <span># TRACK</span>
                <span>ENERGY (TARGET → ACTUAL)</span>
                <span>ACTIONS</span>
              </div>
              {resultPlan.tracks.map((track, idx) => {
                const targetPct = Math.round(((track.target_energy ?? resultPlan.energy_curve?.[idx] ?? 0.5) * 100));
                const actualPct = typeof track.actual_energy === 'number'
                  ? Math.round(track.actual_energy * 100)
                  : targetPct;

                return (
                  <div key={`${track.track_id}-${idx}`} style={s.trackRow}>
                    <span style={s.trackPos}>#{idx + 1}</span>
                    <div style={s.trackMeta}>
                      <span style={s.trackName}>{track.track_name || track.track_id}</span>
                      <span style={s.trackArtist}>{track.artist_name || 'Spotify Artist'}</span>
                    </div>
                    <div style={s.energyBadge} title="LLM Target Energy → Nearest Song Vector Energy">
                      <span>{targetPct}%</span>
                      <span style={{ color: '#6b7280' }}>→</span>
                      <span style={{ color: '#00F0FF' }}>{actualPct}%</span>
                    </div>
                    <div style={s.trackActions}>
                      {onPlayTrack && (
                        <button
                          type="button"
                          onClick={() => onPlayTrack(track.track_id)}
                          style={s.trackActionBtn}
                        >
                          ▶
                        </button>
                      )}
                      <a
                        href={`https://open.spotify.com/track/${track.track_id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={s.trackSpotifyLink}
                      >
                        Spotify
                      </a>
                    </div>
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
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16, boxSizing: 'border-box', backdropFilter: 'blur(4px)',
  },
  modal: {
    width: '100%', maxWidth: 540,
    backgroundColor: '#0f0f16', border: '1px solid #1a1a2e',
    borderRadius: 20, padding: '24px 26px',
    boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto',
    color: '#f3f4f6', boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 18, borderBottom: '1px solid #1e1e2e', paddingBottom: 14,
  },
  aiBadge: {
    padding: '4px 8px', borderRadius: 6,
    background: 'linear-gradient(135deg, #1DB954 0%, #00F0FF 100%)',
    color: '#000', fontSize: 10, fontWeight: 900, letterSpacing: '1px',
  },
  title: { margin: '0 0 2px', fontSize: 18, fontWeight: 800, color: '#f3f4f6' },
  sub: { margin: 0, fontSize: 12, color: '#9ca3af' },
  closeBtn: {
    background: 'none', border: 'none', color: '#6b7280',
    fontSize: 24, lineHeight: 1, cursor: 'pointer', padding: 4,
  },
  block: { marginBottom: 18 },
  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  blockLabel: {
    fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', color: '#9ca3af',
  },
  pillModel: {
    fontSize: 10, color: '#1DB954', backgroundColor: 'rgba(29, 185, 84, 0.12)',
    padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(29, 185, 84, 0.3)',
    fontWeight: 600,
  },
  promptArea: {
    width: '100%', padding: '12px 14px', borderRadius: 12,
    border: '1px solid #28283c', backgroundColor: '#090910',
    color: '#f3f4f6', fontSize: 13, resize: 'vertical',
    boxSizing: 'border-box', outline: 'none', lineHeight: 1.5,
    fontFamily: 'inherit',
  },
  presetsWrap: { marginTop: 10 },
  presetLabel: { fontSize: 11, color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 },
  presetsScroll: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  presetChip: {
    padding: '5px 10px', borderRadius: 20, border: '1px solid #242436',
    backgroundColor: '#14141e', color: '#d1d5db', fontSize: 11,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
    transition: 'all 0.15s ease',
  },
  curveHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  },
  countControl: { display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 },
  countInput: {
    width: 54, padding: '5px 8px', borderRadius: 8, border: '1px solid #28283c',
    backgroundColor: '#090910', color: '#f3f4f6', fontSize: 12, textAlign: 'center',
  },
  quickFillBtn: {
    padding: '3px 8px', borderRadius: 12, border: '1px solid #1DB954',
    backgroundColor: 'rgba(29, 185, 84, 0.1)', color: '#1DB954',
    fontSize: 10, fontWeight: 700, cursor: 'pointer',
  },
  searchInput: {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    border: '1px solid #28283c', backgroundColor: '#090910',
    color: '#f3f4f6', fontSize: 12, boxSizing: 'border-box', outline: 'none',
  },
  searchResults: {
    maxHeight: 140, overflowY: 'auto', marginTop: 4,
    border: '1px solid #222234', borderRadius: 8, backgroundColor: '#090910',
  },
  searchResult: {
    width: '100%', display: 'flex', justifyContent: 'space-between', gap: 10,
    padding: '8px 10px', border: 0, borderBottom: '1px solid #1a1a2e',
    background: 'transparent', color: '#f3f4f6', textAlign: 'left', cursor: 'pointer',
    fontSize: 12,
  },
  searchArtist: { color: '#9ca3af', fontSize: 11 },
  searchEnergy: { color: '#1DB954', fontSize: 11, whiteSpace: 'nowrap' },
  seedList: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  seedPill: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 8px', border: '1px solid #1DB954', borderRadius: 16,
    backgroundColor: '#090910', color: '#f3f4f6', fontSize: 11,
  },
  removeSeed: {
    padding: 0, border: 0, background: 'transparent', color: '#f87171',
    fontSize: 16, lineHeight: 1, cursor: 'pointer',
  },
  actionRow: { display: 'flex', gap: 10, marginTop: 14, marginBottom: 14 },
  generateBtn: {
    flex: 1.2, backgroundColor: '#1DB954', color: '#000',
    border: 'none', padding: '12px 14px', borderRadius: 50,
    fontSize: 13, fontWeight: 800, letterSpacing: '0.5px', cursor: 'pointer',
  },
  secondaryBtn: {
    flex: 1, backgroundColor: 'transparent', color: '#1DB954',
    border: '1px solid #1DB954', padding: '12px 12px', borderRadius: 50,
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.55, cursor: 'default' },
  loadingContainer: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    backgroundColor: '#12121e', border: '1px solid #1e1e32', borderRadius: 10,
    marginBottom: 12,
  },
  spinner: {
    width: 16, height: 16, border: '2px solid rgba(29, 185, 84, 0.2)',
    borderTopColor: '#1DB954', borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: { margin: 0, fontSize: 12, color: '#9ca3af' },
  errorText: { color: '#f87171', fontSize: 12, margin: '6px 0 10px', lineHeight: 1.4 },
  resultContainer: {
    marginTop: 18, borderTop: '1px solid #1e1e2e', paddingTop: 16,
  },
  resultHeader: { marginBottom: 14 },
  titleRow: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  blueprintTag: { fontSize: 9, fontWeight: 800, letterSpacing: '1.5px', color: '#1DB954' },
  playlistTitleInput: {
    background: 'none', border: 'none', borderBottom: '1px solid #28283c',
    fontSize: 16, fontWeight: 800, color: '#f3f4f6', outline: 'none', padding: '2px 0',
  },
  vibeSummaryBox: {
    display: 'flex', gap: 6, padding: '10px 12px', borderRadius: 10,
    backgroundColor: '#12121e', borderLeft: '3px solid #1DB954', marginBottom: 12,
  },
  vibeQuote: { fontSize: 20, lineHeight: 1, color: '#1DB954', fontWeight: 800 },
  vibeSummaryText: { margin: 0, fontSize: 12, color: '#d1d5db', lineHeight: 1.5, fontStyle: 'italic' },
  telemetryGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 },
  telemetryChip: {
    backgroundColor: '#090910', border: '1px solid #1e1e2e', borderRadius: 8,
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'center',
  },
  telemetryLabel: { fontSize: 8, fontWeight: 800, letterSpacing: '1px', color: '#6b7280' },
  telemetryVal: { fontSize: 11, fontWeight: 700, color: '#f3f4f6', fontFamily: 'monospace' },
  curveWrap: {
    backgroundColor: '#090910', border: '1px solid #1e1e2e', borderRadius: 10,
    padding: '10px 8px 6px', marginBottom: 12,
  },
  curveMeta: { fontSize: 10, color: '#6b7280', textAlign: 'center', marginBottom: 4 },
  svgCanvas: { width: '100%', height: 90, display: 'block' },
  spotifyNotice: {
    padding: 10, margin: '10px 0', border: '1px solid #1DB954',
    borderRadius: 10, backgroundColor: 'rgba(29, 185, 84, 0.12)', fontSize: 12,
  },
  spotifyInlineLink: { color: '#1DB954', fontWeight: 700 },
  resultActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  spotifyExportBtn: {
    flex: 1.3, backgroundColor: '#1DB954', color: '#000', border: 'none',
    padding: '10px 14px', borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: 'pointer',
  },
  playAllBtn: {
    flex: 1, backgroundColor: 'transparent', color: '#00F0FF', border: '1px solid #00F0FF',
    padding: '10px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
  toolBtn: {
    padding: '10px 12px', borderRadius: 20, border: '1px solid #2a2a3e',
    backgroundColor: '#12121e', color: '#9ca3af', fontSize: 11, cursor: 'pointer',
  },
  trackPreviewList: {
    maxHeight: 220, overflowY: 'auto', border: '1px solid #1e1e2e',
    borderRadius: 10, backgroundColor: '#090910', padding: '4px',
  },
  trackListHeader: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 8px',
    fontSize: 9, fontWeight: 800, letterSpacing: '1px', color: '#6b7280',
    borderBottom: '1px solid #1a1a2e',
  },
  trackRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
    borderBottom: '1px solid #141420',
  },
  trackPos: { width: 22, fontSize: 11, color: '#6b7280', fontFamily: 'monospace' },
  trackMeta: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  trackName: { fontSize: 12, fontWeight: 600, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  trackArtist: { fontSize: 10, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  energyBadge: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
    fontFamily: 'monospace', color: '#1DB954', minWidth: 70, justifyContent: 'center',
  },
  trackActions: { display: 'flex', alignItems: 'center', gap: 6 },
  trackActionBtn: {
    padding: '3px 8px', borderRadius: 12, border: '1px solid #1DB954',
    background: 'none', color: '#1DB954', fontSize: 10, cursor: 'pointer',
  },
  trackSpotifyLink: {
    color: '#6b7280', fontSize: 10, textDecoration: 'none', padding: '3px 6px',
    border: '1px solid #28283c', borderRadius: 10,
  },
};

export default LlmPromptGenerator;
