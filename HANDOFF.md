# Vybe — session handoff

**Written 17 Aug 2026, end of the hardening pass.** Start here; `progress.md` is
the long-form log with the reasoning behind every decision below.

---

## 1. Do this first

### The database is fully migrated — 0001 through 0015

All of them are applied to `Vybe-backend` (`lbppjcyzgrkhtygbporq`), and the CLI's
migration history now agrees with the database, which it did not before.

| Migration | What it does |
|---|---|
| `0008_security_hardening` | Closes the DM-read hole and notification forgery; size caps; storage limits |
| `0009_push_and_age` | `device_tokens`, `profiles.age_range`, follower fan-out trigger |
| `0010_story_views` | Who watched your story |
| `0011_create_conversation_rpc` | Atomic DM creation |
| `0012_message_retention` | 7-day message expiry + sweeper |
| `0013_poll_results` | Server-side poll tallies |
| `0014_draft_polls` | `drafts.poll`, so a saved draft keeps its question |
| `0015_schedule_sweep` | Installs pg_cron and schedules `vybe-sweep` hourly |

**The history table had to be repaired before any of this worked.** 0001–0013
were applied by hand through the SQL editor, so
`supabase_migrations.schema_migrations` was empty and `supabase db push` would
have tried to replay `0001` against tables that already existed. The fix was
`supabase migration repair --status applied 0001 … 0013` first. Worth
remembering: **apply through the CLI from now on**, or the same divergence comes
back.

Two things the previous handoff got wrong, corrected by querying the database
rather than trusting the doc:

- 0011 and 0012 were listed outstanding. Both were already applied.
- `messages.expires_at` looked missing and was read as "0012 did not run". 0012
  never creates that column — it deletes on `created_at`. The probe was wrong,
  not the schema.

### Rebuild natively

`app.json` gained Android permissions and the notifications plugin, and the auth
session now depends on `expo-secure-store` at launch. None of that reaches a JS
reload.

```bash
npx expo prebuild --clean && npx expo run:ios
```

---

## 2. Then, to make notifications actually work

Push is built end to end but not deployed. Without this, no notification ever
reaches another person's phone.

```bash
eas init
```
```bash
supabase functions deploy push-notify --no-verify-jwt
```
```bash
supabase secrets set PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Then Dashboard → Database → Webhooks → new webhook on `public.notifications`,
event **Insert**, pointing at the function URL, with header
`x-webhook-secret: <that value>`.

`--no-verify-jwt` is required because a database webhook is not a signed-in
user. **The shared secret is what replaces that check** — without it the
endpoint is an open relay that will push arbitrary text to any account's
devices.

The sweeper is **done** — `0015` installed pg_cron and scheduled `vybe-sweep`
hourly at `:17`, active and confirmed in `cron.job`. It had never run: pg_cron
was not installed on the project at all, so `cron.job` did not exist and 0012's
functions had been sitting there since they were written, deleting nothing —
while the chat screen told people their messages were gone after seven days.
Nothing was lost when it was switched on (2 messages total, both recent), but
that gap had been open since 0012 was authored.

---

## 3. Known open items

Ordered by how much they matter.

- **Ranking runs client-side over a downloaded window.** That is the PRD's
  stated design. Pagination made the window movable rather than final; it did
  not make the ranking scalable. At real scale this wants a server-side
  candidate service — an architecture decision, not a fix.
- **`fetchMyReactions` loads every like, save and boost the account has ever
  made.** Fine now, wrong at a hundred thousand. Wants to become a per-post
  lookup against the loaded window.
- **Story viewer reported as blank for one user.** Could not reproduce — the
  viewer opens and records views correctly in testing. Unverified rather than
  fixed. Now that 0010 is applied the eye/views control should be live; note it
  only renders on *your own* story.
- **iOS bundle id is `com.vybeee.app`, Android package is `com.vybe.app`.** Not
  a bug, but they should match before either store listing exists, and it cannot
  be changed afterwards.

---

## 4. Environment gotchas that have already cost time

- **`npm install` must use `--legacy-peer-deps`.** A pre-existing react/react-dom
  peer conflict; a plain install silently prunes `babel-preset-expo` and
  `react-native-worklets`.
- **Never import `@react-navigation/*` directly.** SDK 56 hard-errors at bundle
  time. Expo Router vendors its own copy — `useIsFocused`, `useFocusEffect` etc.
  all come from `expo-router`.
- **`react-native-worklets` must stay on 0.10.x.** Reanimated 4.5.1 rejects
  0.11+ at podspec validation.
- **CocoaPods on Ruby 4.x** needs `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- **The simulator build goes stale silently.** After any dependency change,
  rebuild natively rather than relaunching the installed binary.

---

## 5. Three rules this pass earned the hard way

All three were learned by breaking the running app, and all three are worth
keeping.

### A client release must survive its migrations not having run

There is always a window where a new binary talks to an old schema. Naming
`age_range` in the shared `PROFILE_COLS` took the **whole app** down — that list
feeds the feed query, the replies query and every author lookup, so one unknown
column made PostgREST reject all of them at once.

Every schema-dependent read and write now degrades: `42703`/`PGRST204` on a
column, `PGRST205` on a table, `PGRST202` on a function all fall back to the
behaviour without the feature.

### If a native module is not needed to draw the first screen, import it where it is used

A top-level import of a native module that is absent from the binary throws at
module-evaluation time, which takes the app down at launch rather than degrading
one feature. `expo-device` did this; it was removed entirely rather than
imported lazily, because it existed to supply one boolean that a `try/catch`
already provides.

### A store selector must never build its value

`useSyncExternalStore` compares snapshots with `Object.is`, so a selector that
constructs anything has changed on every read — which is an infinite render
loop, not a slow one. It surfaces as *"Maximum update depth exceeded"* with
`forceStoreRerender` in the stack.

`useVybe((s) => s.messages[id] ?? [])` was the live instance: a fresh `[]` every
time the key was absent, and removing messages from the persisted slice made
absent the normal case. The fallback is now a module-level constant.

Safe: `.find()`, `.length`, a plain field. Unsafe: `?? []`, `?? {}`, `.map`,
`.filter`, `.slice`, `new Set`, object literals. If a derived collection is
genuinely needed, select the raw fields and combine them in a `useMemo` — that
is what `useMutualIds()` does.

Related: **require cycles are not noise.** "Can result in uninitialized values"
is exactly the launch-time failure above, arriving through a different door.
The count is currently **zero** — keep it there. Stores must not import
`@/components/ui`; shared leaf utilities live in `src/lib/`.

---

## 6. What changed this session, in one paragraph each

**Security.** Any signed-in account could read anyone's direct messages —
`0006`'s participant policy was `with check (auth.uid() is not null)`, so
inserting one row into `conversation_participants` bought the whole thread.
Notification inserts were similarly unconstrained by a tautology. The account
password was written to AsyncStorage in clear text; Face ID now keeps a Supabase
refresh token in the Keychain instead and the legacy plaintext is purged on
every launch. The auth session itself moved from AsyncStorage to a chunked
SecureStore adapter.

**Honesty.** The notifications screen *fabricated* likes, boosts and replies from
whoever happened to be in the authors map, falling back to other people's posts
when you had none — which is why a reply notification could point at a post you
did not write. Deleted. The "someone posted" banner was a local notification the
client fired at itself during `sync()`, which is why it repeated every launch
and never reached anyone else.

**Scale.** Realtime was quadratic: every client subscribed to every post insert
globally and refetched 200 posts on each. The open chat screen polled every three
seconds *on top of* realtime, and its merge deleted messages you had just sent.
`fetchRemoteConversations` embedded every message in every thread to render one
preview line. The feed had no second page. All fixed; the feed now pages on a
keyset cursor.

**Design.** The post-setup screen was a fake progress bar over a radar pulse —
rebuilt as a receipt showing the topics you actually chose. The empty feed was a
paragraph in the void — rebuilt as a first-run card with three real actions.
Topic pickers use real photography. Added: an animated wordmark splash, an age
screen, story views, and TikTok-style messaging (mutuals in the inbox, everyone
else in Requests).

---

## 7. Verified on device

iPhone 17 Pro simulator, iOS 26.5, against the live project: cold launch, feed
with real posts, likes, stories tray, Discover photo tiles, mutuals-only chat
picker, opening a DM, sending a message, the retention notice, zero require
cycles, no console errors.

Typecheck is clean for the app (`npx tsc --noEmit`). The five errors it reports
are all in `supabase/functions/push-notify` — `Deno` and an `esm.sh` import,
neither of which the React Native tsconfig knows about. That code never enters
the bundle; it runs on Deno Deploy.

---

## 8. Polls, built end to end

Picked up from open item one. The tables and RLS had existed since `0006` and
nothing read or wrote them.

**The tally cannot be computed on the client, and that is the whole design.**
`poll_votes_policy` is `using (user_id = auth.uid())`, so a voter can see
exactly one row per poll: their own. Counting in JS therefore yields 1 for the
option you picked and 0 for the rest — a poll that reports every answer as
having one vote. The policy is right, so the count moved to the server.
`0013_poll_results.sql` adds a `security definer` function that takes the post
ids the client already holds and returns per-option counts, the total, and the
caller's own `option_id` — numbers out, never rows, so no vote is ever
attributable to a person.

It tallies; it does not discover. The post ids come from a feed query that RLS
has already filtered, and the function deliberately does not re-implement the
Boundary — a second copy of an audience rule is a second chance to get it wrong.

**Client.** `db.attachPolls` fills in `poll` on every path that produces posts
(`fetchFeed`, `fetchPostsByIds`, `fetchPostsByAuthor`), so a poll renders
wherever its post does, at one extra round trip per page. `castPollVote` upserts
on `(poll_id, user_id)` — that key, not the disabled button, is what makes "one
vote each" true across devices. `votePoll` is optimistic and rolls the whole
poll object back if the write is refused, so a poll never sits closed against a
vote that was never recorded. `addPost` writes the poll *after* the post, and a
failed poll insert leaves the post standing — same rule as the media insert.

**Composer.** `app/compose.tsx` gained a collapsed "Add a poll" section: one
question, two to four answers. A half-written poll blocks Next with the reason
stated, rather than being silently dropped from the post.

**Drafts carry polls** (`0014`). The composer saves on close, and that path used
to keep the text, photos, topics and audience and drop the question — the user
found out by reopening their own draft. `drafts.poll` is one nullable jsonb
column holding the same shape `polls.options` does, so promoting a draft to a
post is a copy. A draft can now be nothing but a poll, so the drafts list reads
the question rather than captioning it "photos only, no words yet".

Everything degrades on the code that means "the migration has not run":
`PGRST202` for a missing function, `PGRST205` for a missing table, and
`42703`/`PGRST204` for `drafts.poll` — the last one retried without the column,
so a pre-`0014` project saves a draft that loses its poll rather than failing to
save at all. None of them touch `lastError`, so a missing migration is a feature
absent, not "Could not reach the server" over a feed that loaded fine.

**Deployed, not yet exercised.** `0013` and `0014` are both live and
`drafts.poll` is confirmed present, so the server half is real. The client half
is typecheck-clean but has not been run on a device — nobody has composed a
poll, voted in one, or reopened a draft that holds one. That is the next thing
to do after the native rebuild.
