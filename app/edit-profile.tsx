import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import * as ImagePicker from 'expo-image-picker';
import { AmbientAura } from '@/components/AmbientAura';
import { Field, Notice } from '@/components/ui/Field';
import { Reveal } from '@/components/ui/Reveal';
import { Avatar, Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { useVybe } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';
import { uploadImage } from '@/services/db';

/** Matches the `handle_format` constraint in the database, deliberately. */
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export default function EditProfileScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const profile = useVybe((s) => s.profile);
  const setProfile = useVybe((s) => s.setProfile);

  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOk = HANDLE_RE.test(handle);
  const ready = name.trim().length > 0 && handleOk && !saving;

  // The profile arrives from the server a moment after this screen can open, so
  // the fields are seeded again the first time it lands rather than staying on
  // whatever was in the store at mount.
  useEffect(() => {
    if (!profile.id) return;
    setName((v) => v || profile.name);
    setHandle((v) => v || profile.handle);
    setBio((v) => v || profile.bio);
    setAvatar((v) => v || profile.avatar);
  }, [profile]);

  const pickAvatar = async () => {
    haptic('light');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (res.canceled) return;
    setAvatar(res.assets[0].uri);
  };

  const save = async () => {
    const uid = useAuth.getState().user?.id;
    if (!uid || saving) return;

    setSaving(true);
    setError(null);

    // A freshly picked picture is a local file until it is in the bucket, and
    // the profile must not record a `file://` path that only this phone can
    // open.
    let avatarUrl = avatar;
    if (avatar && !avatar.startsWith('http')) {
      const uploaded = await uploadImage('avatars', uid, avatar);
      if (!uploaded) {
        setSaving(false);
        setError('Could not upload that picture. Check your connection and try again.');
        return;
      }
      avatarUrl = uploaded;
    }

    const message = await setProfile({
      name: name.trim(),
      handle: handle.trim(),
      bio: bio.trim(),
      avatar: avatarUrl,
    });

    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    haptic('success');
    goBack();
  };

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      {/*
        Aware, not merely avoiding: this scrolls the focused field into view.
        See the note on `KeyboardProvider` in `app/_layout.tsx`.

        These two lines were `//` comments written directly into the JSX, where
        `//` is not a comment — it is text. So this View had two string children
        and React Native refused to render them, which is why saving a profile
        failed on Android with "Text strings must be rendered within a <Text>
        component" instead of saving anything.
      */}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.gutter,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Reveal index={0} style={{ gap: space.md }}>
          <Touchable
            onPress={() => goBack()}
            feedback="light"
            hitSlop={10}
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
            <VText variant="label" secondary>
              Settings
            </VText>
          </Touchable>
          <VText variant="hero">Edit profile</VText>
        </Reveal>

        <Reveal index={1} style={{ alignItems: 'center', gap: space.sm }}>
          <Touchable
            onPress={pickAvatar}
            feedback="light"
            accessibilityLabel="Change your profile picture"
          >
            <Avatar uri={avatar} size={96} />
            <View style={[styles.camera, { backgroundColor: c.volt, borderColor: c.bg }]}>
              <Icon name="camera" size={15} color={c.onVolt} />
            </View>
          </Touchable>
          <VText variant="caption" muted>
            Tap to change your picture
          </VText>
        </Reveal>

        <Reveal index={2} style={{ gap: space.base }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="What people will see"
            autoCapitalize="words"
            hint="Your display name. Change it as often as you like."
          />
          <Field
            label="Nickname"
            value={handle}
            // Handles are lower-case and punctuation-free everywhere they are
            // shown, so they are normalised on the way in rather than
            // rejected after the fact.
            onChangeText={(t) => setHandle(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="yourname"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            hint="This is how people find you. Letters, numbers and underscores, 3–20 characters."
          />
          <Field
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="A line about you"
            multiline
            maxLength={160}
            hint={`${bio.length} of 160`}
          />
        </Reveal>

        {handle.length > 0 && !handleOk ? (
          <Reveal index={3}>
            <Notice text="Nicknames need 3–20 characters, and only letters, numbers or underscores." />
          </Reveal>
        ) : null}

        {error ? (
          <Reveal index={3}>
            <Notice text={error} />
          </Reveal>
        ) : null}

        <Reveal index={4}>
          <Button
            label={saving ? 'Saving…' : 'Save'}
            glyph="check"
            onPress={save}
            disabled={!ready}
          />
        </Reveal>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  camera: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
