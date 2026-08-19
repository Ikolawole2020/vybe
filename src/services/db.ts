import { supabase } from '@/lib/supabase';
import type {
  AlgoLedgerEntry,
  AlgoState,
  Author,
  Boundary,
  ChatConversation,
  Circle,
  DirectMessage,
  Draft,
  DraftPoll,
  Poll,
  Post,
  PostKind,
  Profile,
  Reply,
  Space,
  Story,
  StoryItem,
} from '@/data/types';

/**
 * Everything the app knows about the server.
 *
 * One module rather than one per table, because the mapping between database
 * rows and the app's types is the interesting part and it should be readable in
 * one sitting. Screens never call `supabase.from()` themselves — if a query
 * lives here, its shape can be checked against the schema in one place.
 *
 * Two rules hold throughout:
 *
 * - **Reads are not filtered for permission.** Row-level security does that on
 *   the server. A post outside your audience is never in the result set, so
 *   nothing here re-implements the Boundary and nothing here can leak by
 *   forgetting to.
 * - **Failures return empty, and say so through `lastError`.** A feed that
 *   cannot load should be an empty feed with a message, never a crashed screen.
 */

const NO_CLIENT = 'Supabase is not configured. Add your keys to .env.';

/**
 * Set by the last failed call, for screens that want to explain themselves.
 *
 * It is *cleared* by the next successful one. Before that it was write-only:
 * one transient failure — a lost second of signal on a like — latched here
 * forever, and because `sync()` copies it into `loadError`, the feed showed
 * "Could not reach the server" on every subsequent load of a feed that was
 * loading perfectly well.
 */
export let lastError: string | null = null;

function fail(where: string, error: { message: string } | null): null {
  lastError = error ? `${where}: ${error.message}` : null;
  if (error) console.warn(`[db] ${where}`, error.message);
  return null;
}

/** Called by the reads whose success means the connection is fine. */
function ok(): void {
  lastError = null;
}

/**
 * RFC 4122 v4, generated locally.
 *
 * Duplicated from the store rather than imported, deliberately: `useVybe`
 * imports this module, so importing it back would close a require cycle — and
 * this file is reached during module evaluation, which is exactly where a cycle
 * hands you an undefined binding.
 */
function newUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Escapes a user's search text for a PostgREST `ilike` pattern.
 *
 * `%` and `_` are wildcards. Typing `%` searched for everything and made the
 * database scan the whole `profiles` table; `,`, `(` and `)` are PostgREST's
 * own `or()` syntax and could break out of the filter into an adjacent one.
 * Backslash is escaped first, or escaping the others would be undone by it.
 */
function likeSafe(input: string): string {
  return input
    .trim()
    .slice(0, 64)
    .replace(/\\/g, '\\\\')
    .replace(/[%_]/g, '\\$&')
    .replace(/[,()*"']/g, ' ');
}

// ---------------------------------------------------------------- row types --

type ProfileRow = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  avatar_url: string | null;
  created_at: string;
  age_range?: string | null;
  followers?: { count: number }[];
};

type PostRow = {
  id: string;
  author_id: string;
  kind: PostKind;
  body: string;
  topics: string[];
  read_seconds: number;
  created_at: string;
  is_public: boolean;
  visible_circle_ids: string[];
  reply_policy: 'everyone' | 'circles' | 'none';
  quote_post_id?: string | null;
  post_media?: { url: string; ordinal: number }[];
  likes?: { count: number }[];
  boosts?: { count: number }[];
  replies?: { count: number }[];
  author?: ProfileRow | null;
};

type DraftRow = {
  id: string;
  kind: PostKind;
  body: string;
  media: string[];
  topics: string[];
  is_public: boolean;
  visible_circle_ids: string[];
  reply_policy: 'everyone' | 'circles' | 'none';
  quote_post_id?: string | null;
  poll?: DraftPoll | null;
  saved_at: string;
};

// PostgREST returns an embedded aggregate as a one-element array.
const countOf = (agg?: { count: number }[]) => agg?.[0]?.count ?? 0;

// --------------------------------------------------------------- the Boundary --

/**
 * The app models an audience as one array with a magic `'public'` member; the
 * database splits it into `is_public` + `visible_circle_ids` + a reply enum,
 * because audience and reply rights are separate permissions.
 *
 * Reply rights lose a little precision in the round trip. The database records
 * *which kind* of person may reply — everyone, your circles, nobody — not which
 * circles specifically, so `'circles'` reads back as the post's own audience.
 * That is the same set in every case the composer can currently produce.
 */
function boundaryToRow(b: Boundary) {
  const circleIds = b.visibleTo.filter((v) => v !== 'public');
  return {
    is_public: b.visibleTo.includes('public'),
    visible_circle_ids: circleIds,
    reply_policy: (b.canInteract.includes('public')
      ? 'everyone'
      : b.canInteract.length
        ? 'circles'
        : 'none') as 'everyone' | 'circles' | 'none',
  };
}

function boundaryFromRow(r: {
  is_public: boolean;
  visible_circle_ids: string[];
  reply_policy: 'everyone' | 'circles' | 'none';
}): Boundary {
  return {
    visibleTo: r.is_public ? ['public'] : r.visible_circle_ids,
    canInteract:
      r.reply_policy === 'everyone'
        ? ['public']
        : r.reply_policy === 'none'
          ? []
          : r.visible_circle_ids,
  };
}

// ------------------------------------------------------------------ mappers --

export function toAuthor(r: ProfileRow): Author {
  return {
    id: r.id,
    handle: r.handle,
    name: r.name || r.handle,
    avatar: r.avatar_url ?? '',
    bio: r.bio,
    followers: countOf(r.followers),
    circles: [],
    following: false,
  };
}

export function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    avatar: r.avatar_url ?? '',
    bio: r.bio,
    joinedAt: new Date(r.created_at).getTime(),
    ageRange: (r.age_range as Profile['ageRange']) ?? undefined,
  };
}

function toPost(r: PostRow): Post {
  return {
    id: r.id,
    authorId: r.author_id,
    kind: r.kind,
    body: r.body,
    media: (r.post_media ?? []).sort((a, b) => a.ordinal - b.ordinal).map((m) => m.url),
    topics: r.topics,
    createdAt: new Date(r.created_at).getTime(),
    likes: countOf(r.likes),
    comments: countOf(r.replies),
    boosts: countOf(r.boosts),
    viralityRatio: 0,
    boundary: boundaryFromRow(r),
    readSeconds: r.read_seconds,
    quotePostId: r.quote_post_id ?? undefined,
  };
}

// ----------------------------------------------------------------- profiles --

const PROFILE_COLS = 'id, handle, name, bio, avatar_url, created_at';
const PROFILE_WITH_FOLLOWERS = `${PROFILE_COLS}, followers:follows!follows_followee_id_fkey(count)`;

const UNDEFINED_COLUMN = '42703';

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return fail('fetchMyProfile', { message: NO_CLIENT });

  const read = (cols: string) =>
    supabase!.from('profiles').select(cols).eq('id', userId).maybeSingle();

  let { data, error } = await read(`${PROFILE_COLS}, age_range`);
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await read(PROFILE_COLS));
  }

  if (error) return fail('fetchMyProfile', error);
  ok();
  return data ? toProfile(data as unknown as ProfileRow) : null;
}

export async function ensureMyProfile(
  userId: string,
  email: string | null | undefined,
  displayName: string,
): Promise<Profile | null> {
  const existing = await fetchMyProfile(userId);
  if (existing) return existing;
  if (!supabase) return null;

  const base = (email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  const stem = (base.length < 3 ? `vybe${base}` : base).slice(0, 16);

  for (let n = 0; n < 12; n++) {
    const handle = n === 0 ? stem : `${stem}${n}`;
    const { data, error } = await supabase
      .from('profiles')
      .insert({ id: userId, handle, name: displayName })
      .select(PROFILE_COLS)
      .single();

    if (!error) return toProfile(data as ProfileRow);
    if (error.code !== '23505') return fail('ensureMyProfile', error);

    const raced = await fetchMyProfile(userId);
    if (raced) return raced;
  }

  return fail('ensureMyProfile', { message: 'Could not find a free nickname.' });
}

export async function updateMyProfile(
  userId: string,
  patch: { name?: string; handle?: string; bio?: string; avatar_url?: string; age_range?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: NO_CLIENT };
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (!error) return { ok: true };

  if (error.code === UNDEFINED_COLUMN && patch.age_range !== undefined) {
    const { age_range: _dropped, ...rest } = patch;
    if (Object.keys(rest).length === 0) return { ok: true };
    return updateMyProfile(userId, rest);
  }
  if (error.code === '23505') return { ok: false, message: 'That nickname is already taken.' };
  if (error.code === '23514') {
    return { ok: false, message: 'Nicknames need 3–20 characters: letters, numbers or underscores.' };
  }
  return { ok: false, message: error.message };
}

export async function searchProfiles(
  query: string,
  limit = 40,
  excludeId?: string,
): Promise<Author[]> {
  if (!supabase) return [];
  let q = supabase.from('profiles').select(PROFILE_WITH_FOLLOWERS).limit(limit);
  if (excludeId) q = q.neq('id', excludeId);
  const safe = likeSafe(query);
  if (safe) {
    q = q.or(`name.ilike.%${safe}%,handle.ilike.%${safe}%`);
  } else {
    q = q.order('created_at', { ascending: false });
  }
  const { data, error } = await q;
  if (error) {
    fail('searchProfiles', error);
    return [];
  }
  ok();
  return (data as ProfileRow[]).map(toAuthor);
}

export async function fetchProfilesByIds(ids: string[]): Promise<Author[]> {
  if (!supabase || !ids.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_WITH_FOLLOWERS)
    .in('id', ids);
  if (error) {
    fail('fetchProfilesByIds', error);
    return [];
  }
  return (data as ProfileRow[]).map(toAuthor);
}

// ------------------------------------------------------------- last seen --

export async function touchLastSeen(userId: string): Promise<void> {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error && error.code !== UNDEFINED_COLUMN) {
    // Silent fail-soft
  }
}

export async function fetchLastSeen(ids: string[]): Promise<Record<string, number>> {
  if (!supabase || !ids.length) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, last_seen_at')
    .in('id', ids);
  if (error || !data) return {};

  const out: Record<string, number> = {};
  for (const row of data as { id: string; last_seen_at: string | null }[]) {
    if (row.last_seen_at) out[row.id] = new Date(row.last_seen_at).getTime();
  }
  return out;
}

const MAX_EDGE = { avatars: 800, 'post-media': 1600 } as const;

async function toJpeg(uri: string, bucket: keyof typeof MAX_EDGE): Promise<string> {
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: MAX_EDGE[bucket], height: null });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return out.uri;
  } catch (e) {
    console.warn('[db] toJpeg fell back to the original', e);
    return uri;
  }
}

export async function uploadImage(
  bucket: 'avatars' | 'post-media',
  userId: string,
  uri: string,
): Promise<string | null> {
  if (!supabase) return fail('uploadImage', { message: NO_CLIENT });

  const jpeg = await toJpeg(uri, bucket);

  const res = await fetch(jpeg);
  const bytes = await res.arrayBuffer();
  if (!bytes.byteLength) return fail('uploadImage', { message: 'The picked image was empty.' });

  const MAX_BYTES = bucket === 'avatars' ? 8 * 1024 * 1024 : 25 * 1024 * 1024;
  if (bytes.byteLength > MAX_BYTES) {
    return fail('uploadImage', { message: 'That image is too large to upload.' });
  }

  const converted = jpeg !== uri;
  const ext = converted ? 'jpg' : ((uri.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase());
  const safeExt = /^(jpg|jpeg|png|webp|heic)$/.test(ext) ? ext : 'jpg';
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`;

  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
    upsert: false,
  });
  if (error) return fail('uploadImage', error);

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// -------------------------------------------------------------------- posts --

const POST_COLS =
  'id, author_id, kind, body, topics, read_seconds, created_at, is_public, visible_circle_ids, reply_policy, quote_post_id, post_media(url, ordinal), likes(count), boosts(count), replies(count)';

export async function fetchFeed(
  opts: { limit?: number; before?: string | null } = {},
): Promise<{ posts: Post[]; authors: Author[]; nextCursor: string | null }> {
  const limit = opts.limit ?? 40;
  if (!supabase) return { posts: [], authors: [], nextCursor: null };

  let q = supabase
    .from('posts')
    .select(`${POST_COLS}, author:profiles!posts_author_id_fkey(${PROFILE_COLS})`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt('created_at', opts.before);

  const { data, error } = await q;
  if (error) {
    fail('fetchFeed', error);
    return { posts: [], authors: [], nextCursor: null };
  }
  ok();

  const rows = data as unknown as PostRow[];
  const authors = new Map<string, Author>();
  for (const r of rows) if (r.author) authors.set(r.author.id, toAuthor(r.author));

  const nextCursor = rows.length < limit ? null : (rows[rows.length - 1]?.created_at ?? null);
  return {
    posts: await attachPolls(rows.map(toPost)),
    authors: [...authors.values()],
    nextCursor,
  };
}

export async function fetchPostsByIds(ids: string[]): Promise<Post[]> {
  if (!supabase || !ids.length) return [];
  const { data, error } = await supabase.from('posts').select(POST_COLS).in('id', ids);
  if (error) {
    fail('fetchPostsByIds', error);
    return [];
  }
  return attachPolls((data as PostRow[]).map(toPost));
}

export async function fetchPostsByAuthor(authorId: string, limit = 60): Promise<Post[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLS)
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    fail('fetchPostsByAuthor', error);
    return [];
  }
  return attachPolls((data as PostRow[]).map(toPost));
}

export async function createPost(input: {
  authorId: string;
  kind: PostKind;
  body: string;
  media: string[];
  topics: string[];
  boundary: Boundary;
  readSeconds: number;
  quotePostId?: string;
}): Promise<Post | null> {
  if (!supabase) return fail('createPost', { message: NO_CLIENT });

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: input.authorId,
      kind: input.kind,
      body: input.body,
      topics: input.topics,
      read_seconds: input.readSeconds,
      quote_post_id: input.quotePostId ?? null,
      ...boundaryToRow(input.boundary),
    })
    .select(POST_COLS)
    .single();
  if (error) return fail('createPost', error);

  const row = data as PostRow;

  if (input.media.length) {
    const { error: mediaError } = await supabase
      .from('post_media')
      .insert(input.media.map((url, ordinal) => ({ post_id: row.id, url, ordinal })));
    if (mediaError) fail('createPost.media', mediaError);
    else row.post_media = input.media.map((url, ordinal) => ({ url, ordinal }));
  }

  return toPost(row);
}

export async function deletePost(postId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) fail('deletePost', error);
  return !error;
}

// -------------------------------------------------------------------- polls --

type PollResultRow = {
  poll_id: string;
  post_id: string;
  question: string;
  options: { id: string; text: string }[] | null;
  tallies: Record<string, number> | null;
  my_option_id: string | null;
  total_votes: number;
};

const POLLS_ABSENT = ['PGRST202', 'PGRST205', '42P01', '42883'];

export async function fetchPollsForPosts(postIds: string[]): Promise<Record<string, Poll>> {
  if (!supabase || postIds.length === 0) return {};

  const { data, error } = await supabase.rpc('poll_results', { p_post_ids: postIds });
  if (error) {
    if (!POLLS_ABSENT.includes(error.code ?? '')) fail('fetchPollsForPosts', error);
    return {};
  }

  const byPost: Record<string, Poll> = {};
  for (const r of (data ?? []) as PollResultRow[]) {
    const tallies = r.tallies ?? {};
    byPost[r.post_id] = {
      id: r.poll_id,
      question: r.question,
      options: (r.options ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        votes: tallies[o.id] ?? 0,
      })),
      userVotedOptionId: r.my_option_id ?? undefined,
      totalVotes: r.total_votes,
    };
  }
  return byPost;
}

async function attachPolls(posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) return posts;
  const polls = await fetchPollsForPosts(posts.map((p) => p.id));
  if (Object.keys(polls).length === 0) return posts;
  return posts.map((p) => (polls[p.id] ? { ...p, poll: polls[p.id] } : p));
}

export async function createPoll(
  postId: string,
  question: string,
  options: { id: string; text: string }[],
): Promise<Poll | null> {
  if (!supabase || options.length < 2) return null;

  const { data, error } = await supabase
    .from('polls')
    .insert({ post_id: postId, question, options })
    .select('id, question, options')
    .single();

  if (error) {
    if (!POLLS_ABSENT.includes(error.code ?? '')) fail('createPoll', error);
    return null;
  }

  const row = data as { id: string; question: string; options: { id: string; text: string }[] };
  return {
    id: row.id,
    question: row.question,
    options: row.options.map((o) => ({ id: o.id, text: o.text, votes: 0 })),
    totalVotes: 0,
  };
}

export async function castPollVote(
  pollId: string,
  optionId: string,
  userId: string,
): Promise<boolean> {
  if (!supabase || !userId) return false;

  const { error } = await supabase
    .from('poll_votes')
    .upsert(
      { poll_id: pollId, user_id: userId, option_id: optionId },
      { onConflict: 'poll_id,user_id' },
    );

  if (error) {
    if (!POLLS_ABSENT.includes(error.code ?? '')) fail('castPollVote', error);
    return false;
  }
  ok();
  return true;
}

// ------------------------------------------------------------------ replies --

type ReplyRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: ProfileRow | null;
};

const toReply = (r: ReplyRow): Reply => ({
  id: r.id,
  postId: r.post_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: new Date(r.created_at).getTime(),
});

export async function fetchReplies(
  postId: string,
): Promise<{ replies: Reply[]; authors: Author[] }> {
  if (!supabase) return { replies: [], authors: [] };
  const { data, error } = await supabase
    .from('replies')
    .select(`id, post_id, author_id, body, created_at, author:profiles!replies_author_id_fkey(${PROFILE_COLS})`)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) {
    fail('fetchReplies', error);
    return { replies: [], authors: [] };
  }

  const rows = data as unknown as ReplyRow[];
  const authors = new Map<string, Author>();
  for (const r of rows) if (r.author) authors.set(r.author.id, toAuthor(r.author));
  return { replies: rows.map(toReply), authors: [...authors.values()] };
}

export async function createReply(
  postId: string,
  authorId: string,
  body: string,
): Promise<{ ok: true; reply: Reply } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: NO_CLIENT };

  const { data, error } = await supabase
    .from('replies')
    .insert({ post_id: postId, author_id: authorId, body: body.trim() })
    .select('id, post_id, author_id, body, created_at')
    .single();

  if (!error) return { ok: true, reply: toReply(data as ReplyRow) };

  if (error.code === '42501') {
    return { ok: false, message: 'The author limited who can reply to this post.' };
  }
  fail('createReply', error);
  return { ok: false, message: 'Could not send that reply. Try again in a moment.' };
}

export async function deleteReply(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('replies').delete().eq('id', id);
  if (error) fail('deleteReply', error);
  return !error;
}

// ---------------------------------------------------------------- reactions --

type Reaction = 'likes' | 'boosts' | 'saves';

export async function fetchMyReactions(
  userId: string,
): Promise<{ liked: string[]; boosted: string[]; saved: string[] }> {
  const client = supabase;
  if (!client) return { liked: [], boosted: [], saved: [] };
  const [liked, boosted, saved] = await Promise.all(
    (['likes', 'boosts', 'saves'] as Reaction[]).map((t) =>
      client.from(t).select('post_id').eq('user_id', userId),
    ),
  );
  const ids = (r: { data: { post_id: string }[] | null }) => (r.data ?? []).map((x) => x.post_id);
  return { liked: ids(liked), boosted: ids(boosted), saved: ids(saved) };
}

export async function setReaction(
  table: Reaction,
  postId: string,
  userId: string,
  on: boolean,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = on
    ? await supabase.from(table).insert({ post_id: postId, user_id: userId })
    : await supabase.from(table).delete().eq('post_id', postId).eq('user_id', userId);
  if (error) fail(`setReaction.${table}`, error);
  return !error;
}

// ------------------------------------------------------------------ follows --

export async function fetchMyFollowing(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', userId);
  if (error) {
    fail('fetchMyFollowing', error);
    return [];
  }
  return data.map((r) => r.followee_id as string);
}

export async function fetchMyFollowerIds(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId)
    .limit(5000);
  if (error) {
    fail('fetchMyFollowerIds', error);
    return [];
  }
  return data.map((r) => r.follower_id as string);
}

export async function setFollow(userId: string, targetId: string, on: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = on
    ? await supabase.from('follows').insert({ follower_id: userId, followee_id: targetId })
    : await supabase
        .from('follows')
        .delete()
        .eq('follower_id', userId)
        .eq('followee_id', targetId);
  if (error) fail('setFollow', error);
  return !error;
}

export async function countFollowers(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('followee_id', userId);
  if (error) {
    fail('countFollowers', error);
    return 0;
  }
  return count ?? 0;
}

export async function countFollowing(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId);
  if (error) {
    fail('countFollowing', error);
    return 0;
  }
  return count ?? 0;
}

export async function fetchUserFollowers(userId: string): Promise<Author[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('followee_id', userId);
    if (error || !data) return [];
    const followerIds = data.map((r) => r.follower_id as string);
    if (followerIds.length === 0) return [];
    return await fetchProfilesByIds(followerIds);
  } catch {
    return [];
  }
}

export async function fetchUserFollowing(userId: string): Promise<Author[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', userId);
    if (error || !data) return [];
    const followingIds = data.map((r) => r.followee_id as string);
    if (followingIds.length === 0) return [];
    return await fetchProfilesByIds(followingIds);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ circles --

type CircleRow = {
  id: string;
  name: string;
  color: string;
  glyph: string;
  boost: number;
  circle_members?: { member_id: string }[];
};

export async function fetchMyCircles(): Promise<Circle[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('circles')
    .select('id, name, color, glyph, boost, circle_members(member_id)')
    .order('created_at', { ascending: true });
  if (error) {
    fail('fetchMyCircles', error);
    return [];
  }
  return (data as CircleRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    glyph: r.glyph,
    boost: r.boost,
    memberIds: (r.circle_members ?? []).map((m) => m.member_id),
  }));
}

export async function createCircle(
  ownerId: string,
  name: string,
  color: string,
  glyph: string,
): Promise<Circle | null> {
  if (!supabase) return fail('createCircle', { message: NO_CLIENT });
  const { data, error } = await supabase
    .from('circles')
    .insert({ owner_id: ownerId, name, color, glyph })
    .select('id, name, color, glyph, boost')
    .single();
  if (error) return fail('createCircle', error);
  return { ...(data as CircleRow), memberIds: [] };
}

export async function setCircleMember(
  circleId: string,
  memberId: string,
  on: boolean,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = on
    ? await supabase.from('circle_members').insert({ circle_id: circleId, member_id: memberId })
    : await supabase
        .from('circle_members')
        .delete()
        .eq('circle_id', circleId)
        .eq('member_id', memberId);
  if (error) fail('setCircleMember', error);
  return !error;
}

export async function updateCircle(
  circleId: string,
  patch: { name?: string; color?: string; glyph?: string; boost?: number },
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('circles').update(patch).eq('id', circleId);
  if (error) fail('updateCircle', error);
  return !error;
}

export async function deleteCircle(circleId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('circles').delete().eq('id', circleId);
  if (error) fail('deleteCircle', error);
  return !error;
}

// ------------------------------------------------------------------- spaces --

export async function fetchSpaces(): Promise<Space[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, description, hue, topics, space_members(count)')
    .order('created_at', { ascending: false });
  if (error) {
    fail('fetchSpaces', error);
    return [];
  }
  return (data as (Omit<Space, 'members'> & { space_members?: { count: number }[] })[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    hue: r.hue,
    topics: r.topics,
    members: countOf(r.space_members),
  }));
}

export async function fetchMySpaceIds(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('space_members')
    .select('space_id')
    .eq('member_id', userId);
  if (error) {
    fail('fetchMySpaceIds', error);
    return [];
  }
  return data.map((r) => r.space_id as string);
}

export async function setSpaceMember(
  spaceId: string,
  userId: string,
  on: boolean,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = on
    ? await supabase.from('space_members').insert({ space_id: spaceId, member_id: userId })
    : await supabase
        .from('space_members')
        .delete()
        .eq('space_id', spaceId)
        .eq('member_id', userId);
  if (error) fail('setSpaceMember', error);
  return !error;
}

// -------------------------------------------------------------- algo state --

type AlgoStateRow = {
  topic_weights: Record<string, number>;
  author_weights: Record<string, number>;
  dials: AlgoState['dials'];
  modes: AlgoState['modes'];
  updated_at: string;
};

export async function fetchAlgoState(
  userId: string,
): Promise<{ algo: AlgoState; updatedAt: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('algo_state')
    .select('topic_weights, author_weights, dials, modes, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return fail('fetchAlgoState', error);
  if (!data) return null;

  const r = data as AlgoStateRow;
  return {
    algo: {
      topicWeights: r.topic_weights ?? {},
      authorWeights: r.author_weights ?? {},
      dials: r.dials,
      modes: r.modes ?? [],
    },
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function saveAlgoState(userId: string, algo: AlgoState): Promise<number | null> {
  if (!supabase) return null;
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('algo_state').upsert(
    {
      user_id: userId,
      topic_weights: algo.topicWeights,
      author_weights: algo.authorWeights,
      dials: algo.dials,
      modes: algo.modes,
      updated_at: updatedAt,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    fail('saveAlgoState', error);
    return null;
  }
  return new Date(updatedAt).getTime();
}

// ----------------------------------------------------------------- ledger --

type LedgerRow = {
  id: string;
  at: string;
  summary: string;
  source: AlgoLedgerEntry['source'];
  revert: AlgoLedgerEntry['revert'];
  undone: boolean;
};

export async function fetchLedger(userId: string, limit = 60): Promise<AlgoLedgerEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('algo_ledger')
    .select('id, at, summary, source, revert, undone')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) {
    fail('fetchLedger', error);
    return [];
  }
  return (data as LedgerRow[]).map((r) => ({
    id: r.id,
    at: new Date(r.at).getTime(),
    summary: r.summary,
    source: r.source,
    revert: r.revert ?? {},
    undone: r.undone,
  }));
}

export async function saveLedgerEntries(
  userId: string,
  entries: AlgoLedgerEntry[],
): Promise<boolean> {
  if (!supabase || !entries.length) return false;
  const { error } = await supabase.from('algo_ledger').upsert(
    entries.map((e) => ({
      id: e.id,
      user_id: userId,
      at: new Date(e.at).toISOString(),
      summary: e.summary,
      source: e.source,
      revert: e.revert,
      undone: e.undone,
    })),
    { onConflict: 'id' },
  );
  if (error) fail('saveLedgerEntries', error);
  return !error;
}

// ------------------------------------------------------------------- drafts --

const DRAFT_COLS =
  'id, kind, body, media, topics, is_public, visible_circle_ids, reply_policy, quote_post_id, saved_at';

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    kind: r.kind,
    body: r.body,
    media: r.media,
    topics: r.topics,
    boundary: boundaryFromRow(r),
    quotePostId: r.quote_post_id ?? undefined,
    poll: r.poll ?? undefined,
    savedAt: new Date(r.saved_at).getTime(),
  };
}

export async function fetchMyDrafts(): Promise<Draft[]> {
  if (!supabase) return [];

  const read = (cols: string) =>
    supabase!.from('drafts').select(cols).order('saved_at', { ascending: false });

  let { data, error } = await read(`${DRAFT_COLS}, poll`);
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await read(DRAFT_COLS));
  }

  if (error) {
    fail('fetchMyDrafts', error);
    return [];
  }
  return (data as unknown as DraftRow[]).map(toDraft);
}

export async function upsertDraft(
  ownerId: string,
  draft: Omit<Draft, 'savedAt' | 'id'> & { id?: string },
): Promise<Draft | null> {
  if (!supabase) return fail('upsertDraft', { message: NO_CLIENT });
  const base = {
    owner_id: ownerId,
    kind: draft.kind,
    body: draft.body,
    media: draft.media,
    topics: draft.topics,
    quote_post_id: draft.quotePostId ?? null,
    ...boundaryToRow(draft.boundary),
    saved_at: new Date().toISOString(),
  };

  const write = (row: object, cols: string) => {
    const q = draft.id
      ? supabase!.from('drafts').update(row).eq('id', draft.id)
      : supabase!.from('drafts').insert(row);
    return q.select(cols).single();
  };

  let { data, error } = await write(
    { ...base, poll: draft.poll ?? null },
    `${DRAFT_COLS}, poll`,
  );
  if (error && (error.code === 'PGRST204' || error.code === UNDEFINED_COLUMN)) {
    ({ data, error } = await write(base, DRAFT_COLS));
  }

  if (error) return fail('upsertDraft', error);
  return toDraft(data as unknown as DraftRow);
}

export async function deleteDraft(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('drafts').delete().eq('id', id);
  if (error) fail('deleteDraft', error);
  return !error;
}

// ------------------------------------------------------------- notifications --

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string;
  type: 'like' | 'boost' | 'reply' | 'follow' | 'circle' | 'profile_view' | 'post';
  post_id: string | null;
  reply_id: string | null;
  read: boolean;
  created_at: string;
};

export async function fetchRemoteNotifications(userId: string): Promise<NotificationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    fail('fetchRemoteNotifications', error);
    return [];
  }
  return (data as NotificationRow[]) ?? [];
}

export async function markRemoteNotificationsRead(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) fail('markRemoteNotificationsRead', error);
  return !error;
}

export async function recordRemoteProfileView(targetUserId: string, viewerId: string): Promise<void> {
  if (!supabase || !targetUserId || !viewerId || targetUserId === viewerId) return;
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({ user_id: targetUserId, actor_id: viewerId, type: 'profile_view' });
    if (error && error.code !== '23505') fail('recordRemoteProfileView', error);
  } catch {
    // Non-blocking fail-soft
  }
}

// ------------------------------------------------------------- stories db --

export async function fetchRemoteStories(authorIds: string[], viewerId?: string): Promise<Story[]> {
  if (!supabase || authorIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('story_items')
      .select('id, author_id, media_url, kind, caption, hidden_user_ids, created_at')
      .in('author_id', authorIds.slice(0, 300))
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(600);

    if (error || !data) return [];

    const grouped = new Map<string, StoryItem[]>();
    for (const row of data) {
      const list = grouped.get(row.author_id) ?? [];
      list.push({
        id: row.id,
        media: row.media_url,
        kind: row.kind as 'photo' | 'video',
        caption: row.caption ?? undefined,
        hiddenUserIds: row.hidden_user_ids ?? [],
        createdAt: new Date(row.created_at).getTime(),
      });
      grouped.set(row.author_id, list);
    }

    const watched = new Set<string>();
    if (viewerId) {
      const ids = data.map((row) => row.id);
      if (ids.length) {
        const { data: views } = await supabase
          .from('story_views')
          .select('story_item_id')
          .eq('viewer_id', viewerId)
          .in('story_item_id', ids);
        for (const v of views ?? []) watched.add(v.story_item_id as string);
      }
    }

    return [...grouped.entries()].map(([authorId, items]) => {
      const marked = items.map((it) => (watched.has(it.id) ? { ...it, seen: true } : it));
      return {
        id: `story_${authorId}`,
        authorId,
        items: marked,
        hasUnseen: marked.some((it) => !it.seen),
      };
    });
  } catch {
    return [];
  }
}

export async function createRemoteStoryItem(input: {
  id: string;
  authorId: string;
  mediaUrl: string;
  kind: 'photo' | 'video';
  caption?: string;
  hiddenUserIds?: string[];
}): Promise<string | null> {
  if (!supabase) return null;
  try {
    let storyId: string | null = null;
    const { data: existing } = await supabase
      .from('stories')
      .select('id')
      .eq('author_id', input.authorId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      storyId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from('stories')
        .insert({ author_id: input.authorId })
        .select('id')
        .single();
      if (error) return fail('createRemoteStoryItem.parent', error);
      storyId = created?.id ?? null;
    }
    if (!storyId) return null;

    const { data: item, error } = await supabase
      .from('story_items')
      .insert({
        id: input.id,
        story_id: storyId,
        author_id: input.authorId,
        media_url: input.mediaUrl,
        kind: input.kind,
        caption: input.caption ?? null,
        hidden_user_ids: input.hiddenUserIds ?? [],
      })
      .select('id')
      .single();

    if (error) return fail('createRemoteStoryItem', error);
    return item?.id ?? null;
  } catch {
    return null;
  }
}

export async function deleteRemoteStoryItem(itemId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('story_items').delete().eq('id', itemId);
    if (error) fail('deleteRemoteStoryItem', error);
    return !error;
  } catch {
    return false;
  }
}

export async function recordStoryView(itemId: string, viewerId: string): Promise<void> {
  if (!supabase || !itemId || !viewerId) return;
  const { error } = await supabase
    .from('story_views')
    .upsert({ story_item_id: itemId, viewer_id: viewerId }, { onConflict: 'story_item_id,viewer_id', ignoreDuplicates: true });
  const quiet = ['23505', '42P01', 'PGRST205'];
  if (error && !quiet.includes(error.code ?? '') && !/network|fetch failed/i.test(error.message)) {
    console.warn('[db] recordStoryView', error.message);
  }
}

export async function fetchStoryViewCounts(itemIds: string[]): Promise<Record<string, number>> {
  if (!supabase || itemIds.length === 0) return {};
  const { data, error } = await supabase
    .from('story_views')
    .select('story_item_id')
    .in('story_item_id', itemIds);
  if (error || !data) return {};

  const counts: Record<string, number> = {};
  for (const r of data) counts[r.story_item_id] = (counts[r.story_item_id] ?? 0) + 1;
  return counts;
}

export async function fetchStoryViewers(
  itemId: string,
): Promise<{ author: Author; viewedAt: number }[]> {
  if (!supabase || !itemId) return [];
  const { data, error } = await supabase
    .from('story_views')
    .select('viewer_id, viewed_at')
    .eq('story_item_id', itemId)
    .order('viewed_at', { ascending: false })
    .limit(200);
  if (error || !data || data.length === 0) return [];

  const profiles = await fetchProfilesByIds(data.map((r) => r.viewer_id as string));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return data
    .map((r) => {
      const author = byId.get(r.viewer_id as string);
      return author ? { author, viewedAt: new Date(r.viewed_at).getTime() } : null;
    })
    .filter((x): x is { author: Author; viewedAt: number } => x !== null);
}

export async function setStoryItemHiddenUsers(
  itemId: string,
  hiddenUserIds: string[],
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('story_items')
    .update({ hidden_user_ids: hiddenUserIds })
    .eq('id', itemId);
  if (error) fail('setStoryItemHiddenUsers', error);
  return !error;
}

// ------------------------------------------------------------- messages db --

export async function uploadVoiceNote(
  userId: string,
  uri: string,
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const res = await fetch(uri);
    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength) return null;
    const path = `${userId}/voice_${Date.now()}.m4a`;
    const { error } = await supabase.storage.from('post-media').upload(path, bytes, {
      contentType: 'audio/m4a',
      upsert: false,
    });
    if (error) return null;
    return supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

export async function fetchRemoteConversations(userId: string): Promise<ChatConversation[]> {
  if (!supabase) return [];
  try {
    const { data: participations, error } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId)
      .limit(500);

    if (error || !participations || participations.length === 0) return [];

    const convIds = participations.map((p) => p.conversation_id);
    const readAt = new Map(
      participations.map((p) => [p.conversation_id, new Date(p.last_read_at).getTime()]),
    );

    const [convRes, previewRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, title, is_group, circle_id, updated_at, conversation_participants(user_id)')
        .in('id', convIds)
        .order('updated_at', { ascending: false }),
      supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, media_url, voice_url, voice_duration, shared_post_id, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(400),
    ]);

    if (convRes.error || !convRes.data) return [];
    ok();

    const newest = new Map<string, DirectMessage>();
    const unread = new Map<string, number>();
    for (const m of previewRes.data ?? []) {
      const at = new Date(m.created_at).getTime();
      if (!newest.has(m.conversation_id)) {
        newest.set(m.conversation_id, {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          body: m.body,
          media: m.media_url ?? undefined,
          voiceNote: m.voice_url
            ? { uri: m.voice_url, durationSeconds: m.voice_duration ?? 5 }
            : undefined,
          sharedPostId: m.shared_post_id ?? undefined,
          createdAt: at,
          read: true,
        });
      }
      if (m.sender_id !== userId && at > (readAt.get(m.conversation_id) ?? 0)) {
        unread.set(m.conversation_id, (unread.get(m.conversation_id) ?? 0) + 1);
      }
    }

    return convRes.data.map((c) => {
      const others = ((c.conversation_participants as { user_id: string }[]) ?? [])
        .map((p) => p.user_id)
        .filter((id) => id !== userId);

      return {
        id: c.id,
        participantIds: others.length > 0 ? others : [userId],
        title: c.title ?? undefined,
        isCircleGroup: c.is_group ?? false,
        circleId: c.circle_id ?? undefined,
        unreadCount: unread.get(c.id) ?? 0,
        lastMessage: newest.get(c.id),
      };
    });
  } catch {
    return [];
  }
}

export async function markConversationRead(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) fail('markConversationRead', error);
  return !error;
}

export async function fetchRemoteMessages(
  conversationId: string,
  limit = 100,
): Promise<DirectMessage[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, body, media_url, voice_url, voice_duration, shared_post_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    data.reverse();
    ok();

    return data.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      body: m.body,
      media: m.media_url ?? undefined,
      voiceNote: m.voice_url
        ? {
            uri: m.voice_url,
            durationSeconds: m.voice_duration ?? 5,
          }
        : undefined,
      sharedPostId: m.shared_post_id ?? undefined,
      createdAt: new Date(m.created_at).getTime(),
      read: true,
    }));
  } catch {
    return [];
  }
}

export async function sendRemoteMessage(input: {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  voiceUri?: string;
  voiceDuration?: number;
  sharedPostId?: string;
  mediaUrl?: string;
}): Promise<boolean> {
  if (!supabase) return false;
  try {
    let remoteVoiceUrl: string | null = null;
    if (input.voiceUri) {
      if (/^https?:\/\//.test(input.voiceUri)) {
        remoteVoiceUrl = input.voiceUri;
      } else {
        const uploaded = await uploadVoiceNote(input.senderId, input.voiceUri);
        if (!uploaded) return false;
        remoteVoiceUrl = uploaded;
      }
    }

    const { error } = await supabase.from('messages').upsert(
      {
        id: input.id,
        conversation_id: input.conversationId,
        sender_id: input.senderId,
        body: input.body,
        voice_url: remoteVoiceUrl,
        voice_duration: input.voiceDuration ?? null,
        shared_post_id: input.sharedPostId ?? null,
        media_url: input.mediaUrl ?? null,
      },
      { onConflict: 'id' },
    );

    if (error) {
      fail('sendRemoteMessage', error);
      return false;
    }

    void supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.conversationId);

    ok();
    return true;
  } catch (err) {
    console.warn('[db] sendRemoteMessage', err);
    return false;
  }
}

export async function createRemoteConversation(
  userId: string,
  targetUserId: string,
): Promise<string | null> {
  if (!supabase) return null;
  if (userId === targetUserId) return null;

  const rpc = await supabase.rpc('create_direct_conversation', {
    target_user_id: targetUserId,
  });
  if (!rpc.error && typeof rpc.data === 'string') {
    ok();
    return rpc.data;
  }
  if (rpc.error && rpc.error.code !== 'PGRST202') {
    return fail('createRemoteConversation', rpc.error);
  }

  try {
    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId)
      .limit(500);

    if (myConvs && myConvs.length > 0) {
      const convIds = myConvs.map((p) => p.conversation_id);
      const { data: shared } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(is_group)')
        .eq('user_id', targetUserId)
        .in('conversation_id', convIds)
        .eq('conversations.is_group', false)
        .limit(1)
        .maybeSingle();

      if (shared?.conversation_id) return shared.conversation_id;
    }

    const convId = newUUID();

    let { error } = await supabase
      .from('conversations')
      .insert({ id: convId, is_group: false, created_by: userId });

    if (error && (error.code === 'PGRST204' || error.code === UNDEFINED_COLUMN)) {
      ({ error } = await supabase
        .from('conversations')
        .insert({ id: convId, is_group: false }));
    }

    if (error) return fail('createRemoteConversation', error);
    const conv = { id: convId };

    const { error: partError } = await supabase.from('conversation_participants').insert([
      { conversation_id: conv.id, user_id: userId },
      { conversation_id: conv.id, user_id: targetUserId },
    ]);

    if (partError) {
      fail('createRemoteConversation.participants', partError);
      void supabase.from('conversations').delete().eq('id', conv.id);
      return null;
    }

    ok();
    return conv.id;
  } catch (err) {
    console.warn('[db] createRemoteConversation', err);
    return null;
  }
}