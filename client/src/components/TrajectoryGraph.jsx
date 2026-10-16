// client/src/components/TrajectoryGraph.jsx
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { planEnergyCurve } from '../utils/energyCurve';

const clampCount = (n) => Math.min(30, Math.max(5, Math.round(n)));
const round3 = (x) => Math.round(x * 1000) / 1000;

const accuracy = (mae) => {
  if (mae < 0.05) return { label: 'Tight match', color: '#1ED760' };
  if (mae < 0.12) return { label: 'Close match', color: '#F5C518' };
  return                 { label: 'Loose match', color: '#FF6B6B' };
};

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={styles.tip}>
      <div style={styles.tipTitle}>
        Track {label}{row.name ? ` · ${row.name}` : ''}
      </div>
      {row.artists && <div style={styles.tipMuted}>{row.artists}</div>}
      <div>Planned: {row.planned.toFixed(3)}</div>
      {row.engineTarget !== undefined && <div>Engine target: {row.engineTarget.toFixed(3)}</div>}
      {row.actual !== undefined && <div style={{ color: '#00F0FF' }}>Actual: {row.actual.toFixed(3)}</div>}
    </div>
  );
};

const TrajectoryGraph = ({
  startEnergy = 0.3,
  targetEnergy = 0.8,
  trackCount = 10,
  curveType = 'arc',
  generatedTracks,
}) => {
  const planned = planEnergyCurve({
    startEnergy, targetEnergy, trackCount: clampCount(trackCount), curveType,
  });

  const rows = planned.map((p, i) => {
    const t = generatedTracks?.[i];
    return {
      step: i + 1,
      planned: round3(p),
      engineTarget: Number.isFinite(t?.target_energy) ? t.target_energy : undefined,
      actual: Number.isFinite(t?.actual_energy) ? t.actual_energy : undefined,
      name: t?.track_name ?? t?.name,
      artists: t?.artists,
    };
  });

  // Accuracy = how far each retrieved track landed from what the engine was
  // asked for (its own target_energy), falling back to the planned curve.
  const deviations = rows
    .filter((r) => r.actual !== undefined)
    .map((r) => Math.abs(r.actual - (r.engineTarget ?? r.planned)));
  const mae = deviations.length ? deviations.reduce((a, b) => a + b, 0) / deviations.length : null;
  const acc = mae !== null ? accuracy(mae) : null;
  const hasActual = deviations.length > 0;

  return (
    <div style={styles.wrap}>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
          <CartesianGrid stroke="#282828" strokeDasharray="3 3" />
          <XAxis dataKey="step" tick={{ fill: '#B3B3B3', fontSize: 10 }} stroke="#282828" />
          <YAxis
            domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]}
            tick={{ fill: '#B3B3B3', fontSize: 10 }} stroke="#282828"
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#B3B3B3' }} />
          <Area
            type="monotone" dataKey="planned" name="Planned curve"
            stroke="#1DB954" strokeWidth={2} strokeDasharray="6 4"
            fill="rgba(29, 185, 84, 0.15)" dot={{ r: 2, fill: '#1DB954' }}
          />
          {hasActual && (
            <Line
              type="monotone" dataKey="actual" name="Actual (retrieved tracks)"
              stroke="none" connectNulls={false} isAnimationActive={false}
              dot={{ r: 5, fill: '#00F0FF', stroke: '#121212', strokeWidth: 1 }}
              activeDot={{ r: 7 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {acc && (
        <div style={{ ...styles.badge, color: acc.color, borderColor: acc.color }}>
          Mean deviation: {mae.toFixed(3)} • {acc.label}
        </div>
      )}
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' },
  badge: {
    border: '1px solid', borderRadius: 20, padding: '6px 14px',
    fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
  },
  tip: {
    background: '#181818', border: '1px solid #282828', borderRadius: 8,
    padding: '8px 12px', fontSize: 12, color: '#FFFFFF', textAlign: 'left',
  },
  tipTitle: { fontWeight: 700, marginBottom: 2 },
  tipMuted: { color: '#B3B3B3', marginBottom: 4 },
};

export default TrajectoryGraph;
