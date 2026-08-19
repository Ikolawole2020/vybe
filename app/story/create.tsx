import React, { useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import { Avatar, Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { CropStudio } from '@/components/media/CropStudio';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useVybe } from '@/store/useVybe';

export default function CreateStoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();

  const addStory = useVybe((s) => s.addStory);
  const authors = useVybe((s) => s.authors);
  const viewerId = useVybe((s) => s.profile.id);

  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  /**
   * The photo as it came out of the picker, kept alongside the cropped copy.
   *
   * Re-cropping works off the original every time, so a second pass is not a
   * crop of a crop — quality does not fall away with each adjustment, and
   * widening a frame you cut too tight is possible instead of destructive.
   */
  const [originalUri, setOriginalUri] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [caption, setCaption] = useState('');
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);

  const networkAuthors = Object.values(authors).filter((a) => a.id !== viewerId);

  const pickImage = async () => {
    haptic('light');
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Please enable photo library access in Settings to upload a story.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false, // Full image selection without forced cropping
        quality: 0.9,
      });
      if (!res.canceled && res.assets[0]?.uri) {
        // Straight into the crop studio, which is where the choice of shape
        // belongs — the picker's own editor forces a fixed aspect on Android
        // and a square on iOS, which is exactly the constraint we do not want.
        setOriginalUri(res.assets[0].uri);
        setSelectedUri(res.assets[0].uri);
        setCropping(true);
      }
    } catch {
      // fallback
    }
  };

  const takePhoto = async () => {
    haptic('light');
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Please enable camera access in Settings to take a story photo.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false, // Full camera shot without forced crop
        quality: 0.9,
      });
      if (!res.canceled && res.assets[0]?.uri) {
        setOriginalUri(res.assets[0].uri);
        setSelectedUri(res.assets[0].uri);
        setCropping(true);
      }
    } catch {
      // fallback
    }
  };

  const toggleFitMode = () => {
    haptic('select');
    setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'));
  };

  const toggleHideUser = (userId: string) => {
    haptic('select');
    setHiddenUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleShare = () => {
    if (!selectedUri) return;
    haptic('success');
    addStory({
      media: selectedUri,
      kind: 'photo',
      caption: caption.trim() || undefined,
      hiddenUserIds: hiddenUserIds.length > 0 ? hiddenUserIds : undefined,
    });
    goBack();
  };

  // The crop studio takes the whole screen while it is up: a crop is a
  // decision about the frame, and leaving the story chrome visible behind it
  // invites you to caption a photo whose shape you have not settled yet.
  if (cropping && (originalUri ?? selectedUri)) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <CropStudio
          uri={(originalUri ?? selectedUri) as string}
          onCancel={() => setCropping(false)}
          onDone={(uri) => {
            setSelectedUri(uri);
            setCropping(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000000' }]}>
      {/* Media Preview */}
      {selectedUri ? (
        <>
          <Image
            source={{ uri: selectedUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={28}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
          <Image
            source={{ uri: selectedUri }}
            style={styles.previewImage}
            contentFit={fitMode}
          />
        </>
      ) : (
        <View style={[styles.placeholder, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl }]}>
          <View style={[styles.iconCircle, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
            <Icon name="image" size={40} color={c.volt} />
          </View>
          <VText variant="title" style={{ marginTop: space.base, textAlign: 'center' }}>
            Create a Story
          </VText>
          <VText variant="body" secondary style={{ textAlign: 'center', maxWidth: 260, marginTop: 4 }}>
            Share a full-size photo or moment with your network.
          </VText>

          <View style={styles.pickerActions}>
            <Button
              label="Choose from Library"
              onPress={pickImage}
              glyph="image"
            />
            <Button
              label="Take Photo"
              variant="ghost"
              onPress={takePhoto}
              glyph="camera"
            />
          </View>
        </View>
      )}

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.base }]}>
        <Touchable
          onPress={() => goBack()}
          feedback="light"
          style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
          accessibilityLabel="Close"
        >
          <Icon name="x" size={22} color="#FFFFFF" />
        </Touchable>

        {selectedUri ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Touchable
              onPress={() => setPrivacyModalVisible(true)}
              feedback="light"
              style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              accessibilityLabel="Hide from users"
            >
              {/*
                A shield says "you are protected from something", which is not
                what this does — it picks people who will not be shown the
                story. So: an audience, and an audience with someone struck out
                of it once anyone is hidden.
              */}
              <Icon
                name={hiddenUserIds.length > 0 ? 'user-x' : 'users'}
                size={18}
                color={hiddenUserIds.length > 0 ? c.ember : '#FFFFFF'}
              />
            </Touchable>

            <Touchable
              onPress={() => {
                haptic('light');
                setCropping(true);
              }}
              feedback="light"
              style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              accessibilityLabel="Crop photo"
            >
              <Icon name="crop" size={18} color="#FFFFFF" />
            </Touchable>

            <Touchable
              onPress={toggleFitMode}
              feedback="light"
              style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              accessibilityLabel={fitMode === 'contain' ? 'Expand to fill' : 'Fit whole image'}
            >
              <Icon name={fitMode === 'contain' ? 'maximize' : 'minimize'} size={18} color="#FFFFFF" />
            </Touchable>

            <Touchable
              onPress={pickImage}
              feedback="light"
              style={[styles.iconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              accessibilityLabel="Change photo"
            >
              <Icon name="refresh-cw" size={18} color="#FFFFFF" />
            </Touchable>
          </View>
        ) : null}
      </View>

      {/* Bottom Controls with Keyboard Avoidance */}
      {selectedUri ? (
        <KeyboardStickyView
          offset={{ closed: 0, opened: space.md }}
          style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 28) + space.lg }]}
        >
          {hiddenUserIds.length > 0 ? (
            <View style={styles.privacyBadge}>
              <Icon name="eye-off" size={14} color={c.ember} />
              <VText variant="micro" color="#FFFFFF">
                Hidden from {hiddenUserIds.length} {hiddenUserIds.length === 1 ? 'person' : 'people'}
              </VText>
            </View>
          ) : null}

          <TextInput
            style={[styles.captionInput, { backgroundColor: 'rgba(0,0,0,0.75)', color: '#FFFFFF' }]}
            placeholder="Add a caption to your story..."
            placeholderTextColor="rgba(255, 255, 255, 0.6)"
            value={caption}
            onChangeText={setCaption}
          />

          <Button label="Share to Your Story" onPress={handleShare} />
        </KeyboardStickyView>
      ) : null}

      {/* Hide Story From Modal Sheet */}
      <Modal
        visible={privacyModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPrivacyModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: c.surfaceElevated, paddingBottom: insets.bottom + space.lg }]}>
            <View style={styles.modalHeader}>
              <View>
                <VText variant="title">Hide Story From</VText>
                <VText variant="caption" secondary>
                  Select who should NOT see this story
                </VText>
              </View>
              <Touchable onPress={() => setPrivacyModalVisible(false)} style={styles.modalCloseBtn}>
                <Icon name="x" size={20} color={c.text} />
              </Touchable>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {networkAuthors.length > 0 ? (
                networkAuthors.map((a) => {
                  const isHidden = hiddenUserIds.includes(a.id);
                  return (
                    <Touchable
                      key={a.id}
                      onPress={() => toggleHideUser(a.id)}
                      feedback="light"
                      style={[styles.userRow, { borderBottomColor: c.divider }]}
                    >
                      <Avatar uri={a.avatar} size={40} />
                      <View style={{ flex: 1 }}>
                        <VText variant="bodyMedium">{a.name}</VText>
                        <VText variant="caption" secondary>
                          @{a.handle}
                        </VText>
                      </View>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: isHidden ? c.ember : c.border,
                            backgroundColor: isHidden ? c.ember : 'transparent',
                          },
                        ]}
                      >
                        {isHidden ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
                      </View>
                    </Touchable>
                  );
                })
              ) : (
                <View style={{ padding: space.xl, alignItems: 'center' }}>
                  <VText variant="body" secondary>
                    No other users in your network yet.
                  </VText>
                </View>
              )}
            </ScrollView>

            <Button
              label={hiddenUserIds.length > 0 ? `Hide from ${hiddenUserIds.length} & Done` : 'Done'}
              onPress={() => setPrivacyModalVisible(false)}
              style={{ marginTop: space.base }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  previewImage: { ...StyleSheet.absoluteFill },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.gutter,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  pickerActions: {
    width: '100%',
    maxWidth: 320,
    gap: space.md,
    marginTop: space.xxl,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    zIndex: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.base,
    gap: space.md,
    zIndex: 10,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.4)',
  },
  captionInput: {
    height: 50,
    borderRadius: radius.lg,
    paddingHorizontal: space.base,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: space.base,
    gap: space.base,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.sm,
  },
  modalCloseBtn: {
    padding: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
