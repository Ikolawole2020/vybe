import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding for a composer bar that sits at the foot of the screen.
 *
 * Two different things want space down there and only one of them is present at
 * a time. With the keyboard down, the bar has to clear the home indicator or the
 * gesture pill — that is `insets.bottom`. With the keyboard up, the keyboard is
 * occupying that band itself, and keeping the inset stacks a second empty strip
 * on top of it: the send button drifts up away from the keyboard and the field
 * looks detached from what you are typing on.
 *
 * So it is one or the other, never both.
 */
export function useComposerInset(base = 0): number {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((s) => s.isVisible);
  return keyboardVisible ? base : base + insets.bottom;
}
