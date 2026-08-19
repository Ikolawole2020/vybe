import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { isFaceBiometry, type BiometryType } from '@/services/biometrics';

/**
 * The face-scan glyph, or a fingerprint, depending on what the handset has.
 *
 * A face on a button that is about to raise a fingerprint prompt is a small
 * lie, and on Android it is the common case — see `labelFor` in
 * `services/biometrics.ts`.
 */
export function BiometryIcon({
  size = 22,
  color = '#FFFFFF',
  type = 'Biometrics',
}: {
  size?: number;
  color?: string;
  type?: BiometryType;
}) {
  return isFaceBiometry(type) ? (
    <FaceScan size={size} color={color} />
  ) : (
    <Fingerprint size={size} color={color} />
  );
}

function FaceScan({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 4 Outer Scan Corners */}
      <Path
        d="M3 7V5C3 3.89543 3.89543 3 5 3H7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 3H19C20.1046 3 21 3.89543 21 5V7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M21 17V19C21 20.1046 20.1046 21 19 21H17"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7 21H5C3.89543 21 3 20.1046 3 19V17"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Eyes */}
      <Path d="M8.5 9.5V10.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M15.5 9.5V10.5" stroke={color} strokeWidth="2" strokeLinecap="round" />

      {/* Nose */}
      <Path
        d="M12 11.5V14H13"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Smile */}
      <Path
        d="M8.5 16.5C9.5 17.8 14.5 17.8 15.5 16.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Concentric ridges, drawn open at the sides so they read as a print. */
function Fingerprint({ size, color }: { size: number; color: string }) {
  const common = {
    stroke: color,
    strokeWidth: '1.7',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 10.5v3.2a8 8 0 0 0 .6 3.1" {...common} />
      <Path d="M8.9 12a3.1 3.1 0 0 1 6.2 0v2a9 9 0 0 0 .5 3" {...common} />
      <Path d="M5.9 12a6.1 6.1 0 0 1 12.2 0v2c0 1 .1 2 .4 2.9" {...common} />
      <Path d="M9 19.6A11 11 0 0 1 8.4 16v-4a3.6 3.6 0 0 1 .3-1.5" {...common} />
      <Path d="M3.6 9.6a9.1 9.1 0 0 1 8.4-5.6 9 9 0 0 1 5.1 1.6" {...common} />
      <Path d="M5.6 16.4A9 9 0 0 1 5.3 14" {...common} />
    </Svg>
  );
}
