import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../store/playerStore';
import { fetchQueuePreview, commitQueue } from '../services/queueApi';

const UP_NEXT_COUNT = 5;

export const UpNextQueue = () => {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const currentTrackName = usePlayerStore((s) => s.currentTrack?.name);
  const targetEnergy = usePlayerStore((s) => s.targetEnergy);
  const upNext = usePlayerStore((s) => s.upNext);
  const analysis = usePlayerStore((s) => s.analysis);
  const upNextStatus = usePlayerStore((s) => s.upNextStatus);
  const upNextError = usePlayerStore((s) => s.upNextError);

  const {
    setUpNext,
    setAnalysis,
    setUpNextStatus,
    setUpNextError,
    addQueuedIds,
  } = usePlayerStore(
    useShallow((s) => ({
      setUpNext: s.setUpNext,
      setAnalysis: s.setAnalysis,
      setUpNextStatus: s.setUpNextStatus,
      setUpNextError: s.setUpNextError,
      addQueuedIds: s.addQueuedIds,
    }))
  );

  const [debouncedEnergy, setDebouncedEnergy] = useState(targetEnergy);
  const [padded, setPadded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isCommitting, setIsCommitting] = useState(false);
  const [committedEnergy, setCommittedEnergy] = useState(null);
  const [commitSummary, setCommitSummary] = useState(null);

  const isCommitted = committedEnergy !== null && committedEnergy === debouncedEnergy;

  // Debounce energy slider adjustments ~400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEnergy(targetEnergy);
    }, 400);
    return () => clearTimeout(timer);
  }, [targetEnergy]);

  // Autoregressive queue prediction effect
  useEffect(() => {
    if (!currentTrackId) {
      return;
    }

    const controller = new AbortController();
    setUpNextStatus('loading');
    setUpNextError(null);

    // Snapshot store exclusions and history
    const { sessionHistory, queuedIds } = usePlayerStore.getState();

    // Collapse consecutive duplicate seeds
    const collapsed = [];
    for (const id of sessionHistory) {
      if (id && (collapsed.length === 0 || collapsed[collapsed.length - 1] !== id)) {
        collapsed.push(id);
      }
    }

    const seeds = (collapsed.length > 0 && collapsed[collapsed.length - 1] === currentTrackId)
      ? collapsed
      : [...collapsed, currentTrackId];

    const seedTrackIds = seeds.slice(-9);
    const exclusions = [...collapsed, ...queuedIds];

    fetchQueuePreview({
      seedTrackIds,
      targetEnergy: debouncedEnergy,
      count: UP_NEXT_COUNT,
      sessionHistory: exclusions,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setUpNext(data.tracks || []);
        setAnalysis(data.analysis || null);
        setPadded(Boolean(data.padded));
        setUpNextStatus('ready');
      })
      .catch((err) => {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        if (err.code === 'NO_MAPPED_SEEDS') {
          setUpNextStatus('unmapped');
          setUpNext([]);
          setAnalysis(null);
        } else {
          setUpNextStatus('error');
          setUpNextError(err.message || 'Failed to predict upcoming tracks.');
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    currentTrackId,
    debouncedEnergy,
    retryCount,
    setUpNext,
    setAnalysis,
    setUpNextStatus,
    setUpNextError,
  ]);

  const handleQueueToSpotify = async () => {
    if (isCommitting || isCommitted || upNext.length === 0) return;

    const { accessToken, deviceId, sessionId } = usePlayerStore.getState();
    if (!accessToken) {
      alert('Spotify access token is missing. Please reconnect.');
      return;
    }

    setIsCommitting(true);
    try {
      const result = await commitQueue({
        accessToken,
        deviceId,
        sessionId,
        targetEnergy: debouncedEnergy,
        tracks: upNext,
      });

      const queuedCount = result.queued?.length || 0;
      const total = upNext.length;
      setCommitSummary({ queuedCount, total });
      setCommittedEnergy(debouncedEnergy);

      if (result.queued && result.queued.length > 0) {
        addQueuedIds(result.queued);
      }
    } catch (err) {
      console.error('[UpNextQueue] Failed to commit queue:', err);
      alert(`Could not push tracks to Spotify: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  const getDeltaColor = (delta) => {
    const abs = Math.abs(delta);
    if (abs < 0.10) return '#1DB954';
    if (abs < 0.25) return '#f59e0b';
    return '#ef4444';
  };

  const formatDelta = (delta) => {
    const prefix = delta >= 0 ? '+' : '';
    return `${prefix}${delta.toFixed(2)}`;
  };

  return (
    <div style={s.container}>
      {/* ─── NOW ANALYSING HEADER ─── */}
      <div style={s.analysingCard}>
        <div style={s.sectionHeader}>
          <span style={s.sectionTitle}>NOW ANALYSING</span>
          {padded && (
            <span style={s.paddedBadge}>limited history</span>
          )}
        </div>

        <p style={s.currentTrackTitle}>
          {currentTrackName || 'No track selected'}
        </p>

        {analysis ? (
          <div style={s.chipRow}>
            <div style={s.chip}>
              <span style={s.chipLabel}>ENERGY</span>
              <span style={s.chipVal}>{analysis.energy.toFixed(2)}</span>
            </div>
            <div style={s.chip}>
              <span style={s.chipLabel}>VALENCE</span>
              <span style={s.chipVal}>{analysis.valence.toFixed(2)}</span>
            </div>
            <div style={s.chip}>
              <span style={s.chipLabel}>DANCE</span>
              <span style={s.chipVal}>{analysis.danceability.toFixed(2)}</span>
            </div>
            <div style={s.chip}>
              <span style={s.chipLabel}>TEMPO</span>
              <span style={s.chipVal}>{Math.round(analysis.tempo)} BPM</span>
            </div>
          </div>
        ) : (
          <p style={s.analyzingHint}>
            {upNextStatus === 'unmapped'
              ? 'Current track features unavailable in dataset'
              : 'Extracting audio latent vector…'}
          </p>
        )}
      </div>

      {/* ─── UP NEXT LIST / STATES ─── */}
      <div style={s.queueCard}>
        <div style={s.queueHeader}>
          <span style={s.sectionTitle}>UP NEXT</span>
          <span style={s.targetIndicator}>
            TARGET: <span style={s.targetMono}>{targetEnergy.toFixed(2)}</span>
          </span>
        </div>

        {upNextStatus === 'loading' && (
          <div style={s.skeletonWrap}>
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} style={s.skeletonRow}>
                <div style={s.skeletonPos} />
                <div style={s.skeletonMeta}>
                  <div style={s.skeletonBar(140)} />
                  <div style={s.skeletonBar(80)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {upNextStatus === 'unmapped' && (
          <div style={s.noticeBox}>
            <p style={s.noticeText}>
              This track isn&apos;t in the Arc-Stream map - play a generated track to continue.
            </p>
          </div>
        )}

        {upNextStatus === 'error' && (
          <div style={s.errorBox}>
            <p style={s.errorText}>{upNextError || 'Failed to predict queue.'}</p>
            <button
              style={s.retryBtn}
              onClick={() => setRetryCount((c) => c + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {upNextStatus === 'ready' && upNext.length > 0 && (
          <div role="list" style={s.trackList}>
            {upNext.map((track) => {
              const actualEnergy = typeof track.energy === 'number' ? track.energy : 0;
              const delta = actualEnergy - targetEnergy;
              const deltaColor = getDeltaColor(delta);

              return (
                <div key={track.track_id} role="listitem" style={s.trackRow}>
                  <span style={s.trackPos}>{track.position}</span>

                  <div style={s.trackInfo}>
                    <p style={s.trackTitle}>{track.track_name || track.track_id}</p>
                    <p style={s.trackArtists}>{track.artists || '—'}</p>

                    {/* Thin Energy Bar with Target Tick Marker */}
                    <div style={s.energyBarTrack}>
                      <div
                        style={{
                          ...s.energyBarFill,
                          width: `${Math.min(100, Math.max(0, actualEnergy * 100))}%`,
                        }}
                      />
                      <div
                        style={{
                          ...s.targetTick,
                          left: `${Math.min(100, Math.max(0, targetEnergy * 100))}%`,
                        }}
                        title={`Target: ${targetEnergy.toFixed(2)}`}
                      />
                    </div>
                  </div>

                  <div style={s.energyMetrics}>
                    <span style={s.actualEnergyVal}>
                      {actualEnergy.toFixed(2)}
                    </span>
                    <span style={{ ...s.deltaBadge, color: deltaColor }}>
                      {formatDelta(delta)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {padded && upNextStatus === 'ready' && (
          <p style={s.paddedNote}>
            * Sequence generated based on limited listening history.
          </p>
        )}

        {/* ─── QUEUE TO SPOTIFY BUTTON ─── */}
        <button
          style={{
            ...s.queueBtn,
            ...(isCommitted ? s.queueBtnCommitted : {}),
            ...(isCommitting || upNextStatus !== 'ready' ? s.queueBtnDisabled : {}),
          }}
          onClick={handleQueueToSpotify}
          disabled={isCommitting || isCommitted || upNextStatus !== 'ready' || upNext.length === 0}
        >
          {isCommitting
            ? 'Queueing tracks…'
            : isCommitted && commitSummary
            ? `Queued ${commitSummary.queuedCount} of ${commitSummary.total}`
            : 'Queue to Spotify'}
        </button>
      </div>
    </div>
  );
};

const s = {
  container: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxSizing: 'border-box',
  },
  analysingCard: {
    width: '100%',
    backgroundColor: '#111118',
    border: '1px solid #1a1a2e',
    borderRadius: 16,
    padding: '16px 20px',
    boxSizing: 'border-box',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '2px',
    color: '#6b7280',
  },
  paddedBadge: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.5px',
    color: '#9ca3af',
    backgroundColor: '#1f1f2e',
    padding: '2px 8px',
    borderRadius: 10,
  },
  currentTrackTitle: {
    margin: '0 0 12px',
    fontSize: 15,
    fontWeight: 700,
    color: '#f3f4f6',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chipRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  chip: {
    backgroundColor: '#090910',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  chipLabel: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '1px',
    color: '#6b7280',
  },
  chipVal: {
    fontSize: 11,
    fontWeight: 700,
    color: '#1DB954',
    fontFamily: 'monospace',
  },
  analyzingHint: {
    margin: 0,
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  queueCard: {
    width: '100%',
    backgroundColor: '#111118',
    border: '1px solid #1a1a2e',
    borderRadius: 16,
    padding: '18px 20px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  queueHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  targetIndicator: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '1px',
    color: '#6b7280',
  },
  targetMono: {
    color: '#1DB954',
    fontFamily: 'monospace',
  },
  trackList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  trackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 10px',
    backgroundColor: '#090910',
    borderRadius: 10,
    border: '1px solid #161622',
  },
  trackPos: {
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#6b7280',
    width: 14,
    textAlign: 'center',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  trackTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: '#f3f4f6',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  trackArtists: {
    margin: 0,
    fontSize: 11,
    color: '#9ca3af',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  energyBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#222232',
    borderRadius: 2,
    position: 'relative',
    marginTop: 4,
    overflow: 'visible',
  },
  energyBarFill: {
    height: '100%',
    backgroundColor: '#1DB954',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  targetTick: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
    transform: 'translateX(-50%)',
    boxShadow: '0 0 4px rgba(255,255,255,0.8)',
    zIndex: 2,
  },
  energyMetrics: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    minWidth: 42,
  },
  actualEnergyVal: {
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#d1d5db',
  },
  deltaBadge: {
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  paddedNote: {
    margin: '2px 0 0',
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  skeletonWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '4px 0',
  },
  skeletonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    backgroundColor: '#090910',
    borderRadius: 10,
  },
  skeletonPos: {
    width: 14,
    height: 14,
    backgroundColor: '#1f1f2e',
    borderRadius: 4,
  },
  skeletonMeta: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  skeletonBar: (w) => ({
    width: w,
    height: 10,
    backgroundColor: '#1f1f2e',
    borderRadius: 4,
  }),
  noticeBox: {
    padding: '18px 14px',
    border: '1px dashed #2a2a3e',
    borderRadius: 10,
    textAlign: 'center',
    backgroundColor: '#090910',
  },
  noticeText: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.6,
    color: '#9ca3af',
  },
  errorBox: {
    padding: '14px',
    border: '1px solid #7f1d1d',
    borderRadius: 10,
    backgroundColor: '#200c0e',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    margin: 0,
    fontSize: 12,
    color: '#f87171',
    textAlign: 'center',
  },
  retryBtn: {
    background: 'none',
    border: '1px solid #ef4444',
    color: '#f87171',
    padding: '4px 14px',
    borderRadius: 16,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  queueBtn: {
    width: '100%',
    backgroundColor: '#1DB954',
    color: '#000',
    border: 'none',
    padding: '12px 0',
    borderRadius: 50,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  queueBtnCommitted: {
    backgroundColor: '#15803d',
    color: '#dcfce7',
    cursor: 'default',
  },
  queueBtnDisabled: {
    backgroundColor: '#243a29',
    color: '#6b7280',
    cursor: 'not-allowed',
  },
};

export default UpNextQueue;
