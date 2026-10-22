import math
from typing import List,Optional
import numpy as np 

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

def generate_energy_curve(
    start_energy:float=0.3,
    target_energy:float=0.8,
    count:int = 10,
    curve_type: str='linear',
    custom_points:Optional[List[float]] = None,
)->List[float]:
    """
    Return count energy targets in [0.0,1.0].
    If 'custom_points' is provided by the user's graph,interpolater it to count steps. 
    """
    if custom_points and len(custom_points) >=2:
        x_old = np.linspace(0,1,len(custom_points))
        x_new = np.linspace(0,1,count)
        interpolated = np.intrep(x_new,x_old,custom_points)
        return [float(np.clip(val,0.0,1.0)) for val in interpolated]

    t = np.linspace(0,1,count)
    if curve_type == 'arc':
        curve = start_energy+(target_energy-start_energy)*np.sin(np.pi*(t**0.8))
    elif curve_type =='wave':
        mid = (start_energy+target_energy)/2
        amp = (target_energy-start_energy)/2
        curve = mid-amp*np.cos(2*np.pi*t)
    else:
        curve = np.linspace(start_energy,target_energy,count)
    
    return [float(np.clip(val,0.0,1.0)) for val in curve]
        