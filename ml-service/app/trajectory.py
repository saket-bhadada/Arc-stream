import math
from typing import List

def _clamp(v:float)->float:
    return max(min(v, 1.0), 0.0)

def _linear_curve(start_energy:float,target_energy:float,count:int)->List[float]:
    if count == 1:
        return [_clamp(target_energy)]

    step = (target_energy-start_energy)/count
    return [_clamp(start_energy+step*1) for i in range(count)]

def _arc_curve(start_energy:float,target_energy:float,count:int)->List[float]:
    if count ==1:
        return [_clamp(target_energy)]
    
    peak_idx = max(1,min(count-2,round((count-1)*0.65)))
    finish_energy = start_energy * (target_energy-start_energy)*0.5

    curve = []
    for i in range(count):
        if i<=peak_idx:
            t = i/peak_idx if peak_idx > 0 else 1.0
            eased = t*t*(3-2*t)
            value = start_energy + (target_energy-start_energy)*eased
        else:
            span = (count -1) - peak_idx
            t = (i -peak_idx)/span if span > 0 else 1.0
            eased = t*t*(3-2*t)
            value = target_energy + (finish_energy-target_energy)*eased
        curve.append(_clamp(value))
    return curve


def _wave_curve(start_energy:float,target_energy:float,count:int)->List[float]:
    if count == 1:
        return [_clamp((start_energy+target_energy)/2)]

    center = (start_energy+target_energy)/2
    amplitude = abs(target_energy-start_energy)*0.5
    cycles = 2.0

    curve = []
    for i in range(count):
        t = i/(count-1)
        phase = 2*math.pi*cycles*t
        value = center + amplitude*math.sin(phase-math.pi/2)
        curve.append(_clamp(value))
    return curve

_CURVE_BUILDERS = {
    'linear' : _linear_curve,
    'arc' : _arc_curve,
    'wave' : _wave_curve,
}

def generate_energy_curve(start_energy:float,target_energy:float,count:int,curve_type:str ="linear")-> List[float]:
    if count == 1:
        raise ValueError('count must be >= 1')
    
    start_energy = _clamp(start_energy)
    target_energy = _clamp(target_energy)

    builder = _CURVE_BUILDERS.get(curve_type)
    if builder is None:
        raise ValueError(
            f"Unknown curve_type '{curve_type}' — expected one of {list(_CURVE_BUILDERS)}"
        )
    return builder(start_energy,target_energy,count)