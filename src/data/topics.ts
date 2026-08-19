import type { Topic } from './types';

/**
 * Interests offered at setup and used as ranking topics.
 *
 * Deliberately everyday categories rather than a taxonomy — someone picking
 * their feed in the first minute thinks "food, going out, sport", not
 * "generative media" — and broad enough that a dozen picks covers most people.
 *
 * This is the one list that survived the seed data being deleted, because it is
 * not content: these ids are what `posts.topics` stores in the database and what
 * every topic weight is keyed by. Changing an id here orphans every row that
 * used it, so treat the ids as permanent even when the labels change.
 */
/**
 * Photography for the topic tiles.
 *
 * Setup used to be twenty-two identical grey pills with a wire icon on each,
 * which is a form, not a choice — the eye has nothing to catch on and every
 * option costs the same amount of reading. A picture of the thing is recognised
 * before it is read, so the grid can be scanned rather than parsed.
 *
 * These are Unsplash CDN URLs with the crop and size baked into the query, so
 * each tile downloads roughly 30–40 KB rather than a full-resolution photo. They
 * are hotlinked deliberately: bundling twenty-two photographs would add several
 * megabytes to the binary for a screen most people see once.
 *
 * **To swap in your own art**, replace the URL and nothing else — every consumer
 * reads `topic.image` and falls back to `hue` + `glyph` when it is absent, so a
 * missing or slow image degrades to the old treatment rather than to a hole.
 */
const shot = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=320&h=320&q=70`;

export const TOPICS: Topic[] = [
  { id: 'food', label: 'Food', glyph: 'coffee', hue: '#9C5A2D', image: shot('1504674900247-0877df9cc836') },
  { id: 'football', label: 'Sport', glyph: 'target', hue: '#4A6741', image: shot('1431324155629-1a6deb1dec8d') },
  { id: 'music', label: 'Music', glyph: 'music', hue: '#8C3A4A', image: shot('1511671782779-c97d3d27a1d4') },
  { id: 'photography', label: 'Photography', glyph: 'camera', hue: '#3D5A6C', image: shot('1452780212940-6f5c0d14d848') },
  { id: 'film', label: 'Film & TV', glyph: 'film', hue: '#40556B', image: shot('1489599849927-2ee91cede3ba') },
  { id: 'design', label: 'Design', glyph: 'pen-tool', hue: '#A2542A', image: shot('1561070791-2526d30994b5') },
  { id: 'ai', label: 'Tech & AI', glyph: 'cpu', hue: '#544A78', image: shot('1518770660439-4636190af475') },
  { id: 'startups', label: 'Business', glyph: 'trending-up', hue: '#8A6A12', image: shot('1454165804606-c3d57bc86b40') },
  { id: 'science', label: 'Science', glyph: 'activity', hue: '#35656B', image: shot('1532094349884-543bc11b234d') },
  { id: 'climate', label: 'Climate', glyph: 'wind', hue: '#3F6B5A', image: shot('1470071459604-3b5ec3a7fe05') },
  { id: 'gossip', label: 'Celebrity', glyph: 'tv', hue: '#6B5B7B', image: shot('1516450360452-9312f5e86fc7') },
  { id: 'crypto', label: 'Crypto', glyph: 'hash', hue: '#6A6259', image: shot('1621761191319-c6fb62004040') },

  { id: 'outings', label: 'Going Out', glyph: 'map-pin', hue: '#B0483F', image: shot('1514933651103-005eec06c04b') },
  { id: 'travel', label: 'Travel', glyph: 'compass', hue: '#2F6B7A', image: shot('1488646953014-85cb44e25828') },
  { id: 'fitness', label: 'Fitness', glyph: 'zap', hue: '#7A5A2A', image: shot('1534438327276-14e5300c3a48') },
  { id: 'fashion', label: 'Fashion', glyph: 'shopping-bag', hue: '#8B3F63', image: shot('1445205170230-053b83016050') },
  { id: 'gaming', label: 'Gaming', glyph: 'command', hue: '#4B4A8C', image: shot('1542751371-adc38448a05e') },
  { id: 'comedy', label: 'Comedy', glyph: 'smile', hue: '#94702A', image: shot('1527224538127-2104bb71c51b') },
  { id: 'books', label: 'Books', glyph: 'book-open', hue: '#5C6B45', image: shot('1481627834876-b7833e8f5570') },
  { id: 'cars', label: 'Cars', glyph: 'truck', hue: '#59606B', image: shot('1503376780353-7e6692767b70') },
  { id: 'family', label: 'Family', glyph: 'home', hue: '#7A4A5E', image: shot('1511895426328-dc8714191300') },
  { id: 'faith', label: 'Faith', glyph: 'sunrise', hue: '#7C6A3E', image: shot('1507692049790-de58290a4334') },
];


/** Lookup by id, which is how every screen actually reads a topic. */
export const TOPIC_BY_ID: Record<string, Topic> = Object.fromEntries(
  TOPICS.map((t) => [t.id, t]),
);
