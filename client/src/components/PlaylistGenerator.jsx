import { useMemo, useState } from "react";
import { usePlayerStore } from "../stores/usePlayerStore";

const NODE_BASE = import.meta.env.VITE_NODE_BASE || "http://localhost:3000";
const previewCurve = (startEnergy,targetEnergy,curveType,points = 24) => {
    const out = [];
    for(let i=0;i<points;i++) {
        const t = i/(points-1);
        let v;
        if(curveType=='linear') {
            v = startEnergy+(targetEnergy-startEnergy)*t;
        } else if(curveType == 'arc') {
            const peak = 0.65;
            if(t<=peak) {
                const localT = t / peak;
                const eased = localT*localT*(3-2*localT);
                v = startEnergy+(targetEnergy-startEnergy)*eased;
            } else {
                const finish = startEnergy+(targetEnergy-startEnergy)*0.5;
                const localT = (t-peak)/(1-peak);
                const eased = localT*localT*(3-2*localT);
                v = finish+(targetEnergy-finish)*eased;
            }
        } else {
            const center = (startEnergy+targetEnergy)/2;
            const amplitude = Math.abs(targetEnergy-startEnergy)/2;
            v = center + amplitude*Math.sin(2*Math.PI*2*t-Math.PI/2);
        }
        out.push(Math.max(0,Math.min(1,v)));
    }
    return out;
};

const CURVE_TYPES = [
    {
        id:'linear',
        label:'Linear',
        glyph: (color)=>(
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
    }
];

const TRACK_COUNT_PRESETS = [5,10,15,20];

const CurvePreview = ({startEnergy,targetEnergy,curveType})=>{
    const points = useMemo(
        ()=>previewCurve(startEnergy, targetEnergy, curveType),
        [startEnergy, targetEnergy, curveType]
    );
    const width = 100;
    const height = 100;
    const path = points.map()
}

export default function PlaylistGenerator() {
    const playTracks = usePlayerStore(s => s.playTracks);
}