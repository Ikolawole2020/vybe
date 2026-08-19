import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The verified badge, drawn rather than borrowed.
 *
 * It was a plain filled circle with a tick in it, which reads as a checkbox —
 * the scalloped rosette is what everyone has been trained to recognise as "this
 * account is what it says it is", and the shape is doing the work, not the
 * tick.
 *
 * The artwork is generated here rather than copied from any platform's icon
 * set: theirs are trademarks, and a badge is exactly the kind of mark where
 * borrowing the artwork is passing off. The lobes are ours, and so is the
 * colour — volt with the dark tick, which is the same pairing every other
 * accent surface in the app uses.
 */
export function VerifiedBadge({ size = 16, color }: { size?: number; color?: string }) {
  const { c } = useTheme();

  // The rosette: outer points joined by quadratic curves that dip to an inner
  // radius between them, so each lobe is a smooth scallop rather than a spike.
  const path = useMemo(() => scallop(12, 12, 11.4, 9.5, 9), []);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Verified account">
      <Path d={path} fill={color ?? c.volt} />
      <Path
        d="M7.6 12.3 L10.6 15.2 L16.5 9.1"
        stroke={c.onVolt}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** A closed scalloped ring: `lobes` bumps between radius `r` and `R`. */
function scallop(cx: number, cy: number, R: number, r: number, lobes: number): string {
  const step = (Math.PI * 2) / lobes;
  const at = (radius: number, angle: number) =>
    [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;

  // Start at the first outer point, then curve to each next one, pulling the
  // control point out beyond the tip so the lobe stays round.
  const [sx, sy] = at(R, -Math.PI / 2);
  let d = `M ${sx.toFixed(2)} ${sy.toFixed(2)}`;

  for (let i = 1; i <= lobes; i++) {
    const a = -Math.PI / 2 + i * step;
    const mid = a - step / 2;
    // Control radius derived from the inner radius: the further `r` is below
    // `R`, the deeper the notch between two lobes.
    const [qx, qy] = at(r * 0.72 + R * 0.28, mid);
    const [px, py] = at(R, a);
    d += ` Q ${qx.toFixed(2)} ${qy.toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)}`;
  }

  return `${d} Z`;
}
