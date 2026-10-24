// client/src/components/QueueTray.jsx
// Displays upcoming predicted tracks and recent session history.
const QueueTray = ({ sessionHistory = [], upcomingQueue = [], currentEnergy, currentTrackId }) => (
  <div style={styles.wrap}>
    <span style={styles.label}>
      UP NEXT · {upcomingQueue.length}
      {Number.isFinite(currentEnergy) && ` · now ${currentEnergy.toFixed(2)}`}
    </span>
    <ul style={styles.list}>
      {upcomingQueue.length === 0 && <li style={styles.empty}>Queue is empty</li>}
      {upcomingQueue.map((t, i) => (
        <li key={`${t.track_id}-${i}`} style={styles.item}>
          <div style={styles.name}>{t.track_name || t.track_id}</div>
          <div style={styles.artist}>{t.artists}</div>
        </li>
      ))}
    </ul>

    <span style={styles.label}>HISTORY · {sessionHistory.length}</span>
    <ul style={styles.list}>
      {sessionHistory.length === 0 && <li style={styles.empty}>Nothing played yet</li>}
      {sessionHistory.map((t) => (
        <li
          key={t.id}
          style={{ ...styles.item, ...(t.id === currentTrackId ? styles.current : null) }}
        >
          <div style={styles.name}>{t.name}</div>
          <div style={styles.artist}>{t.artists}</div>
        </li>
      ))}
    </ul>
  </div>
);

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflowY: 'auto' },
  label: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#B3B3B3' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  item: { background: '#181818', border: '1px solid #282828', borderRadius: 8, padding: '8px 10px', textAlign: 'left' },
  current: { borderColor: '#1DB954' },
  name: { fontSize: 13, fontWeight: 600, color: '#FFFFFF' },
  artist: { fontSize: 11, color: '#B3B3B3' },
  empty: { fontSize: 12, color: '#B3B3B3' },
};

export default QueueTray;
