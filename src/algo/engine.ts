/**
 * Vybe ranking engine.
 *
 * Design rule: the engine may not use a single signal the user cannot see and
 * change. Every term below is (measured signal × user-set weight), and every
 * term is emitted into a ScoreReceipt so the post can explain itself.
 *
 * There is deliberately no engagement-prediction model, no dwell-time
 * surveillance term, and no house thumb on the scale.
 */

import { TOPIC_BY_ID } from '@/data/topics';
import type {
  AlgoDials,
  AlgoState,
  Author,
  Circle,
  FeedMode,
  Post,
  ScoreFactor,
  ScoreReceipt,
} from '@/data/types';

/**
 * Who wrote what, as far as the caller knows.
 *
 * The engine used to import the author list directly, which quietly made it
 * depend on a fixed cast of people. It now receives them, so it ranks whatever
 * it is handed and an author it has never heard of degrades to "not followed,
 * in no circle" rather than throwing.
 */
export type AuthorLookup = Record<string, Author | undefined>;

export const DEFAULT_DIALS: AlgoDials = {
  topicPull: 0.75,
  freshness: 0.6,
  crowd: 0.25,
  intimacy: 0.7,
  serendipity: 0.3,
  variety: 0.5,
};

export const DIAL_META: {
  key: keyof AlgoDials;
  label: string;
  glyph: string;
  low: string;
  high: string;
  blurb: string;
}[] = [
  {
    key: 'topicPull',
    label: 'Topic pull',
    glyph: 'filter',
    low: 'Ignore my topics',
    high: 'Obey my topics',
    blurb: 'How hard your topic sliders pull the feed toward what you asked for.',
  },
  {
    key: 'freshness',
    label: 'Freshness',
    glyph: 'clock',
    low: 'Timeless',
    high: 'Minutes old',
    blurb: 'Sets the half-life of a post. High means anything over a few hours sinks.',
  },
  {
    key: 'crowd',
    label: 'Crowd',
    glyph: 'trending-up',
    low: 'Popularity is irrelevant',
    high: 'Show me what is big',
    blurb: 'The only place virality can enter your feed. Set it to zero and it cannot.',
  },
  {
    key: 'intimacy',
    label: 'Intimacy',
    glyph: 'users',
    low: 'Everyone is equal',
    high: 'Close circles first',
    blurb: 'How far your Circles outrank the rest of the people you follow.',
  },
  {
    key: 'serendipity',
    label: 'Serendipity',
    glyph: 'compass',
    low: 'Only what I asked for',
    high: 'Surprise me',
    blurb: 'Deliberate room for things outside your profile, so you do not seal yourself in.',
  },
  {
    key: 'variety',
    label: 'Variety',
    glyph: 'shuffle',
    low: 'Let one voice dominate',
    high: 'Spread it around',
    blurb: 'Penalises repeat authors so no single account can own your day.',
  },
];

/** Active (non-expired) temporary modes, folded into effective topic weights. */
export function effectiveTopicWeights(state: AlgoState, at = Date.now()): Record<string, number> {
  const out: Record<string, number> = { ...state.topicWeights };
  for (const m of state.modes) {
    if (m.expiresAt <= at) continue;
    out[m.topicId] = clamp((out[m.topicId] ?? 0) + m.delta, -1, 1);
  }
  return out;
}

export function activeModes(state: AlgoState, at = Date.now()) {
  return state.modes.filter((m) => m.expiresAt > at);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministic 0–1 hash, so "serendipity" is stable per (post, day). */
function stableNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

type ScoreContext = {
  state: AlgoState;
  circles: Circle[];
  authors: AuthorLookup;
  seenIds: Set<string>;
  now: number;
  /** How many higher-ranked posts already came from this author. */
  authorRunLength: number;
  weights: Record<string, number>;
};

/**
 * Score a single post and produce its receipt in one pass — the receipt is not
 * a reconstruction after the fact, it *is* the computation.
 */
export function scorePost(post: Post, ctx: ScoreContext): { total: number; factors: ScoreFactor[] } {
  const { state, circles, authors, now, weights } = ctx;
  const d = state.dials;
  const factors: ScoreFactor[] = [];

  // 1. Topic affinity — the user's explicit sliders.
  if (post.topics.length) {
    const per = post.topics.map((t) => ({ t, w: weights[t] ?? 0 }));
    const strongest = per.reduce((a, b) => (Math.abs(b.w) > Math.abs(a.w) ? b : a));
    const avg = per.reduce((s, x) => s + x.w, 0) / per.length;
    const label = TOPIC_BY_ID[strongest.t]?.label ?? strongest.t;
    factors.push({
      key: 'topic',
      label: 'Your topic settings',
      signal: avg,
      weight: d.topicPull,
      contribution: avg * d.topicPull,
      because:
        Math.abs(strongest.w) < 0.05
          ? `You have no strong opinion on ${label} yet.`
          : strongest.w > 0
            ? `You asked for more ${label} (${fmtSigned(strongest.w)}).`
            : `You asked for less ${label} (${fmtSigned(strongest.w)}).`,
      actionableTopic: strongest.t,
    });
  }

  // 2. Recency — half-life derived directly from the freshness dial.
  const hours = (now - post.createdAt) / 3600_000;
  const halfLife = 48 - d.freshness * 44; // 48h at 0 … 4h at 1
  const recency = Math.pow(0.5, hours / Math.max(halfLife, 0.5));
  factors.push({
    key: 'recency',
    label: 'Freshness',
    signal: recency,
    weight: d.freshness,
    contribution: recency * d.freshness,
    because: `Posted ${fmtAge(hours)} ago; at your setting posts halve in value every ${Math.round(halfLife)}h.`,
  });

  // 3. Crowd — the single gateway for virality, and it can be shut.
  const crowdSignal = Math.min(1, Math.log10(1 + post.likes + post.boosts * 2) / 5);
  factors.push({
    key: 'crowd',
    label: 'Crowd size',
    signal: crowdSignal,
    weight: d.crowd,
    contribution: crowdSignal * d.crowd,
    because:
      d.crowd === 0
        ? 'You switched popularity off, so this counted for nothing.'
        : // Reach is not measured server-side, so the receipt reports the two
          // counts that are real rather than a virality share that would have
          // to be invented.
          `${fmtCount(post.likes)} likes, ${fmtCount(post.boosts)} boosts.`,
  });

  // 4. Intimacy — circle membership beats a raw follow.
  const author = authors[post.authorId];
  const memberCircles = circles.filter((c) => c.memberIds.includes(post.authorId));
  const circleBoost = memberCircles.reduce((m, c) => Math.max(m, c.boost), 0);
  const tie = memberCircles.length ? circleBoost : author?.following ? 0.35 : 0;
  factors.push({
    key: 'intimacy',
    label: 'Closeness',
    signal: tie,
    weight: d.intimacy,
    contribution: tie * d.intimacy,
    because: memberCircles.length
      ? `${author?.name ?? 'They'} is in your ${memberCircles.map((c) => c.name).join(' and ')} circle.`
      : author?.following
        ? `You follow ${author.name}, but they are not in a Circle.`
        : `You do not follow ${author?.name ?? 'this account'}.`,
  });

  // 5. Serendipity — stable per post so the feed does not shuffle under you.
  const noise = stableNoise(post.id + Math.floor(now / 86_400_000));
  const offProfile = post.topics.every((t) => (weights[t] ?? 0) <= 0.05);
  const serendipity = offProfile ? noise : noise * 0.3;
  factors.push({
    key: 'serendipity',
    label: 'Serendipity',
    signal: serendipity,
    weight: d.serendipity,
    contribution: serendipity * d.serendipity,
    because: offProfile
      ? 'This sits outside your stated interests — you left room for that.'
      : 'A small nudge so your feed does not close in on itself.',
  });

  // 6. Variety — penalty for an author already occupying the feed.
  const repeat = ctx.authorRunLength;
  const varietyPenalty = repeat === 0 ? 0 : -Math.min(1, repeat * 0.5);
  if (varietyPenalty !== 0) {
    factors.push({
      key: 'variety',
      label: 'Variety',
      signal: varietyPenalty,
      weight: d.variety,
      contribution: varietyPenalty * d.variety,
      because: `${author?.name ?? 'This account'} already appears ${repeat} time${repeat > 1 ? 's' : ''} above.`,
    });
  }

  // 7. Author-level nudges from "Dear Algo" / receipt actions.
  const aw = state.authorWeights[post.authorId] ?? 0;
  if (aw !== 0) {
    factors.push({
      key: 'author',
      label: 'Your note about this account',
      signal: aw,
      weight: 1,
      contribution: aw,
      because:
        aw > 0
          ? `You told @my_algo you wanted more from @${author?.handle}.`
          : `You told @my_algo you wanted less from @${author?.handle}.`,
    });
  }

  // 8. Already seen — a soft demotion, never a hard hide.
  if (ctx.seenIds.has(post.id)) {
    factors.push({
      key: 'seen',
      label: 'Already seen',
      signal: -0.4,
      weight: 1,
      contribution: -0.4,
      because: 'You have scrolled past this once already.',
    });
  }

  const total = factors.reduce((s, f) => s + f.contribution, 0);
  return { total, factors };
}

/**
 * Is this post visible to the viewer, given its Boundary?
 *
 * A rendering convenience only. The real enforcement is `can_view_post()` in
 * the database, which decides what is in the result set in the first place —
 * this cannot widen that, only narrow it.
 */
export function canView(post: Post, myCircleMemberships: string[], viewerId?: string): boolean {
  if (post.boundary.visibleTo.includes('public')) return true;
  // The viewer sees their own posts, and posts aimed at circles they are in.
  if (viewerId && post.authorId === viewerId) return true;
  return post.boundary.visibleTo.some((c) => myCircleMemberships.includes(c));
}

export type RankedPost = {
  post: Post;
  receipt: ScoreReceipt;
};

/**
 * Rank a feed. `variety` is applied greedily during selection rather than as a
 * pre-pass, so the penalty reflects the feed actually being built.
 */
export function rankFeed(opts: {
  posts: Post[];
  state: AlgoState;
  circles?: Circle[];
  authors?: AuthorLookup;
  seenIds?: Set<string>;
  mode: FeedMode;
  now?: number;
  myCircleMemberships?: string[];
  /** The signed-in user, so their own posts are never filtered out. */
  viewerId?: string;
}): RankedPost[] {
  const {
    posts,
    state,
    circles = [],
    authors = {},
    seenIds = new Set<string>(),
    mode,
    now = Date.now(),
    // The server has already applied the Boundary to everything in `posts`, so
    // an empty membership list is safe here: `canView` can only narrow further.
    myCircleMemberships = [],
    viewerId,
  } = opts;

  const visible = posts.filter((p) => canView(p, myCircleMemberships, viewerId));

  if (mode === 'latest' || mode === 'following') {
    const pool =
      mode === 'following' ? visible.filter((p) => authors[p.authorId]?.following) : visible;
    return [...pool]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((post, i) => ({
        post,
        receipt: {
          postId: post.id,
          total: 0,
          rank: i + 1,
          factors: [
            {
              key: 'chronological',
              label: 'Chronological',
              signal: 1,
              weight: 1,
              contribution: 0,
              because: 'Ranking is switched off in this feed. Newest first, nothing else.',
            },
          ],
          headline: 'Chronological — no ranking applied',
        },
      }));
  }

  if (mode === 'circles') {
    const inCircle = new Set(circles.flatMap((c) => c.memberIds));
    return rankFeed({ ...opts, mode: 'for-you', posts: visible.filter((p) => inCircle.has(p.authorId)) });
  }

  const weights = effectiveTopicWeights(state, now);
  const runCount: Record<string, number> = {};
  const remaining = [...visible];
  const out: RankedPost[] = [];

  while (remaining.length) {
    let bestIdx = 0;
    let best = -Infinity;
    let bestFactors: ScoreFactor[] = [];

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const { total, factors } = scorePost(p, {
        state,
        circles,
        authors,
        seenIds,
        now,
        authorRunLength: runCount[p.authorId] ?? 0,
        weights,
      });
      if (total > best) {
        best = total;
        bestIdx = i;
        bestFactors = factors;
      }
    }

    const [chosen] = remaining.splice(bestIdx, 1);
    runCount[chosen.authorId] = (runCount[chosen.authorId] ?? 0) + 1;
    out.push({
      post: chosen,
      receipt: {
        postId: chosen.id,
        total: best,
        rank: out.length + 1,
        factors: bestFactors,
        headline: headlineFor(bestFactors),
      },
    });
  }

  return out;
}

function headlineFor(factors: ScoreFactor[]): string {
  const ranked = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = ranked[0];
  if (!top) return 'No factors applied';
  const dir = top.contribution >= 0 ? 'lifted' : 'pushed down';
  return `Mostly ${dir} by ${top.label.toLowerCase()}`;
}

/**
 * Diff two rankings, for the live "your change did this" readout after any
 * algorithm edit.
 */
export function diffRankings(before: RankedPost[], after: RankedPost[]) {
  const beforeRank = new Map(before.map((r, i) => [r.post.id, i]));
  const moves = after.map((r, i) => {
    const was = beforeRank.get(r.post.id);
    return {
      postId: r.post.id,
      from: was ?? null,
      to: i,
      delta: was == null ? 0 : was - i,
    };
  });
  const climbed = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta);
  const fell = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);
  return {
    moves,
    biggestClimb: climbed[0] ?? null,
    biggestFall: fell[0] ?? null,
    changed: moves.filter((m) => m.delta !== 0).length,
  };
}

export const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Parse a natural-language instruction aimed at @my_algo.
 * Accepts things like "@my_algo show me less like this" or
 * "@my_algo more photography for 3 days".
 */
export function parseDearAlgo(
  text: string,
  contextTopics: string[] = [],
): { direction: 1 | -1; topicId?: string; days?: number; matchedPhrase: string } | null {
  const t = text.toLowerCase();
  if (!t.includes('@my_algo')) return null;

  const negative = /\b(less|fewer|stop|mute|hide|down|not interested)\b/.test(t);
  const positive = /\b(more|show me more|boost|up|again)\b/.test(t);
  if (!negative && !positive) return null;
  const direction: 1 | -1 = negative ? -1 : 1;

  let topicId: string | undefined;
  for (const [id, topic] of Object.entries(TOPIC_BY_ID)) {
    if (t.includes(topic.label.toLowerCase()) || t.includes(id)) {
      topicId = id;
      break;
    }
  }
  // "less like this" resolves against whatever the user was looking at.
  if (!topicId && /\b(this|that|these)\b/.test(t)) topicId = contextTopics[0];

  const dayMatch = t.match(/(\d+)\s*(day|days|week|weeks)/);
  const days = dayMatch
    ? parseInt(dayMatch[1], 10) * (dayMatch[2].startsWith('week') ? 7 : 1)
    : undefined;

  return { direction, topicId, days, matchedPhrase: text.trim() };
}
