import React, { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { Avatar, Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, typography } from '@/theme/tokens';
import { TOPICS } from '@/data/topics';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useComposerInset } from '@/lib/useComposerInset';
import { useVybe, useAuthor, usePost } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';
import { uploadImage } from '@/services/db';
import type { Boundary, DraftPoll, PostKind } from '@/data/types';

const MAX_MEDIA = 4;
const MAX_POLL_OPTIONS = 4;

export default function ComposeScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const circles = useVybe((s) => s.circles);
  const addPost = useVybe((s) => s.addPost);
  const saveDraft = useVybe((s) => s.saveDraft);
  const removeDraft = useVybe((s) => s.removeDraft);

  const { draft: draftId, quote: paramQuoteId } = useLocalSearchParams<{ draft?: string; quote?: string }>();
  const draft = useVybe((s) => s.drafts.find((d) => d.id === draftId));
  const [seed] = useState(draft);

  const [body, setBody] = useState(seed?.body ?? '');
  const [media, setMedia] = useState<string[]>(seed?.media ?? []);
  const [topics, setTopics] = useState<string[]>(seed?.topics ?? []);
  const [quotePostId, setQuotePostId] = useState<string | undefined>(seed?.quotePostId ?? paramQuoteId);
  const [sheet, setSheet] = useState<'audience' | 'topics' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const profile = useVybe((s) => s.profile);
  const footerInset = useComposerInset(space.sm);
  const [error, setError] = useState<string | null>(null);

  const [pollOn, setPollOn] = useState(!!seed?.poll);
  const [pollQuestion, setPollQuestion] = useState(seed?.poll?.question ?? '');
  const [pollOptions, setPollOptions] = useState<string[]>(
    seed?.poll?.options.map((o) => o.text) ?? ['', ''],
  );
  const [boundary, setBoundary] = useState<Boundary>(
    seed?.boundary ?? { visibleTo: ['public'], canInteract: ['public'] },
  );

  const suggested = useMemo(() => {
    const t = body.toLowerCase();
    return TOPICS.filter((x) => t.includes(x.label.toLowerCase().split(' ')[0])).map((x) => x.id);
  }, [body]);

  const chosenTopics = topics.length ? topics : suggested;

  const pollChoices = pollOptions.map((o) => o.trim()).filter(Boolean);
  const pollReady = pollOn && pollQuestion.trim().length > 0 && pollChoices.length >= 2;
  const pollIncomplete = pollOn && !pollReady;

  const hasContent = body.trim().length > 0 || media.length > 0 || pollReady || !!quotePostId;
  const canAdvance = hasContent && !pollIncomplete;

  const pollDraft: DraftPoll | undefined = pollReady
    ? {
        question: pollQuestion.trim(),
        options: pollChoices.map((text, i) => ({ id: `opt${i + 1}`, text })),
      }
    : undefined;
  const kind: PostKind = media.length > 1 ? 'carousel' : media.length === 1 ? 'photo' : 'text';

  const pickPhotos = async () => {
    haptic('light');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_MEDIA - media.length,
      quality: 0.85,
    });
    if (res.canceled) return;
    setMedia((m) => [...m, ...res.assets.map((a) => a.uri)].slice(0, MAX_MEDIA));
    haptic('success');
  };

  const takePhoto = async () => {
    haptic('light');
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (res.canceled || !res.assets[0]?.uri) return;
    setMedia((m) => [...m, res.assets[0].uri].slice(0, MAX_MEDIA));
    haptic('success');
  };

  const close = () => {
    if (hasContent) {
      const shape = {
        id: seed?.id,
        kind,
        body: body.trim(),
        topics: topics.length ? topics : suggested,
        boundary,
        poll: pollDraft,
        quotePostId,
      };

      void saveDraft({ ...shape, media });
      haptic('success');

      const local = media.filter((m) => !m.startsWith('http'));
      if (local.length) {
        const uid = useAuth.getState().user?.id;
        if (uid) {
          void Promise.all(
            media.map((m) => (m.startsWith('http') ? m : uploadImage('post-media', uid, m))),
          ).then((uploaded) => {
            if (uploaded.every(Boolean)) {
              void saveDraft({ ...shape, media: uploaded as string[] });
            }
          });
        }
      }
    } else if (seed) {
      removeDraft(seed.id);
    }
    goBack();
  };

  const publish = async () => {
    const uid = useAuth.getState().user?.id;
    if (!uid || publishing) return;

    setPublishing(true);
    setError(null);

    let urls: string[] = [];
    if (media.length) {
      const uploaded = await Promise.all(
        media.map((uri) => (uri.startsWith('http') ? uri : uploadImage('post-media', uid, uri))),
      );
      if (uploaded.some((u) => !u)) {
        setPublishing(false);
        setError('Could not upload the photos. Check your connection and try again.');
        return;
      }
      urls = uploaded as string[];
    }

    const ok = await addPost({
      authorId: uid,
      kind,
      body: body.trim(),
      media: urls,
      topics: topics.length ? topics : suggested,
      boundary,
      readSeconds: Math.max(6, Math.round(body.length / 12)),
      poll: pollDraft,
      quotePostId,
    });

    setPublishing(false);
    if (!ok) {
      setError('Could not publish that. Try again in a moment.');
      return;
    }

    if (seed) void removeDraft(seed.id);
    haptic('success');
    goBack();
  };

  const audienceSummary = summarise(boundary, circles);

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura intensity={0.7} />
      
      {/* Top Navigation Bar */}
      <View style={[styles.bar, { paddingTop: insets.top + space.md }]}>
        <Touchable onPress={close} feedback="light" hitSlop={10} accessibilityLabel="Close">
          <VText variant="label">Cancel</VText>
        </Touchable>

        <View style={{ flex: 1 }} />

        <Touchable
          onPress={publish}
          disabled={!canAdvance || publishing}
          feedback="medium"
          accessibilityLabel="Post"
          style={[
            styles.next,
            { backgroundColor: canAdvance && !publishing ? c.volt : c.surfaceElevated },
          ]}
        >
          <VText variant="label" color={canAdvance && !publishing ? c.onVolt : c.textMuted}>
            {publishing ? 'Posting…' : 'Post'}
          </VText>
        </Touchable>
      </View>

      {/* Redesigned Fluid Scrolling Container */}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.base,
          paddingBottom: 140,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.writeRow}>
          <Avatar uri={profile.avatar} size={40} />

          <View style={{ flex: 1, gap: space.md }}>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
              placeholder="What's happening?"
              placeholderTextColor={c.textMuted}
              style={[styles.input, { color: c.text }]}
              accessibilityLabel="Post text"
            />

            {quotePostId ? (
              <QuotedPreview postId={quotePostId} onRemove={() => setQuotePostId(undefined)} />
            ) : null}

            <MediaStrip
              media={media}
              onAdd={pickPhotos}
              onRemove={(i) => setMedia((m) => m.filter((_, x) => x !== i))}
            />

            <PollComposer
              on={pollOn}
              question={pollQuestion}
              options={pollOptions}
              incomplete={pollIncomplete}
              onToggle={() => {
                haptic('select');
                setPollOn((v) => !v);
              }}
              onQuestion={setPollQuestion}
              onOption={(i, text) =>
                setPollOptions((prev) => prev.map((o, x) => (x === i ? text : o)))
              }
              onAddOption={() => {
                haptic('light');
                setPollOptions((prev) => [...prev, '']);
              }}
              onRemoveOption={(i) => {
                haptic('light');
                setPollOptions((prev) => prev.filter((_, x) => x !== i));
              }}
            />

            {chosenTopics.length ? (
              <View style={styles.chips}>
                {chosenTopics.map((id) => {
                  const t = TOPICS.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <Chip
                      key={id}
                      size="sm"
                      label={t.label}
                      tone={t.hue}
                      active
                      onPress={() => setTopics((prev) => prev.filter((x) => x !== id))}
                    />
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAwareScrollView>

      {error ? (
        <VText variant="caption" color={c.danger} style={{ textAlign: 'center', paddingBottom: space.sm }}>
          {error}
        </VText>
      ) : null}

      {/* Keyboard-Pinned Sticky Toolbar */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={[styles.footer, { borderTopColor: c.divider, backgroundColor: c.surface, paddingBottom: footerInset || space.md }]}>
          <Touchable
            onPress={() => {
              haptic('light');
              setSheet('audience');
            }}
            feedback="none"
            style={styles.audiencePill}
            accessibilityLabel={`${audienceSummary}. Change who sees this.`}
          >
            <Icon name={audienceSummary.startsWith('Everyone') ? 'globe' : 'users'} size={14} color={c.primary} />
            <VText variant="micro" color={c.primary}>
              {audienceSummary}
            </VText>
          </Touchable>

          <View style={[styles.toolDivider, { backgroundColor: c.divider }]} />

          <View style={styles.tools}>
            <Tool
              glyph="image"
              label="Add photos"
              disabled={media.length >= MAX_MEDIA}
              onPress={pickPhotos}
            />
            <Tool glyph="camera" label="Take a photo" disabled={media.length >= MAX_MEDIA} onPress={takePhoto} />
            <Tool
              glyph="bar-chart-2"
              label="Add a poll"
              active={pollOn}
              onPress={() => {
                haptic('select');
                setPollOn((v) => !v);
              }}
            />
            <Tool
              glyph="hash"
              label="Tag topics"
              active={chosenTopics.length > 0}
              onPress={() => {
                haptic('light');
                setSheet('topics');
              }}
            />

            <View style={{ flex: 1 }} />

            {body.length > 0 ? (
              <VText variant="micro" muted>
                {body.trim().length}
              </VText>
            ) : null}
          </View>
        </View>
      </KeyboardStickyView>

      <Sheet
        visible={sheet !== null}
        title={sheet === 'topics' ? 'Tag the topics' : 'Who sees this'}
        onClose={() => setSheet(null)}
      >
        {sheet === 'topics' ? (
          <View style={{ gap: space.md }}>
            {suggested.length ? (
              <VText variant="caption" secondary>
                We spotted a few in what you wrote — they are only applied if you pick them.
              </VText>
            ) : null}
            <View style={styles.chips}>
              {TOPICS.map((t) => (
                <Chip
                  key={t.id}
                  size="sm"
                  label={t.label}
                  tone={t.hue}
                  active={chosenTopics.includes(t.id)}
                  onPress={() =>
                    setTopics((prev) =>
                      prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                    )
                  }
                />
              ))}
            </View>
          </View>
        ) : (
          <AudiencePicker circles={circles} value={boundary} onChange={setBoundary} />
        )}
      </Sheet>
    </View>
  );
}

function QuotedPreview({ postId, onRemove }: { postId: string; onRemove: () => void }) {
  const { c } = useTheme();
  const post = usePost(postId);
  const author = useAuthor(post?.authorId);

  if (!post) return null;

  return (
    <View style={[styles.quotedBox, { borderColor: c.border, backgroundColor: c.surfaceElevated }]}>
      <View style={styles.quotedHeader}>
        <Avatar uri={author?.avatar} size={20} />
        <VText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
          {author?.name || author?.handle || 'User'}
        </VText>
        <Touchable onPress={onRemove} feedback="light" hitSlop={8} accessibilityLabel="Remove quote">
          <Icon name="x" size={16} color={c.textMuted} />
        </Touchable>
      </View>
      {post.body ? (
        <VText variant="caption" numberOfLines={3} color={c.textSecondary}>
          {post.body}
        </VText>
      ) : null}
    </View>
  );
}

function Tool({
  glyph,
  label,
  active,
  disabled,
  onPress,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="light"
      hitSlop={8}
      scaleTo={0.86}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={styles.tool}
    >
      <Icon name={glyph} size={21} color={disabled ? c.textMuted : active ? c.volt : c.primary} />
    </Touchable>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Touchable
          onPress={onClose}
          feedback="none"
          scaleTo={1}
          accessibilityLabel="Close"
          style={{ flex: 1 }}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.surfaceElevated, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View style={styles.sheetHead}>
            <VText variant="heading">{title}</VText>
            <Touchable onPress={onClose} feedback="light" hitSlop={10} accessibilityLabel="Done">
              <Icon name="x" size={20} color={c.text} />
            </Touchable>
          </View>
          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function summarise(
  b: Boundary,
  circles: { id: string; name: string }[],
): string {
  const isPublic = b.visibleTo.includes('public');
  const repliesOff = b.canInteract.length === 0;
  const where = isPublic
    ? 'Everyone'
    : circles.find((c) => b.visibleTo.includes(c.id))?.name ?? 'A circle';

  if (repliesOff) return `${where} can see this · replies off`;
  return isPublic ? 'Everyone can reply' : `${where} only`;
}

function MediaStrip({
  media,
  onAdd,
  onRemove,
}: {
  media: string[];
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const { c } = useTheme();
  const full = media.length >= MAX_MEDIA;

  if (!media.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <VText variant="micro" muted>
        {media.length} of {MAX_MEDIA}
      </VText>

      <Animated.View layout={LinearTransition.springify()} style={styles.chips}>
        {media.map((uri, i) => (
          <Animated.View key={uri} entering={FadeIn} exiting={FadeOut}>
            <View style={[styles.thumb, { borderColor: c.border }]}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <Touchable
                onPress={() => onRemove(i)}
                feedback="light"
                hitSlop={8}
                accessibilityLabel={`Remove photo ${i + 1}`}
                style={[styles.remove, { backgroundColor: c.surfaceElevated }]}
              >
                <Icon name="x" size={14} color={c.text} />
              </Touchable>
            </View>
          </Animated.View>
        ))}

        {full ? null : (
          <Touchable
            onPress={onAdd}
            feedback="none"
            scaleTo={0.95}
            accessibilityLabel="Add photos"
            style={[styles.addTile, { borderColor: c.border, backgroundColor: c.surfaceElevated }]}
          >
            <Icon name="image" size={22} color={c.textSecondary} />
            <VText variant="micro" muted>
              Add
            </VText>
          </Touchable>
        )}
      </Animated.View>
    </View>
  );
}

function PollComposer({
  on,
  question,
  options,
  incomplete,
  onToggle,
  onQuestion,
  onOption,
  onAddOption,
  onRemoveOption,
}: {
  on: boolean;
  question: string;
  options: string[];
  incomplete: boolean;
  onToggle: () => void;
  onQuestion: (t: string) => void;
  onOption: (i: number, t: string) => void;
  onAddOption: () => void;
  onRemoveOption: (i: number) => void;
}) {
  const { c } = useTheme();

  if (!on) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.pollHead}>
        <VText variant="label" color={c.volt}>
          Poll
        </VText>
        <Touchable
          onPress={onToggle}
          feedback="light"
          hitSlop={8}
          accessibilityLabel="Remove poll"
        >
          <Icon name="x" size={16} color={c.textMuted} />
        </Touchable>
      </View>

      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        layout={LinearTransition.springify()}
        style={[styles.pollCard, { backgroundColor: c.surface, borderColor: c.border }]}
      >
        <TextInput
          value={question}
          onChangeText={onQuestion}
          placeholder="Ask something"
          placeholderTextColor={c.textMuted}
          maxLength={140}
          style={[type.body, styles.pollInput, { color: c.text, borderColor: c.border }]}
          accessibilityLabel="Poll question"
        />

        {options.map((opt, i) => (
          <Animated.View key={i} entering={FadeIn} exiting={FadeOut} style={styles.pollRow}>
            <TextInput
              value={opt}
              onChangeText={(t) => onOption(i, t)}
              placeholder={`Answer ${i + 1}`}
              placeholderTextColor={c.textMuted}
              maxLength={60}
              style={[
                type.body,
                styles.pollInput,
                { color: c.text, borderColor: c.border, flex: 1 },
              ]}
              accessibilityLabel={`Poll answer ${i + 1}`}
            />
            {options.length > 2 ? (
              <Touchable
                onPress={() => onRemoveOption(i)}
                feedback="light"
                hitSlop={8}
                accessibilityLabel={`Remove answer ${i + 1}`}
              >
                <Icon name="x" size={18} color={c.textMuted} />
              </Touchable>
            ) : null}
          </Animated.View>
        ))}

        {options.length < MAX_POLL_OPTIONS ? (
          <Touchable
            onPress={onAddOption}
            feedback="light"
            accessibilityLabel="Add another answer"
            style={styles.pollAdd}
          >
            <Icon name="plus" size={16} color={c.textSecondary} />
            <VText variant="caption" secondary>
              Add another answer
            </VText>
          </Touchable>
        ) : null}

        <VText variant="micro" color={incomplete ? c.danger : c.textMuted}>
          {incomplete
            ? 'A poll needs a question and at least two answers.'
            : 'One vote each. Results show after you vote.'}
        </VText>
      </Animated.View>
    </View>
  );
}

const REPLY_OPTIONS = [
  { id: 'all', label: 'Anyone who can see it', hint: 'The usual.' },
  { id: 'circles', label: 'Only people in my circles', hint: 'Everyone else can read, not reply.' },
  { id: 'none', label: 'No one', hint: 'Post it and close the door.' },
] as const;

type Reply = (typeof REPLY_OPTIONS)[number]['id'];

function AudiencePicker({
  circles,
  value,
  onChange,
}: {
  circles: { id: string; name: string; color: string; glyph: string; memberIds: string[] }[];
  value: Boundary;
  onChange: (b: Boundary) => void;
}) {
  const { c } = useTheme();
  const isPublic = value.visibleTo.includes('public');

  const reply: Reply = value.canInteract.length === 0 ? 'none' : isPublic && value.canInteract.includes('public') ? 'all' : 'circles';

  const setAudience = (visibleTo: string[]) => {
    haptic('select');
    onChange({ visibleTo, canInteract: reply === 'none' ? [] : visibleTo });
  };

  const setReply = (r: Reply) => {
    haptic('select');
    onChange({
      visibleTo: value.visibleTo,
      canInteract: r === 'none' ? [] : r === 'all' ? value.visibleTo : circles.map((x) => x.id),
    });
  };

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.md }}>
        <View style={{ gap: 4 }}>
          <VText variant="heading">Who can see this</VText>
          <VText variant="caption" secondary>
            Only the people you pick. This is not a suggestion to the algorithm — it is a rule.
          </VText>
        </View>

        <Option
          label="Everyone"
          hint="Anyone on Vybe, and anywhere your post is mirrored."
          glyph="globe"
          tint={c.textSecondary}
          active={isPublic}
          onPress={() => setAudience(['public'])}
        />

        {circles.map((cc) => (
          <Option
            key={cc.id}
            label={cc.name}
            hint={`${cc.memberIds.length} ${cc.memberIds.length === 1 ? 'person' : 'people'}`}
            glyph={cc.glyph as any}
            tint={cc.color}
            active={!isPublic && value.visibleTo.includes(cc.id)}
            onPress={() => setAudience([cc.id])}
          />
        ))}
      </View>

      <View style={{ gap: space.md }}>
        <View style={{ gap: 4 }}>
          <VText variant="heading">Who can reply</VText>
          <VText variant="caption" secondary>
            Seeing something and being able to answer it are different permissions.
          </VText>
        </View>

        {REPLY_OPTIONS.map((o) => (
          <Option
            key={o.id}
            label={o.label}
            hint={o.hint}
            glyph={o.id === 'none' ? 'lock' : o.id === 'circles' ? 'users' : 'message-circle'}
            tint={c.textSecondary}
            active={reply === o.id}
            onPress={() => setReply(o.id)}
          />
        ))}
      </View>
    </View>
  );
}

function Option({
  label,
  hint,
  glyph,
  tint,
  active,
  onPress,
}: {
  label: string;
  hint: string;
  glyph: React.ComponentProps<typeof Icon>['name'];
  tint: string;
  active: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      feedback="none"
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}. ${hint}`}
      style={[
        styles.option,
        {
          backgroundColor: active ? c.surfaceElevated : 'transparent',
          borderColor: active ? c.volt : c.border,
        },
      ]}
    >
      <Icon name={glyph} size={18} color={active ? c.volt : tint} />
      <View style={{ flex: 1, gap: 2 }}>
        <VText variant="bodyMedium">{label}</VText>
        <VText variant="caption" muted>
          {hint}
        </VText>
      </View>
      {active ? <Icon name="check" size={18} color={c.volt} /> : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    paddingBottom: space.md,
  },
  writeRow: { flexDirection: 'row', gap: space.md },
  footer: {
    paddingHorizontal: space.base,
    paddingTop: space.sm,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  audiencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: 30,
  },
  toolDivider: { height: StyleSheet.hairlineWidth, width: '100%' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 44 },
  tool: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: space.base,
    gap: space.base,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  next: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    minHeight: 38,
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    minHeight: 140,
    paddingTop: 4,
    textAlignVertical: 'top',
    fontFamily: typography.regular,
    fontSize: 18,
    lineHeight: 26,
  },
  quotedBox: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
  quotedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  thumb: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 64,
  },
  pollHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  pollCard: {
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pollInput: {
    minHeight: 46,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pollAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: 38,
  },
});