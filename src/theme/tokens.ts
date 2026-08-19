/**
 * Vybe design tokens.
 *
 * Dark-first, high-contrast, card-led — near-black ground, generously rounded
 * objects, and a single volt-lime accent that carries every active state. The
 * rules that keep it that way:
 *
 *   - **Objects float; the timeline does not.** Sheets, panels and hero
 *     surfaces are rounded cards on a dark ground. The feed is the exception
 *     and is deliberately so: posts are full-bleed rows divided by a hairline,
 *     because a card per post spends a gutter and a radius on every item in an
 *     infinite list and leaves less room for the post itself.
 *   - **One accent.** VOLT marks the active state, the user's own actions, and
 *     the one hero surface per screen. Everything else is a neutral step.
 *   - **Words lead, media follows.** In a row the author, then the text, then
 *     the picture — and the picture is shown whole at its own aspect ratio
 *     rather than cropped to a fixed box.
 *   - **Radii are large and consistent.** A card is 24–28; a control is a pill.
 *
 * Hierarchy comes from surface step and radius, not from borders. Borders are
 * reserved for controls that need an edge on top of media.
 */

export type ThemeName = 'dark' | 'light';

const RADIUS = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  /** The card radius. Everything object-shaped lands here. */
  xl: 24,
  /** Hero surfaces — the profile header, full-bleed media plates. */
  xxl: 28,
  pill: 999,
} as const;

/** 4/8pt rhythm. `gutter` is the single horizontal page inset. */
const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  gutter: 16,
} as const;

const ICON = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 30,
} as const;

/** Micro-interaction timings — kept inside the 150–300ms band. */
const DURATION = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 320,
  deliberate: 480,
} as const;

export const rule = {
  hair: 1,
  medium: 2,
  heavy: 3,
} as const;

const brand = {
  /** The accent. Bright enough to read at 12px on near-black. */
  volt: '#D2F34C',
  voltDeep: '#405F00',
  ember: '#FF5A1F',
  violet: '#8B5CF6',
  green: '#31D07A',
  amber: '#FFB020',
} as const;

export type Palette = {
  bg: string;
  /** One step up from the ground: search fields, inactive chips, meters. */
  bgSubtle: string;
  surface: string;
  /** Sheets, menus, anything that genuinely floats above the page. */
  surfaceElevated: string;
  surfacePressed: string;
  glassTint: string;
  glassBorder: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  onPrimary: string;
  onAccent: string;

  border: string;
  borderStrong: string;
  divider: string;

  primary: string;
  primaryDim: string;
  /**
   * The literal volt fill, identical in both themes.
   *
   * `primary` has to survive as a stroke and as small text, which volt does not
   * do on white — so in light mode `primary` darkens and `volt` stays put for
   * hero surfaces, where the pairing is always ink-on-volt.
   */
  volt: string;
  onVolt: string;
  accent: string;
  accentDim: string;
  ember: string;
  cyan: string;
  warning: string;
  danger: string;

  /** Chrome floating on top of media: a dark pill and its hairline. */
  overlay: string;
  overlayStrong: string;
  onOverlay: string;

  scrim: string;
  skeleton: string;
};

/** Near-black ground — OLED-friendly, and it makes the accent do the work. */
const dark: Palette = {
  bg: '#08090A',
  bgSubtle: '#17181C',
  surface: '#111214',
  surfaceElevated: '#1B1D21',
  surfacePressed: '#24272C',
  glassTint: 'rgba(12,13,15,0.88)',
  glassBorder: 'rgba(255,255,255,0.08)',

  text: '#F3F5F1',
  textSecondary: '#B4B9BE',
  textMuted: '#767C84',
  onPrimary: '#0C1000',
  onAccent: '#0C1000',

  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',
  divider: 'rgba(255,255,255,0.06)',

  primary: brand.volt,
  primaryDim: 'rgba(210,243,76,0.14)',
  volt: brand.volt,
  onVolt: '#12160A',
  accent: '#F3F5F1',
  accentDim: 'rgba(243,245,241,0.10)',
  ember: brand.ember,
  cyan: brand.green,
  warning: brand.amber,
  danger: '#FF4B4B',

  overlay: 'rgba(10,11,12,0.55)',
  overlayStrong: 'rgba(10,11,12,0.78)',
  onOverlay: '#FFFFFF',

  scrim: 'rgba(0,0,0,0.66)',
  skeleton: '#1B1D21',
};

const light: Palette = {
  bg: '#F4F5F1',
  bgSubtle: '#E9EBE4',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#E4E7DE',
  glassTint: 'rgba(255,255,255,0.90)',
  glassBorder: 'rgba(15,18,10,0.10)',

  text: '#12150E',
  textSecondary: '#3E443A',
  // 4.7:1 on the light ground — muted text still clears WCAG AA body contrast.
  textMuted: '#5F665A',
  onPrimary: '#FFFFFF',
  onAccent: '#FFFFFF',

  border: 'rgba(15,18,10,0.10)',
  borderStrong: 'rgba(15,18,10,0.22)',
  divider: 'rgba(15,18,10,0.07)',

  // Volt cannot carry a stroke or 12px text on a light ground, so the active
  // role darkens to the same hue family and the fill stays volt below.
  primary: brand.voltDeep,
  primaryDim: 'rgba(64,95,0,0.12)',
  volt: brand.volt,
  onVolt: '#12160A',
  accent: '#12150E',
  accentDim: 'rgba(18,21,14,0.06)',
  ember: '#D8410A',
  cyan: '#0E8C4B',
  warning: '#9A6A00',
  danger: '#C81E1E',

  overlay: 'rgba(10,11,12,0.55)',
  overlayStrong: 'rgba(10,11,12,0.78)',
  onOverlay: '#FFFFFF',

  scrim: 'rgba(0,0,0,0.45)',
  skeleton: '#E4E7DE',
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

/**
 * Topic and circle hues.
 *
 * Saturated enough to tell apart at 6px, dark enough that white sits on them,
 * and none of them within reach of the volt accent — a topic colour must never
 * be mistaken for an active state.
 */
export const inks = {
  slate: '#5B7C99',
  violet: brand.violet,
  sienna: '#D2691E',
  moss: '#4E9A51',
  oxblood: '#E0245E',
  plum: '#A855C7',
  verdigris: '#0FA98C',
  ochre: '#D99A00',
  steel: '#6B8CAE',
  terracotta: '#E06C3B',
  teal: '#00A3B4',
  stone: '#8A8F94',
} as const;

export const signal = {
  boost: brand.green,
  boostText: '#06210F',
  mute: brand.ember,
  muteText: '#FFFFFF',
  neutral: brand.volt,
} as const;

export const typography = {
  display: 'Outfit_700Bold',
  displayMedium: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  semibold: 'Outfit_600SemiBold',
  medium: 'Outfit_500Medium',
  regular: 'Outfit_400Regular',
  light: 'Outfit_300Light',
  mono: 'Outfit_500Medium',
  monoRegular: 'Outfit_400Regular',
} as const;

/**
 * Type scale. One geometric family, differentiated by weight and size.
 *
 * Outfit runs small for its point size and its round bowls need a touch more
 * leading than Inter did, so body is 15/22 and the display sizes carry tighter
 * tracking to stop the headline from opening up.
 */
export const type = {
  mega: { fontSize: 36, lineHeight: 40, fontFamily: typography.display, letterSpacing: -1.1 },
  hero: { fontSize: 29, lineHeight: 33, fontFamily: typography.display, letterSpacing: -0.8 },
  title: { fontSize: 24, lineHeight: 29, fontFamily: typography.bold, letterSpacing: -0.6 },
  heading: { fontSize: 19, lineHeight: 24, fontFamily: typography.bold, letterSpacing: -0.35 },
  subheading: { fontSize: 16, lineHeight: 21, fontFamily: typography.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: typography.regular, letterSpacing: -0.05 },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontFamily: typography.semibold, letterSpacing: -0.05 },
  callout: { fontSize: 15, lineHeight: 22, fontFamily: typography.regular, letterSpacing: -0.05 },
  label: { fontSize: 14, lineHeight: 18, fontFamily: typography.semibold, letterSpacing: -0.05 },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: typography.regular },
  micro: { fontSize: 12, lineHeight: 15, fontFamily: typography.medium },
  numeric: { fontSize: 13, lineHeight: 17, fontFamily: typography.semibold },
} as const;

export const radius = RADIUS;
export const space = SPACE;
export const iconSize = ICON;
export const duration = DURATION;

/** Alpha suffix for a hex colour, so call sites stop hand-rolling them. */
export const alpha = (hex: string, a: number) =>
  hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/** Reanimated spring configs, tuned to feel native rather than bouncy-toy. */
export const spring = {
  gentle: { damping: 18, stiffness: 180, mass: 0.9 },
  snappy: { damping: 22, stiffness: 320, mass: 0.7 },
  loose: { damping: 12, stiffness: 110, mass: 1.1 },
} as const;

/**
 * Cards genuinely sit above the ground now, so they cast one.
 *
 * Kept wide and low-opacity: on a near-black ground the shadow reads as a
 * softening of the edge rather than as a drop shadow.
 */
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  float: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
} as const;
