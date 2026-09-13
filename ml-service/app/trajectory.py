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
            