// client/src/components/VectorRadarChart.jsx
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, Tooltip, Legend,
} from 'recharts';

// Must match FEATURE_COLS order in ml_service/app/config.py
const AXES = ['Danceability', 'Energy', 'Key', 'Loudness', 'Mode', 'Tempo', 'Valence'];

const CYAN  = '#00F0FF';
const GREEN = '#1ED760';

const isVec7  = (v) => Array.isArray(v) && v.length === 7 && v.every(Number.isFinite);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const euclidean = (a, b) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0));

// Heuristic tiers; the max possible distance in the 7D unit cube is ~2.65.
const affinity = (d) => {
  if (d < 0.15) return { label: 'High Acoustic Affinity', color: GREEN };
  if (d < 0.4)  return { label: 'Moderate Affinity',      color: '#F5C518' };
  return           { label: 'Low Affinity — Big Jump',    color: '#FF6B6B' };
};

const VectorRadarChart = ({ currentTrackVector, predictedVector }) => {
  const hasCurrent   = isVec7(currentTrackVector);
  const hasPredicted = isVec7(predictedVector);

  if (!hasCurrent && !hasPredicted) {
    return <p style={styles.empty}>No vector data yet — play a track from the catalogue.</p>;
  }

  // Clamped for display only (the LSTM's tanh head can overshoot [0,1] slightly);
  // the distance below uses the raw values.
  const data = AXES.map((axis, i) => ({
    axis,
    current:   hasCurrent   ? clamp01(currentTrackVector[i]) : null,
    predicted: hasPredicted ? clamp01(predictedVector[i])    : null,
  }));

  const distance = hasCurrent && hasPredicted ? euclidean(currentTrackVector, predictedVector) : null;
  const fit = distance !== null ? affinity(distance) : null;

  return (
    <div style={styles.wrap}>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#282828" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: '#B3B3B3', fontSize: 11 }} />
          <PolarRadiusAxis
            angle={90} domain={[0, 1]} tickCount={5}
            tick={{ fill: '#B3B3B3', fontSize: 10 }} axisLine={false}
          />
          {hasCurrent && (
            <Radar
              name="Current Track" dataKey="current"
              stroke={CYAN} strokeWidth={2}
              fill="rgba(0, 240, 255, 0.4)" fillOpacity={1}
            />
          )}
          {hasPredicted && (
            <Radar
              name="AI Prediction (ẑ)" dataKey="predicted"
              stroke={GREEN} strokeWidth={2}
              fill="rgba(30, 215, 96, 0.5)" fillOpacity={1}
            />
          )}
          <Tooltip
            formatter={(v) => Number(v).toFixed(3)}
            contentStyle={{ background: '#181818', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#FFFFFF' }}
            itemStyle={{ color: '#B3B3B3' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#B3B3B3' }} />
        </RadarChart>
      </ResponsiveContainer>

      {fit ? (
        <div style={{ ...styles.badge, color: fit.color, borderColor: fit.color }}>
          Euclidean Fit: {distance.toFixed(3)} • {fit.label}
        </div>
      ) : (
        <div style={styles.badgeMuted}>
          {hasPredicted ? 'Current track not in catalogue' : 'Waiting for first AI prediction'}
        </div>
      )}
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' },
  empty: { margin: 0, padding: '60px 0', color: '#B3B3B3', fontSize: 13, textAlign: 'center' },
  badge: {
    border: '1px solid', borderRadius: 20, padding: '6px 14px',
    fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
  },
  badgeMuted: { color: '#B3B3B3', fontSize: 12, fontFamily: 'monospace' },
};

export default VectorRadarChart;
