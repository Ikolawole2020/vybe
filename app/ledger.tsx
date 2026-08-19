import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { Glass } from '@/components/glass/Glass';
import { Icon, Touchable, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useVybe } from '@/store/useVybe';
import type { AlgoLedgerEntry } from '@/data/types';

const SOURCE_META: Record<AlgoLedgerEntry['source'], { label: string; glyph: string }> = {
  panel: { label: 'Panel', glyph: 'sliders' },
  genome: { label: 'Genome', glyph: 'target' },
  'dear-algo': { label: '@my_algo', glyph: 'cpu' },
  receipt: { label: 'Receipt', glyph: 'file-text' },
  mode: { label: 'Temporary mode', glyph: 'clock' },
  system: { label: 'System', glyph: 'settings' },
};

/**
 * The algorithm ledger — an append-only, reversible history of every change
 * made to the feed. It is the audit trail that makes "you control the
 * algorithm" checkable rather than merely claimed.
 */
export default function LedgerScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const ledger = useVybe((s) => s.ledger);
  const undoLedger = useVybe((s) => s.undoLedger);

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura intensity={0.6} />
      <ScrollView
        contentContainerStyle={{
          // See the note in `app/compose.tsx` — edge-to-edge means the status
          // bar sits over this, so the heading needs to start below it.
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.base,
          gap: space.base,
        }}
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <VText variant="title">Algorithm ledger</VText>
            <VText variant="caption" muted style={{ marginTop: 2 }}>
              Everything that has ever changed your feed, in order, each one reversible.
            </VText>
          </View>
          <Touchable onPress={() => goBack()} feedback="light" hitSlop={10} accessibilityLabel="Close">
            <Icon name="x" size={22} color={c.text} />
          </Touchable>
        </View>

        {ledger.length === 0 ? (
          <Glass variant="clear" radius={radius.lg} style={styles.empty}>
            <Icon name="file-text" size={22} color={c.textMuted} />
            <VText variant="callout" muted style={{ textAlign: 'center' }}>
              Nothing yet. Move a slider, drag a topic in the Genome, or reply to a post with
              @my_algo, and it will be recorded here.
            </VText>
          </Glass>
        ) : null}

        {ledger.map((e) => {
          const meta = SOURCE_META[e.source];
          return (
            <Animated.View
              key={e.id}
              layout={LinearTransition.springify().damping(20)}
              style={[
                styles.row,
                {
                  backgroundColor: c.surface,
                  borderColor: e.undone ? c.border : c.borderStrong,
                  opacity: e.undone ? 0.55 : 1,
                },
              ]}
            >
              <View style={[styles.badge, { backgroundColor: c.bgSubtle, borderColor: c.border }]}>
                <Icon name={meta.glyph as any} size={14} color={c.accent} />
              </View>

              <View style={{ flex: 1, gap: 3 }}>
                <VText
                  variant="callout"
                  style={e.undone ? { textDecorationLine: 'line-through' } : undefined}
                >
                  {e.summary}
                </VText>
                <VText variant="micro" muted style={{ letterSpacing: 0 }}>
                  {meta.label} · {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {e.undone ? ' · undone' : ''}
                </VText>
              </View>

              {!e.undone ? (
                <Touchable
                  onPress={() => undoLedger(e.id)}
                  feedback="medium"
                  accessibilityLabel={`Undo: ${e.summary}`}
                  style={[styles.undo, { borderColor: c.borderStrong }]}
                >
                  <Icon name="rotate-ccw" size={13} color={c.text} />
                </Touchable>
              ) : null}
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.sm },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  undo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
