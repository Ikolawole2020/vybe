export type TopicId = string;

export type Topic = {
  id: TopicId;
  label: string;
  /** Emoji-free: a Lucide-equivalent glyph name from @expo/vector-icons Feather set. */
  glyph: string;
  hue: string;
  /**
   * A photograph of the subject, for the picker tiles.
   *
   * Optional on purpose. Every consumer falls back to `hue` + `glyph`, so a
   * topic added without art, or an image that has not downloaded yet, renders
   * as the old coloured pill rather than as an empty box.
   */
  image?: string;
};

/**
 * Somebody else, as the viewer sees them.
 *
 * `circles` and `following` are facts about the *viewer*, not about the person,
 * so they are filled in by the store rather than read off the profile row.
 *
 * There is no `verified` flag: nothing in the database confers one, and a badge
 * that is always false is worse than no badge at all.
 */
export type Author = {
  id: string;
  handle: string;
  name: string;
  avatar: string;
  bio: string;
  followers: number;
  /** Circles the *viewer* has placed this author into. */
  circles: string[];
  following: boolean;
};

export type PostKind = 'photo' | 'carousel' | 'video' | 'text' | 'thread' | 'article';

/** Who may see, and who may act, on a post. */
export type Boundary = {
  /** Circle ids allowed to view. `['public']` means everyone. */
  visibleTo: string[];
  /** Circle ids allowed to reply/comment. Always a subset-in-spirit of visibleTo. */
  canInteract: string[];
};

export type PollOption = {
  id: string;
  text: string;
  votes: number;
};

export type Poll = {
  id: string;
  question: string;
  options: PollOption[];
  userVotedOptionId?: string;
  totalVotes: number;
};

/**
 * A poll before the post it belongs to exists.
 *
 * It has no id and no counts, and that is not an omission: `polls.post_id` is
 * a foreign key, so the row cannot be written until the post has been. This is
 * what the composer holds and what a draft stores; it becomes a `Poll` at the
 * moment the post is published.
 */
export type DraftPoll = {
  question: string;
  options: { id: string; text: string }[];
};

export type VoiceNote = {
  uri: string;
  durationSeconds: number;
  waveform?: number[];
};

export type Post = {
  id: string;
  authorId: string;
  kind: PostKind;
  body: string;
  media: string[];
  topics: TopicId[];
  createdAt: number;
  likes: number;
  comments: number;
  boosts: number;
  /** 0–1: how much of this post's reach came from virality rather than follows. */
  viralityRatio: number;
  boundary: Boundary;
  /** Present when the post belongs to a Space. */
  spaceId?: string;
  /** Read-time in seconds, used by the attention budget. */
  readSeconds: number;
  /** Interactive voting poll attached to the post. */
  poll?: Poll;
  /** Attached audio voice memo. */
  voiceNote?: VoiceNote;
  /** Quoted original post reference. */
  quotePostId?: string;
};

/**
 * An unpublished post.
 *
 * Everything the composer holds except the things only publishing decides —
 * no counts, no `createdAt`, because a draft has not happened yet.
 */
export type Draft = {
  id: string;
  kind: PostKind;
  body: string;
  media: string[];
  topics: TopicId[];
  boundary: Boundary;
  poll?: DraftPoll;
  quotePostId?: string;
  savedAt: number;
};

/** One reply under a post. */
export type Reply = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: number;
  voiceNote?: VoiceNote;
};

export type StoryItem = {
  id: string;
  media: string;
  kind: 'photo' | 'video';
  caption?: string;
  createdAt: number;
  seen?: boolean;
  hiddenUserIds?: string[];
  audience?: 'everyone' | 'circles' | 'custom';
};

export type Story = {
  id: string;
  authorId: string;
  items: StoryItem[];
  hasUnseen: boolean;
};

export type DirectMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: number;
  media?: string;
  voiceNote?: VoiceNote;
  sharedPostId?: string;
  read: boolean;
  /** True between the optimistic append and the server accepting the row. */
  pending?: boolean;
  /**
   * True once every retry has been spent.
   *
   * Without it a send that never landed is indistinguishable on screen from one
   * that did — the old code retried quietly for two minutes and then gave up in
   * silence, leaving a message the user believes was delivered.
   */
  failed?: boolean;
};

export type ChatConversation = {
  id: string;
  participantIds: string[];
  lastMessage?: DirectMessage;
  unreadCount: number;
  isCircleGroup?: boolean;
  circleId?: string;
  title?: string;
};

/**
 * Self-reported age band, collected on its own screen during sign-up.
 *
 * A band rather than a birth date: the product only needs to know roughly who
 * this is, and a date of birth is a stronger identifier than anything else the
 * app holds. Undefined means the screen was skipped.
 */
export type AgeRange =
  | 'under-18'
  | '18-24'
  | '25-34'
  | '35-44'
  | '45-54'
  | '55-64'
  | 'over-64';

/** The signed-in person's own editable identity — one row in `profiles`. */
export type Profile = {
  /** `auth.users.id`. Empty only before the profile row has loaded. */
  id: string;
  name: string;
  /** Without the leading @. */
  handle: string;
  /** Public URL in the `avatars` bucket. Empty means no picture set. */
  avatar: string;
  bio: string;
  /**
   * `profiles.created_at`, which is the account's own birthday rather than this
   * device's. Drives the early-adopter badge, so reinstalling no longer grants
   * a fresh one.
   */
  joinedAt: number;
  /** See {@link AgeRange}. Undefined when skipped or not yet asked. */
  ageRange?: AgeRange;
};

export type Circle = {
  id: string;
  name: string;
  color: string;
  glyph: string;
  memberIds: string[];
  /** Feed weight multiplier the user assigns to this circle. */
  boost: number;
};

export type Space = {
  id: string;
  name: string;
  description: string;
  members: number;
  topics: TopicId[];
  hue: string;
};

/** A time-boxed override, e.g. "more football for 3 days". */
export type TemporaryMode = {
  id: string;
  label: string;
  topicId: TopicId;
  /** -1 … 1 */
  delta: number;
  startedAt: number;
  expiresAt: number;
};

/** One user-visible, undoable change to the algorithm. */
export type AlgoLedgerEntry = {
  id: string;
  at: number;
  /** Human sentence, e.g. "Turned down Celebrity Gossip to -0.6". */
  summary: string;
  source: 'panel' | 'genome' | 'dear-algo' | 'receipt' | 'mode' | 'system';
  /** Inverse patch, applied on undo. */
  revert: AlgoPatch;
  undone: boolean;
};

export type AlgoPatch = {
  topicWeights?: Record<TopicId, number>;
  dials?: Partial<AlgoDials>;
  authorWeights?: Record<string, number>;
  removeModeId?: string;
  addMode?: TemporaryMode;
  /** Replaces the whole mode list. Used by the reset entry, which clears it. */
  restoreModes?: TemporaryMode[];
};

/**
 * The six knobs that decide a feed. Every one is user-set — there are no
 * hidden multipliers anywhere in the engine.
 */
export type AlgoDials = {
  /** How strongly explicit topic preferences dominate. */
  topicPull: number;
  /** How much recency matters (drives the decay half-life). */
  freshness: number;
  /** How much the crowd's engagement counts. 0 = popularity is ignored. */
  crowd: number;
  /** How much closer circles outrank the wider follow graph. */
  intimacy: number;
  /** Deliberate injection of things outside your profile. */
  serendipity: number;
  /** Penalty applied to repeat authors, to stop any one voice dominating. */
  variety: number;
};

export type AlgoState = {
  topicWeights: Record<TopicId, number>;
  authorWeights: Record<string, number>;
  dials: AlgoDials;
  modes: TemporaryMode[];
};

/** One explainable line in a post's score receipt. */
export type ScoreFactor = {
  key: string;
  label: string;
  /** Raw measured signal, -1 … 1. */
  signal: number;
  /** User-set weight applied to it. */
  weight: number;
  /** signal * weight, i.e. what it added to the total. */
  contribution: number;
  /** Short plain-English cause, shown in the receipt. */
  because: string;
  /** Topic the user can act on directly from the receipt, if any. */
  actionableTopic?: TopicId;
};

export type ScoreReceipt = {
  postId: string;
  total: number;
  factors: ScoreFactor[];
  /** Rank in the delivered feed, 1-based. */
  rank: number;
  /** The single factor that mattered most. */
  headline: string;
};

export type FeedMode = 'for-you' | 'following' | 'circles' | 'latest';