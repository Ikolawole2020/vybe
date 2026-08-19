import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback, with no dependency on anything that renders.
 *
 * This lived in `components/ui/index.tsx`, and `useAuth` imported it from
 * there — a *store* reaching into the UI barrel for one function. That single
 * edge is what closed every require cycle Metro was warning about:
 *
 *   ThemeProvider → useVybe → useAuth → components/ui → FollowListModal
 *     → ThemeProvider
 *
 * "Require cycles are allowed, but can result in uninitialized values" is worth
 * taking seriously here rather than filing as noise. In a cycle, whichever
 * module Metro evaluates first sees the others' exports as `undefined`, and the
 * order is decided by whatever imported what first — so it changes when an
 * unrelated screen adds an import. Two separate crashes in this codebase have
 * been a binding that was undefined at module-evaluation time.
 *
 * The dependency direction that avoids all of it is the ordinary one: a leaf
 * utility with no imports of its own, which anything may depend on and which
 * depends on nothing. `components/ui` re-exports it, so every existing call
 * site is unchanged.
 */

export type HapticKind = 'light' | 'medium' | 'heavy' | 'select' | 'success' | 'warning' | 'none';

export function haptic(kind: HapticKind = 'light') {
  try {
    switch (kind) {
      case 'none':
        return;
      case 'select':
        Haptics.selectionAsync().catch(() => {});
        return;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        return;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        return;
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        return;
      default:
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        return;
    }
  } catch {
    // Graceful no-op on platforms and emulators without haptics.
  }
}
