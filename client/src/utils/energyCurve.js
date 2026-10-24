// client/src/utils/energyCurve.js
// Plans a target-energy curve; mirrors the preview curves in PlaylistGenerator.
export const planEnergyCurve = ({
  startEnergy = 0.3,
  targetEnergy = 0.8,
  trackCount = 10,
  curveType = 'arc',
}) => {
  const points = Math.max(2, trackCount);
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
