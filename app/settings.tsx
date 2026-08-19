import React, { useEffect, useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { Row } from '@/components/ui/Surface';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHead } from '@/components/ui/ScreenTitle';
import { Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { useAuthor, useVybe } from '@/store/useVybe';
import { fetchProfilesByIds } from '@/services/db';
import { useAuth } from '@/store/useAuth';

/**
 * Everything Profile used to carry.
 *
 * Profile is now the three content tabs, which is what a profile is for. The
 * settings did not stop existing — they stopped competing with the posts.
 */
export default function SettingsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const themePreference = useVybe((s) => s.themePreference);
  const handle = useVybe((s) => s.profile.handle);
  const email = useAuth((s) => s.user?.email);
  const signOut = useAuth((s) => s.signOut);
  const forgetDevice = useAuth((s) => s.forgetDevice);
  const setThemePreference = useVybe((s) => s.setThemePreference);
  const circles = useVybe((s) => s.circles);
  const replayTour = useVybe((s) => s.replayTour);

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <Reveal index={0} style={{ paddingHorizontal: space.gutter, gap: space.md }}>
          <Touchable
            onPress={() => goBack()}
            feedback="light"
            hitSlop={10}
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
            <VText variant="label" secondary>
              You
            </VText>
          </Touchable>
          <VText variant="hero">Settings</VText>
        </Reveal>

        <Reveal index={1}>
          <SectionHead label="You" note="Your name, nickname and picture" />
          <SettingRow
            glyph="user"
            label="Edit profile"
            hint="Change your display name, your @nickname, your bio and your picture."
            onPress={() => router.push('/edit-profile')}
          />
          <SettingRow
            glyph="user-plus"
            label="Add people"
            hint="Find someone by name or nickname and put them in a circle."
            onPress={() => router.push('/people')}
            last
          />
        </Reveal>

        <Reveal index={2} style={{ paddingHorizontal: space.gutter, gap: space.md }}>
          <SectionHead flush label="Appearance" />
          <View style={styles.themeRow}>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Chip
                key={t}
                label={t}
                glyph={t === 'system' ? 'smartphone' : t === 'dark' ? 'moon' : 'sun'}
                active={themePreference === t}
                onPress={() => setThemePreference(t)}
              />
            ))}
          </View>
        </Reveal>

        <Reveal index={3}>
          <SectionHead label="Circles" note="Who sees what, and who gets to reply" />
          <SettingRow
            glyph="users"
            label="Manage circles"
            hint={`${circles.length} circles. Tap to add people or change how much each one counts.`}
            onPress={() => router.push('/circles')}
            last
          />
        </Reveal>

        <Reveal index={4}>
          <SectionHead label="Getting around" />
          <SettingRow
            glyph="compass"
            label="Take the tour again"
            hint="A quick walk through how Vybe ranks, explains and forgets."
            onPress={replayTour}
            last
          />
        </Reveal>

        <AdjustedPeople />

        <Reveal index={6}>
          <SectionHead label="This account" note={email ? `Signed in as ${email}` : handle ? `Signed in as @${handle}` : undefined} />
          <SettingRow
            glyph="log-out"
            label="Sign out"
            hint="Ends this session. Biometric sign-in will still work on this phone."
            onPress={() => {
              haptic('light');
              void signOut();
            }}
          />
          {/*
            The counterpart to a local sign-out, and the one that matters if the
            handset is being sold, lent, or has been lost. Sign-out leaves the
            saved credentials in the Keychain so biometric sign-in keeps working;
            this deletes them and ends every other session too. Without a second
            row the two behaviours cannot both exist, and only one of them is
            safe to be the default.
          */}
          <SettingRow
            glyph="shield-off"
            label="Sign out and forget this device"
            hint="Also deletes the saved sign-in and signs you out everywhere. Use this on a phone you are giving up."
            onPress={() => {
              haptic('warning');
              Alert.alert(
                'Forget this device?',
                'You will be signed out of Vybe on every device, and biometric sign-in will need setting up again.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Forget',
                    style: 'destructive',
                    onPress: () => void forgetDevice(),
                  },
                ],
              );
            }}
            last
          />
        </Reveal>
      </ScrollView>
      <TopScrim />
    </View>
  );
}

/**
 * People you have turned up or down.
 *
 * Every "show me more of them" and every "less from them" on a receipt writes a
 * weight that then applies to their posts forever, and until now nothing
 * anywhere listed them — the adjustments piled up invisibly and could only be
 * undone by finding the person again. This is where they can be seen and
 * removed.
 */
function AdjustedPeople() {
  const authorWeights = useVybe((s) => s.algo.authorWeights);
  const cacheAuthors = useVybe((s) => s.cacheAuthors);

  const adjusted = useMemo(
    () =>
      Object.entries(authorWeights)
        .filter(([, w]) => Math.abs(w) > 0.02)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])),
    [authorWeights],
  );

  // The people involved are often not in the feed you have loaded — you may
  // have turned someone down precisely so they stopped appearing in it.
  useEffect(() => {
    const ids = adjusted.map(([id]) => id);
    if (!ids.length) return;
    const known = useVybe.getState().authors;
    const missing = ids.filter((id) => !known[id]);
    if (!missing.length) return;
    let live = true;
    void fetchProfilesByIds(missing).then((found) => {
      if (live) cacheAuthors(found);
    });
    return () => {
      live = false;
    };
  }, [adjusted, cacheAuthors]);

  if (!adjusted.length) return null;

  return (
    <Reveal index={6}>
      <SectionHead
        label="People you have adjusted"
        note="Tap to undo. Their posts go back to being scored like anyone else's."
      />
      {adjusted.map(([id, weight], i) => (
        <AdjustedRow key={id} id={id} weight={weight} last={i === adjusted.length - 1} />
      ))}
    </Reveal>
  );
}

function AdjustedRow({ id, weight, last }: { id: string; weight: number; last: boolean }) {
  const author = useAuthor(id);
  const nudgeAuthor = useVybe((s) => s.nudgeAuthor);
  const up = weight > 0;

  return (
    <SettingRow
      glyph={up ? 'trending-up' : 'trending-down'}
      label={author?.name || (author?.handle ? `@${author.handle}` : 'Someone you adjusted')}
      hint={up ? 'You asked to see more of them.' : 'You asked to see less of them.'}
      onPress={() => {
        haptic('light');
        // Back to zero, which is "scored like anyone else" rather than "muted".
        nudgeAuthor(id, -weight, 'panel');
      }}
      last={last}
    />
  );
}

function SettingRow({
  glyph,
  label,
  hint,
  onPress,
  last,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  label: string;
  hint?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Row
      last={last}
      ruleInset={space.gutter}
      onPress={onPress ?? (() => {})}
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <View style={styles.row}>
        <Icon name={glyph} size={17} color={c.textSecondary} />
        <View style={{ flex: 1, gap: 2 }}>
          <VText variant="bodyMedium">{label}</VText>
          {hint ? (
            <VText variant="caption" muted>
              {hint}
            </VText>
          ) : null}
        </View>
        <Icon name="chevron-right" size={16} color={c.textMuted} />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  themeRow: { flexDirection: 'row', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
});
