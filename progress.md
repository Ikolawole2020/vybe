# Vybe — Progress

> **Starting a new session? Read [HANDOFF.md](HANDOFF.md) first.** It is the
> current state of play in five minutes: what to run, what is outstanding, and
> the two rules this pass earned the hard way. This file is the long-form log —
> the reasoning behind each decision, newest first.

## Hardening pass — 17 Aug 2026 (in progress)

Brief, in the owner's words: *"fix this app, let it work well for both android
and iOS. implement nice security. this app, we wanna scale so make it seem like
1 million people are gonna use it today… go through the codebase and find
anything that needs fixing."*

Read end to end. What follows is what was actually wrong, worst first.

### 1. Anyone could read anyone's direct messages

`0006`'s participant policy was `with check (auth.uid() is not null)`. Any
signed-in account could insert `(someone_elses_conversation_id, my_own_id)` into
`conversation_participants`, and every other policy in the messaging schema
grants on "is a participant" — so that one row bought the entire thread. No
exploit was needed beyond the anon key that ships in the bundle and a free
account.

`0008_security_hardening.sql` adds `conversations.created_by` and rewrites the
policy: a participant may be added by the conversation's creator, or by someone
already in it. Nobody else. The creator column is pinned by a trigger rather
than a `with check` clause, because a policy cannot see the old row and
expressing "this did not change" there means a correlated subquery back into the
table the policy guards.

**This migration has to be applied before the fix is real.** Until it runs, the
hole is open on the live project.

### 2. Notification inserts were unconstrained

`with check (actor_id = auth.uid() or user_id is not null)`. `user_id` is
`not null`, so the second arm is a tautology and the policy permitted every
insert — a forged notification from any account to any account. Now
`actor_id = auth.uid() and user_id <> actor_id`. The 0005 triggers are
`security definer` and are unaffected.

### 3. The account password was stored in clear text

`services/biometrics.ts` wrote the password to SecureStore **and** to
AsyncStorage, which is an unencrypted file in the app sandbox and is included in
device backups. The encrypted copy bought nothing while the plaintext copy sat
beside it, and because people reuse passwords the exposure was not limited to
this app.

Nothing stores a password now. Face ID keeps the Supabase **refresh token** in
the Keychain / Android Keystore, marked `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so it
is not carried into iCloud or a backup, and signing in exchanges it via
`refreshSession`. The token is read *inside* the unlock call and only returned
on success, so there is no path where it is in memory without the user having
proved who they are. Supabase rotates it on every use, so `onAuthStateChange`
re-saves on `TOKEN_REFRESHED` — without that the button worked exactly once.

`purgeLegacyCredentials()` runs unconditionally on every launch. Shipping the
fix does nothing for the handsets that already have the file; deleting it is the
only thing that does.

Sign-out is now `scope: 'local'`, so it ends this device's session without
revoking the remembered token or killing the user's other handsets. A new
`forgetDevice()` is the global revoke, for Settings.

### 4. The session itself was in plaintext too

`supabase.ts` used `AsyncStorage` for the auth session — an unencrypted bearer
token and the refresh token that mints more of them. It now uses
`lib/secureStorage.ts`, a chunked SecureStore adapter. The chunking is not
decoration: SecureStore's Android backend warns above 2048 bytes and can refuse,
and a Supabase session routinely exceeds that, so the naive adapter works on iOS
and then silently stops persisting sessions on Android. It migrates the old
AsyncStorage value on first read, so nobody is signed out by the upgrade.

### 5. Stories and polls were readable signed-out

Both read policies were open to the `anon` role, whose key ships in every copy
of the app — so any caller could enumerate every story in the product. Narrowed
to `authenticated`. Poll votes gained a read policy, because with "your own vote
only" a result bar could never be anything but invented.

### 6. Nothing bounded anything

No length limit on any user-supplied text, and both storage buckets were created
with no `file_size_limit` and no `allowed_mime_types` — a single account could
upload a multi-gigabyte file of any type and have it served publicly. 0008 adds
length checks (validated separately from the `not valid` add, so the scan does
not block writes), 8 MB / 25 MB bucket ceilings with MIME allow-lists, a 60
messages-per-minute ceiling enforced in the database, a unique index that caps
profile-view notifications at one per viewer, and a `sweep_expired()` for the
story and notification rows that currently accumulate forever.

### Second pass — 17 Aug 2026, on device

Everything above was written blind. The app has now been built and driven on the
iPhone 17 Pro simulator against the live project, which found things a typecheck
cannot.

**Two regressions I introduced, both caught on device:**

- **`useIsFocused` from `@react-navigation/native` would not bundle.** SDK 56
  hard-errors if anything imports react-navigation directly — Expo Router
  vendors its own copy and two navigation trees do not compose. It comes from
  `expo-router` instead, and the unused `@react-navigation/bottom-tabs`
  dependency (flagged as a removal candidate in an earlier pass) is gone, since
  its presence is what let the import resolve at all.
- **Adding `age_range` to the shared `PROFILE_COLS` took the whole app down.**
  That list feeds the feed query, the replies query and every author lookup, so
  naming a column the live database did not have yet — `0009` had not been
  applied — made PostgREST reject all of them at once. The feed went blank
  behind "Could not reach the server". The rule that follows is in the code as a
  comment: **a client release must survive its migrations not having run.** The
  age band is read only where it is used, and falls back on `42703`. The same
  tolerance now covers `updateMyProfile` and `story_views`.

**The notifications screen was fabricating notifications.** Reported as *"i'm
seeing someone replied to my post, but it isn't actually my post"*. After
reading the real rows it walked the loaded posts and authors and synthesised a
like, a boost and a reply for each — actor picked by rotating an index through
the authors map, with a hardcoded sentence as the reply body — and fell back to
`posts.slice(0, 5)`, *other people's* posts, when the viewer had none. None of
those events had happened. The counts were real, which made the invention
plausible enough to survive the pass that deleted the rest of the seed data.
Deleted; the `notifications` table is the only source now.

**The "someone posted" banner on every launch.** Reported. It was a *local*
notification scheduled inside `sync()` — so it fired while the user was already
looking at the app, and announced the same post every launch, because "newest
post by someone I follow" does not change just because you have seen it. More
fundamentally it could never reach anyone else's phone: a local notification is
scheduled by the device it appears on. See "Notifications, for real" below.

**Face ID told people to do what they had just done.** Reported. A failed or
cancelled scan and a missing stored credential were the same `null`, so the only
message was "sign in with your password once" — advice that could not help,
because the credential was fine. `unlockRememberedRefreshToken` now returns a
discriminated result and each outcome gets the message that matches it. It also
checks for the credential *before* prompting, rather than asking for a face and
only then admitting there was nothing to unlock.

**Modals could not be dismissed by tapping outside.** Reported for the follow
list; the new-chat sheet and the story privacy sheet had it too. All three take
a backdrop press now, with an inner `Pressable` swallowing touches on the sheet,
and the follow list gained a grab handle so it looks dismissible.

### The post-setup screen was fake, and is now a receipt — 17 Aug 2026

Direction: *"that setting up your account, optimizing experience blah blah blah
screen is horrible… looks so AI, especially with that sonar kind of animation."*

Correct on both counts. It was a pulsing radar dot over five checklist rows that
ticked themselves off on 620ms timers, behind a progress bar filling at a rate
no work was being done at — `applySetup` writes local state and queues a
debounced save, so it completes in under a millisecond. Three seconds of theatre
asserting effort that had not happened. Every generated onboarding flow reaches
for exactly that shape, which is why it read as machine-made.

Rebuilt around what the product actually argues: your algorithm is yours and you
can read it. So the moment after setup is not a machine saying it is thinking —
it is the app repeating your decision back to you. The topics you picked, shown
as **the photographs you picked them from**, so the choice is the thing you see
rather than a summary of it. One plain line naming the temperament. Then a
button.

**The button is the part that matters.** An auto-advancing timer makes this
something done *to* you, and its length is a guess about your reading speed.
Tapping to continue makes it a moment you close yourself — and it is the same
gesture that commits the setup.

### The empty feed was a dead end — 17 Aug 2026

*"the home screen as a new user, the design is ass."* It was a grey heading and
a paragraph centred in the void. Two problems: it reads as a failure when
nothing has failed, and it offers a new account a sentence to read at the exact
moment it most needs somewhere to go.

Now a first-run card with the three things there are to do, ordered by what
fills a feed fastest rather than by what was easiest to build — following people
is the only one that populates *For You*, so it leads and carries the volt.
Circles and Following keep their own copy, because "no Circles yet" and "nobody
you follow has posted" are different problems and only one is fixed by
following someone.

### Three bugs on the post screen — 17 Aug 2026

All reported, and two shared a cause: the post screen renders the same
`PostCard` the feed does, with no way to say *this is the detail view*.

- **Captions were clipped on the post's own screen.** Two lines is right in a
  feed, where the card is a summary and the tap is the invitation to read the
  rest. On the screen you tapped *into*, it meant the full text existed nowhere
  in the product.
- **Tapping a post opened the same post again.** Every "open this post" target
  stayed live on the post's own screen, so tapping the body pushed
  `/post/<same id>` — the identical screen, as many times as you tapped, each
  needing its own back press to escape.
- **`GO_BACK was not handled by any navigator`.** `router.back()` on the first
  screen of a stack logs that in development and silently does nothing in
  production, which is worse: a close button that cannot be pressed. It happens
  more than the stack diagram suggests — a notification deep-links into
  `/post/<id>`, a full-screen modal outlives the screen behind it, a fast
  refresh remounts with one entry. `lib/goBack.ts` checks `canGoBack()` and
  falls back to the feed; all 26 call sites in the signed-in stack go through
  it. The auth screens already guarded themselves.

### Require cycles — 17 Aug 2026

Metro was warning about six. One edge caused nearly all of them: `useAuth`
imported `haptic` from `@/components/ui` — a *store* reaching into the UI
barrel, which pulls `ThemeProvider` into every chain. `haptic` moved to
`lib/haptics.ts`, a leaf with no imports of its own.

The rest were the barrel importing itself: `ui/index` re-exported
`FollowListModal`, `TypingIndicator`, `VoiceRecorder` and `VoiceNotePlayer`, and
each of those imports `Icon`/`Touchable`/`VText` back from `ui/index`. Those
four re-exports are gone; screens import them from their own paths.

Worth doing rather than filing as noise. "Can result in uninitialized values" is
precisely the failure that took the app down twice in this pass — in a cycle,
whichever module Metro evaluates first sees the others as `undefined`, and the
order is decided by whatever imported what first, so it changes when an
unrelated screen adds an import. Now zero.

### Messaging follows the TikTok rule now — 17 Aug 2026

Direction from the owner: *"only show users to start conversations with if
you're follow each other… we can still chat with a random person but not in the
conversations list, you get me? just like tiktok?"*

- **The New Message picker is mutuals only.** A one-way follow is not a
  relationship — anyone can follow anyone, so a picker that offers strangers
  hands control of somebody's inbox to whoever wants it.
- **A non-mutual can still reach you**, from your profile or by replying to a
  story. That thread lands in **Requests**, a second tab beside Chats, and never
  mixes into the list you check daily. Nothing is dropped; a stranger can reach
  you without being able to interrupt you.
- The tab strip only appears once a request exists. An empty second tab is a
  promise of content that is not there.
- Circle groups are always Chats — a room you were deliberately put in, where
  mutual-following is not the right question.

This needed a fact the app did not have. It knew who *you* follow and had no way
to ask who follows **you**, so nothing could tell a two-way connection from a
one-way one. `fetchMyFollowerIds` and a `followers` array fill that in, and
`useMutualIds()` is the intersection.

### Opening a DM was broken, and the fix is an RPC — 17 Aug 2026

Reported as *"could not open the chat, check internet connection"* — a message
about the network for a problem that had nothing to do with it. The device log
gave the real answer: `new row violates row-level security policy for table
"conversations"`.

The cause is a genuine circularity rather than a typo. PostgREST appends
`RETURNING id` to an insert, so the new row must satisfy the **select** policy
as well as the insert one — and `conversations_select_policy` grants on being a
participant. At that instant no participant rows exist, because they are the
*next* statement. The row is invisible to its own creator.

`0011_create_conversation_rpc.sql` makes the whole thing one `security definer`
function: find an existing one-to-one thread, or create the conversation and
both participant rows in a single transaction. It reads `auth.uid()` itself
rather than taking it as an argument, so it can only ever act as the caller, and
it validates the target exists so it cannot be used to probe which uuids do. The
client falls back to the old path on `PGRST202`, so it works before the
migration lands too — four round trips become one after it.

### Messages expire after seven days — 17 Aug 2026

Direction: *"i also dont want local messages, i want it to be kept for up to 1
week before deletion, and the users should be notified."*

Nothing is on the device — `conversations` and `messages` left the persisted
slice earlier in this pass — so with `0012_message_retention.sql` seven days is
genuinely how long a message exists anywhere. Enforced by the sweeper, not by a
client-side filter: hiding old messages while the rows sit there is the opposite
of the promise being made. The delete is batched at ten thousand rows a pass,
because the first run against an accumulated table would otherwise take a long
lock and block every send in the product while it ran. Empty conversations are
swept too, so an aged-out thread does not sit in the inbox as a blank row.

**And it is said out loud**, in the conversation rather than in a settings page:
a quiet line under the header reading *Messages disappear after 7 days*. A
retention policy nobody is told about is indistinguishable from data loss the
first time someone scrolls up and finds a gap.

### Built this pass — 17 Aug 2026

**Animated splash (`src/components/SplashGate.tsx`).** The GOAT reference, with
Vybe's own wordmark. A native splash is a static image and cannot animate, so
this is a handoff: the native splash and this component's first frame share the
same ground (`#08080C`) and lockup position, the native one is dismissed as soon
as *fonts* are ready rather than when the app is, and the animation runs over the
mounted navigator. Letters rise and fade in 55ms apart, the tracking contracts
from 18 to 2 — a wordmark resolving into itself, which is the move that carries
it — then a volt underscore sweeps out and the lockup drifts up and away.
Letter-spacing is animated as per-glyph margin because React Native cannot
tween `letterSpacing` on a Text node. Two gates, not one: whichever of "data
ready" and "animation finished" takes longer wins, so every launch has the same
shape instead of the opening length tracking connection speed.

**Age, on its own screen (`app/age.tsx`).** A band, never a birth date — the
product only needs to know roughly who this is, and a date of birth is a
stronger identifier than anything else the app holds, so collecting it and
bucketing client-side would mean storing something we do not need and cannot
un-store after a breach. Skippable, because a required age wall on the second
screen of a product nobody has decided to use yet is a wall, and the honest
value for "declined" is null. `ageAskedFor` is keyed to the account rather than
the device, for the same reason `onboardedFor` is, and it is separate from the
stored band — gating on the band alone would re-ask everyone who skipped, on
every launch, forever.

**Real photography on the topic pickers.** Setup was twenty-two identical grey
pills with a wire icon on each, which is a form rather than a choice: nothing
distinguishes one option from the next until you read it, so picking six meant
reading twenty-two labels. Both setup and Discover are photo tiles now. Three
decisions worth keeping: the photo stays visible when selected (a grid of solid
volt squares is unreadable, and selection reads as the image getting *brighter*,
which is the right direction for "more of this"); the reject step dims instead
and marks with ember, so the accent is not taught two opposite meanings; and the
scrim is a gradient, because a flat overlay over a photograph of unknown
brightness either loses the picture or loses the label. `topic.image` is
optional and every consumer falls back to `hue` + `glyph`, so a missing or
slow image degrades to the old pill rather than to a hole.

**Story views (`0010_story_views.sql`).** An eye and a count on your own story,
bottom-left where the status quo has trained everyone to look, and tapping it
lists who watched. The asymmetry is the design: the **author** sees exactly who
watched, a **viewer** sees only their own row. Watching someone's story
therefore does not disclose to you who else did — get that backwards and the
feature quietly publishes a social graph. Enforced by policy, not by the client
hiding a list it has already downloaded. The count is per *item*, not per story,
because a story with three frames has three different audiences. One row per
person per item, so re-watching does not make you two viewers.

**Notifications, for real.** Push did not exist. What existed was a local
notification the client scheduled at itself, which is why the same banner fired
on every launch and why nothing any user did could ever reach another person's
phone. Now: `device_tokens` (0009) holds a push token per device, RLS-scoped to
its owner; `services/push.ts` registers on sign-in and prunes on sign-out;
`supabase/functions/push-notify` turns a `notifications` row into an Expo push,
composes the sentence from a `notification_delivery` view so the sender is not
doing joins per row, and deletes tokens Expo reports as `DeviceNotRegistered` —
a token nobody prunes keeps "succeeding" forever while nothing arrives, which is
the failure that looks like "push is broken" and cannot be diagnosed from the
client. A trigger fans a new **public** post out to the author's followers;
private posts deliberately do not fan out, since pushing a Circle post to every
follower routes straight around the Boundary. `profile_view` is recorded but
never pushed: a phone buzzing because somebody looked at your page is the
engagement bait this product exists to argue against.

There is deliberately **no `expo-device`** check for "is this a simulator" — it
is the obvious way to write that guard and it costs a native module for one
boolean, and a native module that is imported but absent from the binary throws
at module-evaluation time. It took the whole app down at launch on the first try.
`getExpoPushTokenAsync` already rejects on a simulator; catching that is the
same guard with nothing to install.

**Emoji reactions were clipped.** Reported. `VText` applies `fontFamily: Outfit`,
Outfit has no emoji glyphs, so the platform substitutes the system emoji font for
the *character* while still building the line box from Outfit's ascent and
descent — which are tighter than an emoji's, so the glyph is drawn taller than
the line it is given and gets cut off. Fixed by rendering emoji through React
Native's own `Text` (no inherited family, so the metrics match the glyph actually
drawn) plus an explicit `lineHeight` at 1.35x and `includeFontPadding: false` for
Android. Nulling `fontFamily` back out through a style override was the first
attempt and is not safe — it depends on `StyleSheet.create` preserving an
`undefined` value.

### 7. Sign-out left the previous account's DMs on the phone

`clearAccountState` cleared posts, circles, saves and the profile — and did not
clear `conversations`, `messages`, `stories`, `seenStoryItemIds` or the
notification badge. All of those were *also* in the persisted slice, so the
previous account's private messages stayed on screen for whoever signed in next
and survived a reboot in an unencrypted file. They are cleared on sign-out and
are no longer written to disk at all; the server has them.

---

## Crashes and correctness

### A hook below an early return — a real crash, not a lint note

`app/post/[id].tsx` called `useVybe((s) => s.removePost)` *after*
`if (!post) return <PostNotFound/>`. Opening any post outside the loaded feed
window — anything from a link, or an older item in Liked or Saved — renders once
with no post and once with one, so React sees eleven hooks then twelve and
throws "Rendered more hooks than during the previous render". White screen. The
subscription moved above every return. A scan of the other twenty screens found
no second instance.

### Every message you sent appeared twice

The client minted `msg_<timestamp>_<counter>` while the server assigned a uuid.
The realtime handler dedupes by id, so your own message came back over the
socket, failed to match, and was appended again. The client now mints the uuid
and the insert carries it, so they are the same row.

The retry made it worse rather than better: a send that timed out *after* the
row committed reported failure, and the retry inserted a second copy — so the
worst connections produced the most duplicates. The write is an upsert on that
id now, which makes a retry a no-op. It also retries four times over ten seconds
instead of eight times over two minutes, and marks the bubble **Not delivered**
when it gives up. Previously a message that never arrived was indistinguishable
from one that did, forever.

### Deleting a story you had just posted deleted nothing

Same root cause, different table. `addStory` invented `st_item_<counter>` and
threw it away; the row got a uuid. `deleteRemoteStoryItem` was then handed an id
the database had never seen — which is not an error, deleting zero rows never
is — so it reported success and the item returned on the next sync.

**"Hide this story from…" never reached the server at all.** It wrote local
state only. The UI confirmed the person could no longer see the story and they
could. It writes `hidden_user_ids` now, which the read policy enforces.

### The realtime notification badge could never fire

The filter was `target_user_id=eq.…` and the column is `user_id`. Realtime does
not report an unknown column in a filter as an error — it just never matches,
which is why this looked like it worked.

### Other correctness

- **`db.lastError` was write-only.** One transient failure latched it forever,
  and `sync()` copies it into `loadError` — so a single dropped like made the
  feed say "Could not reach the server" on every subsequent load. Cleared by the
  next success.
- **The permission cache reported denials as grants.** `requestNotificationPermissions`
  cached *that it had asked* and then `return true`, so once the prompt had been
  shown everything downstream believed notifications were on. It caches the
  answer now, and creates the Android channel *before* the grant check —
  creating it afterwards meant the first Android notification had no channel and
  was dropped by the system.
- **Voice notes were sent with no audio.** `audioRecorder.stop()` returns a
  promise and was not awaited; the file is only finalised when it resolves, so
  `.uri` was read mid-close. A 200 ms sleep stood in for awaiting it, which is
  why this failed on slow devices and not on fast ones. On failure the old code
  sent `voice_memo_<timestamp>.m4a` — a filename, not a path — producing a
  bubble with a play button that could never play. Now awaited, capped at five
  minutes, released on unmount (a recording left running held the microphone
  against the whole phone), and an honest error when it fails.
- **The microphone was requested on mount**, so opening a chat threw the
  permission dialog at people who had shown no interest in recording. Requested
  on first tap instead, where the reason is on screen.
- **The fresh-install notification badge read `3`** — three things that had never
  happened, on an account that did not exist yet.
- **Undoing "reset the algorithm" restored half of it.** The inverse patch
  carried topic weights and dials and omitted author weights and temporary
  modes, so the undo silently kept the reset's other two effects.
- **The inbox could loop forever.** The effect wrote to `authors` and depended on
  `authors`; when a lookup came back empty — a deleted account, or one the
  viewer cannot see — the id stayed missing and it refetched on every render for
  as long as the screen was open.
- **The "new message" list only offered people already on screen.** It was
  `Object.values(authors)`, which on a fresh account is nobody. It is a
  debounced server search now.
- **Navigating to a chat opened the wrong id.** `startConversation` returned a
  locally invented id and swapped in the server's later, so opening a thread
  with someone you had already messaged landed on an id that stopped existing a
  moment afterwards and sat there empty. It is `async` and resolves to the real
  id; three call sites updated.
- **The unread badge never cleared.** `last_read_at` has existed on
  `conversation_participants` since 0006 and nothing ever wrote to it. Opening a
  conversation stamps it, and the inbox computes unread from it.
- **Multi-photo posts published with one photo.** Upload paths were
  `<uid>/<Date.now()>.<ext>` with `upsert: false`, and picking several photos
  uploads them in the same millisecond, so the second and third were rejected. A
  random suffix fixes it.
- **`%` in a people search** searched for everything and made the database scan
  the whole `profiles` table; `,`, `(` and `)` are PostgREST's own `or()` syntax.
  All escaped now.

---

## Scale

The brief was "make it seem like 1 million people are gonna use it today", so
these are ordered by what breaks first.

### Realtime was a self-inflicted denial of service

Every client subscribed to **every INSERT on `posts`, globally**, and each event
triggered a full `fetchFeed()`. One person posting caused every client in the
product to pull two hundred posts. That is quadratic in the user count. The same
shape applied to `story_items`, which refetched the entire stories table on any
change anywhere.

Feed and story fan-out are gone. New posts arrive on pull-to-refresh, which is
also what the frozen-ranking work wanted — a feed reordering itself under the
reader's finger is the bug that was fixed in the last pass, and this
subscription was quietly reintroducing it. Stories are coalesced to at most once
every thirty seconds. Messages are the only per-event path left, and it is
reconciliation rather than a refetch.

The socket also follows the app lifecycle now. It was held open in the
background, keeping the radio awake and reconnecting into a token that had
expired while the phone slept.

### The open chat screen polled every three seconds

Twenty full re-reads of the conversation per minute, per open chat, on top of
the realtime subscription already delivering the same rows. It was also losing
messages: the merge was `if (remote.length >= local.length) replace`, so a
message you had just sent was wiped whenever the counts tied and reappeared
three seconds later. One read on open, one on return to foreground, and the
merge keeps anything still in flight.

### Queries that downloaded the world

- **`fetchRemoteStories`** was `select('*')` over the whole `story_items` table
  — every story from every account, on every sync and every realtime event. It
  now takes the viewer plus everyone they follow or have in a Circle, filters
  expired items, and is bounded.
- **`fetchRemoteConversations`** embedded `messages(*)` — every message in every
  thread the viewer belongs to — so that one of them could be read for the
  preview line. A thread with ten thousand messages was ten thousand rows to
  render forty characters of grey text. One bounded query reduced client-side.
- **`fetchRemoteMessages`** was unbounded *and* ascending, so a long thread cost
  everything and opened on the wrong end of itself.

### The feed had no second page

`fetchFeed` was a flat `limit(200)`: scroll past two hundred posts and the
product ended. It pages on a **keyset cursor** — `created_at < last` rather than
`offset`, because offset makes Postgres count and discard every row it skips, so
page fifty costs fifty times page one, and a post published mid-read shifts
every window and shows the same card twice. The page size came down from 200 to
40; two hundred rows with their media and three embedded aggregates each is
hundreds of kilobytes on a cold start for a screen showing four cards.

### Lists and timers

- Every `FlatList` gained `windowSize`, `maxToRenderPerBatch`,
  `initialNumToRender` and `removeClippedSubviews`. Unbounded, every post card
  the reader scrolls past stays mounted, and a long session ends in a
  low-memory kill on mid-range Android.
- **The attention budget ticked in the user's pocket.** The timer ran from mount
  to unmount and the feed tab never unmounts, so the budget accrued while they
  were on their profile and while the app was suspended. Someone who opened Vybe
  once and backgrounded it came back to "that is your 30 minutes". Gated on
  `useIsFocused` and `AppState`.
- **The story viewer auto-advanced while backgrounded**, marking each frame seen
  on the way past — data loss dressed as a feature.
- **`seenIds` and the notification `Set`s grew forever.** `seenIds` is scanned
  with `includes()` on every card and was append-only; both are capped now.
- **The typing broadcast sent a packet per keystroke.** Throttled to 1.5s.

### The feed re-sorted under the reader's finger, again

`rankFeed`'s dependency list included `authors`, which is replaced by identity
on every sync and every one-off profile fetch. This is the self-scrolling feed
bug from the last pass arriving through a different door: `seenIds` was
unsubscribed and `authors` was left behind. Read through a ref now.

---

## Android and iOS parity

- **`POST_NOTIFICATIONS` was not declared**, so on Android 13+ the permission
  could never be granted and notifications silently did nothing. Added, along
  with `VIBRATE`, `USE_BIOMETRIC`, and the `expo-notifications` plugin with the
  volt accent colour and a default channel.
- **The Android notification channel was created after the permission check**,
  so the first notification arrived with no channel and the system dropped it.
- **Nested `Touchable`s in the stories tray.** The `+` badge was inside the
  bubble's own pressable, and Android does not reliably pick a winner between
  overlapping nested pressables — tapping `+` frequently fired both, opening the
  "Add to Story / View Story" dialog on top of the creator it had just pushed.
  They are siblings now.
- SecureStore chunking (above) is specifically an Android fix: the iOS Keychain
  takes a whole session, the Android backend warns above 2048 bytes and can
  refuse.
- Chat list gained `keyboardShouldPersistTaps` and `keyboardDismissMode`.

---

## Applied vs. written

**Written and typechecking; none of it has been run on a device or against the
live project in this pass.** `npx tsc --noEmit` is clean after every step, which
catches signature drift across the twenty-odd call sites that moved and catches
nothing else.

Two things need doing before any of it is real:

1. **Apply the migrations, in order: `0008`, `0009`, `0010`.** Until `0008`
   runs, the DM hole and the notification-forgery hole are open on the live
   project. All three are written to be re-runnable, and the client tolerates
   each of them not having run — the age band, the device tokens and the story
   views all degrade to "feature absent" rather than to a broken screen.
2. **Rebuild natively.** `expo-secure-store` was already a dependency but the
   auth session now depends on it at launch, and `app.json` gained Android
   permissions and the notifications plugin — none of which reaches a JS reload.
3. **Deploy the push function and wire its webhook**, or notifications stay
   in-app only:

   ```bash
   supabase functions deploy push-notify --no-verify-jwt
   ```
   ```bash
   supabase secrets set PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"
   ```

   Then Dashboard → Database → Webhooks → new webhook on `public.notifications`,
   **Insert**, pointing at the function URL, with header
   `x-webhook-secret: <that value>`. `--no-verify-jwt` is required because a
   database webhook is not a signed-in user; the shared secret is what replaces
   that check, and without it the endpoint is an open relay that will push
   arbitrary text to any account's devices.
4. **Set an EAS project id.** `getExpoPushTokenAsync` needs one to route a
   token. Push registration now returns early and silently when it is absent —
   it was warning once per launch about a build-time configuration gap, which
   only trains people to ignore the log — so this is no longer visible, and
   still needs doing before any notification is delivered:

   ```bash
   eas init
   ```

Migrations to apply, in order: **0008, 0009, 0010, 0011, 0012** — 0008, 0009 and
0010 were applied on 17 Aug; **0011 and 0012 are outstanding.** Each is
re-runnable, and the client degrades rather than breaking when one has not run:
a missing age column, story-views table, conversation RPC or retention sweep all
resolve to "feature absent".

Then schedule the sweep, which is the one piece of 0008 that does not
self-start:

```sql
select cron.schedule('vybe-sweep', '17 * * * *', 'select public.sweep_expired()');
```

### Found and deliberately not fixed

- **Polls are not wired to the server.** `votePoll` mutates local state only,
  `toPost` does not read a poll, and nothing writes `polls` or `poll_votes` — so
  a poll cannot render from the database at all and a vote does not survive a
  refresh. The tables and the RLS exist. This is an unbuilt feature rather than
  a bug, and building it is a larger piece of work than a fix pass should
  quietly absorb. 0008 does add the `poll_votes` read policy it will need, since
  without it a result bar could only ever be invented.
- **Ranking still runs client-side over a downloaded window**, which is the PRD's
  stated design. Pagination makes the window movable rather than final; it does
  not make the ranking scalable. At a million users this wants a server-side
  candidate service, and that is an architecture decision rather than a fix.
- **`fetchMyReactions` loads every like, save and boost the account has ever
  made.** Fine at today's volumes, wrong at a hundred thousand per user. It
  needs to become a per-post lookup against the loaded window.
- The iOS bundle id is `com.vybeee.app` and the Android package is
  `com.vybe.app`. Not a bug, but they should probably match before either store
  listing exists, and changing them afterwards is not possible.

## Realtime Infrastructure, Live Typing, Voice Note Overhaul & Setup Fixes — 16 Aug 2026

- **App-Wide Realtime Subscriptions (`src/services/realtime.ts`)**:
  - Implemented `initAppRealtime(userId)` with Supabase channels across all devices.
  - Live Direct Messages (`public:messages`): Incoming messages append instantly with 0ms delay, bump `lastMessage`, and update unread indicators in real time.
  - Live Stories (`public:story_items`): Remote uploads and deletions sync automatically to the story tray across devices.
  - Live Posts & Notifications (`public:posts`, `public:notifications`): Real-time updates to feed and badge counters.
- **Live Typing Indicator (`src/components/ui/TypingIndicator.tsx`)**:
  - Real-time broadcast channel (`subscribeToChatTyping`) syncing typing state across conversation participants.
  - Three bouncing animated dots with physics-based staggered timing and author identity label.
- **Voice Note Recorder Redesign (`src/components/ui/VoiceRecorder.tsx`)**:
  - Replaced cramped PanResponder layout with a full-width overlay recording bar.
  - Live animated waveform visualizer, pulsing red recording indicator, live timer, prominent Trash/Cancel button, and high-contrast Volt Send button.
  - Fixed locking/stuck issues so canceling, stopping, and sending work reliably on single taps.
- **Direct Messaging UUID & RLS Fixes**:
  - Replaced ad-hoc string IDs with RFC 4122 v4 UUIDs in [useVybe.ts](file:///Users/tomisin/Documents/GitHub/vybe/src/store/useVybe.ts).
  - Fixed RLS policies in [0006_stories_messages_polls.sql](file:///Users/tomisin/Documents/GitHub/vybe/supabase/migrations/0006_stories_messages_polls.sql) so conversations, participants, and messages insert cleanly without permissions errors.
  - Added "New Message" button & interactive New Chat Sheet in [messages/index.tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/messages/index.tsx).
- **Android Setup Screen Fix (`app/setup.tsx`)**:
  - Fixed Next button being disabled with 0 selections by allowing neutral defaults.
  - Added `flex: 1` and `keyboardShouldPersistTaps="handled"` to `ScrollView` for smooth touch handling on Android.
  - Guarded `haptic()` calls against unhandled exceptions on unsupported Android hardware.

---

## Major Update: High-Retention Social Features & UX Polish — 16 Aug 2026

The app has been upgraded with 4 flagship social engagement features to drive daily active retention while preserving Vybe's transparent algorithmic ethos:

### 1. ⚡ "Vybes" / 24h Ephemeral Stories (Top of Feed)
- **Component**: `src/components/feed/StoriesTray.tsx`
  - Horizontal story tray at the top of the feed with active avatar rings (volt glowing borders for unseen stories).
  - First bubble is "Your story" with a `+` badge allowing instant photo publishing from camera roll or presets.
- **Screen**: `app/story/[id].tsx`
  - Immersive full-screen viewer with segmented top progress bars (5s auto-progression per item).
  - Tap right/left to navigate, hold down to pause.
  - Floating emoji burst reaction bar (`🔥`, `❤️`, `⚡️`, `👏`, `😂`) with spring physics that automatically sends a DM to the author.
  - Quick-reply composer for direct responses.
- **Screen**: `app/story/create.tsx`
  - Photo picker and preset selector with caption support to add to your story.

### 2. 💬 Direct Messaging & Circle DMs
- **Masthead Entry**: Added `message-circle` icon in `src/components/feed/FeedHeader.tsx` with live unread indicator badge.
- **Inbox Screen**: `app/messages/index.tsx`
  - Conversation list with search filter, circle membership badges, unread badges, and time stamps.
  - Supports deep-linked post sharing (`/messages?sharePostId=...`).
- **Chat Screen**: `app/messages/[id].tsx`
  - 1-on-1 and circle messaging with custom volt (outgoing) and dark glass (incoming) bubbles.
  - Interactive Voice Note audio playback directly inside chat bubbles.
  - Rich interactive shared post cards.
  - Composer with voice recording and send haptics.
- **Post Sharing**: Added "Share via DM" action to feed cards in `src/components/feed/PostCard.tsx`.

### 3. 📊 Interactive In-Post Polls & Predictions
- **Component**: `src/components/feed/PollCard.tsx`
  - Embedded inside post cards in `PostCard.tsx`.
  - Supports 2 to 4 choices with real-time voting.
  - Animated percentage progress fill bars with `withTiming` transitions.
  - Selection checkmark, vote counts, and instant haptic feedback.
- **Store**: `votePoll(postId, optionId)` in `src/store/useVybe.ts`.

### 4. 🎙️ Voice Notes & Audio Comments
- **Component**: `src/components/ui/VoiceNotePlayer.tsx`
  - Audio waveform visualizer with animated play/pause states, time progression (`0:18 / 0:30`), and scrubbing.
- **Comments Thread Integration**: `app/post/[id].tsx`
  - Voice note button on the reply composer to attach 15s audio memos.
  - Renders inline audio players inside comment rows.

- **Android Release APK Built**:
  - Successfully compiled `./gradlew assembleRelease` using OpenJDK 17 and hermes bytecode.
  - Generated standalone release binary at [vybe.apk](file:///Users/tomisin/Documents/GitHub/vybe/vybe.apk) (117 MB).
- **Status/Story Upload Fix & Cloud Storage Bridge**:
  - Fixed `addStory` in [useVybe.ts](file:///Users/tomisin/Documents/GitHub/vybe/src/store/useVybe.ts) to resolve user id consistently, append items to active story sequences, upload local media files to Supabase Storage (`post-media` bucket), and persist to PostgreSQL `story_items`.
  - Added explicit camera & photo library permission requests with alerts in [create.tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/create.tsx).
  - Enlarged the **`+` Volt badge** on the "Your story" avatar to a crisp, high-visibility 24x24 touch target with a distinct plus icon and drop shadow in [StoriesTray.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/feed/StoriesTray.tsx).
  - Tapping "Your story" when an active story exists presents an instant choice dialog (`Add to Story` or `View Story`), while tapping the `+` badge directly launches the Story Creator.
  - Added a persistent **`[ + Add to Story ]`** pill button at the bottom and top bar of the Story Viewer in [story/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/[id].tsx) when viewing your own story.
- **Fixed Story Green Marker (Unseen Ring) Bug**:
  - Added `seenStoryItemIds` persistent tracking in [useVybe.ts](file:///Users/tomisin/Documents/GitHub/vybe/src/store/useVybe.ts) across app closures and Supabase re-syncs.
  - Eliminated duplicate self-story bubbles from the network tray in [StoriesTray.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/feed/StoriesTray.tsx), ensuring viewed stories cleanly show the standard neutral border and never reappear with an erroneous green ring.
- **Enhanced Voice Note Recording & Playback**:
  - Fixed gesture capturing in [VoiceRecorder.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/ui/VoiceRecorder.tsx) with immediate `onPressIn` sensitivity, smooth slide-up locking, slide-left canceling, and instant hands-free recording mode.
  - Improved [VoiceNotePlayer.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/ui/VoiceNotePlayer.tsx) timing and completion state resets.
- **Post Card Action Bar Alignment**: Redesigned the action bar in [PostCard.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/feed/PostCard.tsx) into a unified, balanced full-width pill container with `justifyContent: 'space-between'` so Like, Comment, Boost/Repost, Share via DM, and Save align symmetrically across any device screen width with zero awkward wrapping.
- **Delete Own Posts**: Added a post deletion option in both [PostCard.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/feed/PostCard.tsx) (in the action bar and header) and [post/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/post/[id].tsx) (in the top navigation bar) with confirmation alerts, strictly restricted to the post's author (`isOwnPost`).
- **Profile View Notification Target Fix**: Removed the local phone self-push notification in [profile-view/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/profile-view/[id].tsx). Visiting another user's profile records the view in Supabase for the target author without buzzing the viewer's own phone.
- **Full Supabase Cloud Database Integration for Stories & Chats**:
  - Implemented remote database methods in [db.ts](file:///Users/tomisin/Documents/GitHub/vybe/src/services/db.ts): `fetchRemoteStories()`, `createRemoteStoryItem()`, `deleteRemoteStoryItem()`, `fetchRemoteConversations()`, `fetchRemoteMessages()`, `sendRemoteMessage()`, and `createRemoteConversation()`.
  - Connected `useVybe.ts` actions to persist newly sent direct messages, newly posted stories, and deleted stories directly to PostgreSQL on Supabase in the background while updating the local UI optimistically with 0ms lag.
  - App boot and `sync()` now fetches remote conversations, unexpired stories, and message threads directly from Supabase, synchronizing them across devices.
- **Local Persistence & Offline Fallback**: In addition to Supabase synchronization, `AsyncStorage` acts as an offline fast-cache so conversations and unexpired stories render instantly on cold launch.
- **Delete Story / Status Update**: Added `deleteStoryItem()` in [useVybe.ts](file:///Users/tomisin/Documents/GitHub/vybe/src/store/useVybe.ts) with confirmation dialogs and instant removal from the active story stream in [story/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/[id].tsx).
- **Hide Story from Specific Users**: Added privacy controls (`hiddenUserIds`) in [story/create.tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/create.tsx) and [story/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/[id].tsx) with an interactive modal sheet to toggle users who cannot view your stories, automatically filtered in [StoriesTray.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/feed/StoriesTray.tsx).
- **Hold-to-Record & Slide-to-Lock Voice Notes**: Created [VoiceRecorder.tsx](file:///Users/tomisin/Documents/GitHub/vybe/src/components/ui/VoiceRecorder.tsx) supporting hold-to-record, drag-up-to-lock recording mode with hands-free timer, trash cancel, and dedicated send action, integrated in DMs ([messages/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/messages/[id].tsx)) and Post replies ([post/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/post/[id].tsx)).
- **Immersive Hold-to-View Mode**: Holding down on a story now smoothly fades out **all UI overlays, headers, progress bars, dark gradients, captions, and reply bars** so you see 100% pure, uninterrupted photo/video. Releasing your finger restores the controls.
- **Clean Own Story Presentation**: Removed the bottom status bar completely when viewing your own story, keeping the photo completely unobscured while preserving top header privacy and delete actions.
- **Rock-Solid Keyboard Avoidance (`KeyboardStickyView`)**: Upgraded bottom composers in [story/create.tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/create.tsx), [story/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/[id].tsx), [messages/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/messages/[id].tsx), and [post/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/post/[id].tsx) to hardware-accelerated `KeyboardStickyView` so inputs and upload buttons stick directly on top of the keyboard with 0 clipping or obscuring.
- **Complete Supabase SQL Migrations**: Provided [0005_notifications.sql](file:///Users/tomisin/Documents/GitHub/vybe/supabase/migrations/0005_notifications.sql) and [0006_stories_messages_polls.sql](file:///Users/tomisin/Documents/GitHub/vybe/supabase/migrations/0006_stories_messages_polls.sql) for database-backed persistence, triggers, performance indexes, and RLS security.
- **Hold-to-Pause Gesture Fix**: Separated tap from long-press in [story/[id].tsx](file:///Users/tomisin/Documents/GitHub/vybe/app/story/[id].tsx) using press duration tracking; releasing after holding now resumes playback smoothly without accidentally skipping or closing.
- **Story UI Clearance & Frosted Emojis**: Raised the reply bar and story upload buttons well above the iOS home indicator bar and styled the quick reaction emojis with high-contrast frosted glass discs (`rgba(0,0,0,0.65)`).

---

The app was launched against the live project and these came out of it. Posting
end to end is **confirmed working**: a post with a photo reached `posts`,
`post_media`, and the `post-media` bucket, and the public URL serves the image.

- **The feed crashed with "Maximum update depth exceeded".** A selector,
  `useVybe((s) => s.circles.map((c) => c.id))`, built a new array on every read.
  `useSyncExternalStore` compares snapshots by identity, so every render looked
  like a change and re-rendered forever. It was also unused. Every other
  selector in the app was audited; this was the only one.
- **`sync()` raced itself.** Tab layouts mount more than once, so several syncs
  ran in the same tick and `ensureMyProfile` competed with itself — the account
  ended up with `@tomisinadeyinka3` when the unsuffixed handle was free. Callers
  now share one in-flight run. **The handle is cosmetic and editable** in
  Settings → You → Edit profile.
- **Accounts made before the schema existed have no profile row.** The
  `on_auth_user_created` trigger only fires for sign-ups after it was created,
  and the sign-up flow worked for months with no tables at all — Supabase owns
  `auth.users`. Such an account has a blank name and cannot post, because
  `posts.author_id` references a profile that is not there. `ensureMyProfile`
  now creates it on first sync, mirroring the trigger's handle logic.
- **The daily attention budget was never daily.** `spentSeconds` persisted and
  nothing ever cleared it, so the second day of use opened on "that is your 30
  minutes" before a single post had been read. It now carries the day it belongs
  to and rolls over.
- **Liking a post added two.** `PostCard` rendered `post.likes + (liked ? 1 : 0)`
  — correct when the count was a fixed seed number that could never contain you,
  a double-count the moment the number became real and the store started
  applying your tap optimistically. Same fix for boosts.
- **The view count was invented.** `likes + comments * 7`, presented behind an
  eye icon as if it were a measurement. Nothing measures views. Removed.
- **There was no sign-out button anywhere.** `useAuth.signOut()` existed and
  nothing called it. It is now the last row in Settings.

### Still open from that run

- **Photos upload as full-size HEIC** — the one test post put 2.8 MB up. HEIC is
  an Apple container that Android and most browsers will not render, so those
  images are effectively broken off-iOS, and nothing resizes. Wants a
  convert-and-downscale step before upload.
- **A warning toast fires repeatedly in dev** ("Open debugger to view
  warnings") and covers the tab bar. Not diagnosed — the device log did not
  carry it. Worth opening the debugger once to read it.

## Native modules are imported lazily now — 15 Aug 2026

`expo-image-manipulator` was imported at the top of `src/services/db.ts`, and a
top-level import of a native module throws at module-evaluation time on any
binary that does not contain it. That file is reached from the store, which is
reached from the theme provider, which every screen sits inside — so a device
whose build predated the dependency did not lose photo conversion, it failed to
launch at all. The import moved to the point of use, where the existing
try/catch already degrades to uploading the original.

Worth applying to any native module added from here: if it is not needed to draw
the first screen, import it where it is used.

## Simplification and keyboard pass — 15 Aug 2026

Four things from the owner, in their words:

- *"in the discover page, when i click on a person, i should be able to view
  their profile"* — Discover's person rows were the only directory rows without
  tap-through. The name and face now open the profile; the circle chips stay
  their own targets, so filing someone does not navigate away from the list you
  are working through.
- *"i dont need to see this how much of them do you want with this slider, i can
  just see a single button... this is making the application too complex"* — the
  bipolar author-weight slider and the raw `+0.00` weighting figure are gone
  from another person's profile. One button, **Show me more of them**, which
  disappears the moment it is tapped: a button that stays behind to report its
  own success is one more thing to read and decide about.
- *"there should be a way in settings to be able to remove them again"* — and
  there was not, anywhere. Every "more of them" and every "less from them" on a
  receipt wrote a weight that applied to that person's posts forever, and
  nothing listed them. Settings now has **People you have adjusted**, each row
  tapping back to neutral. Profiles for people you turned *down* are fetched on
  demand, since they are exactly the ones no longer in your feed.
- *"the keyboard covers the input and i cant see what im typing"* — see below.

### The keyboard

`react-native-keyboard-controller` (documented for SDK 57) replaces the stock
`KeyboardAvoidingView` + `ScrollView` pairing. The distinction that matters:
the stock pair lifts the *container* but never scrolls the *focused field* into
view, so an input low in a form sat under the keyboard while you typed into it
blind. `KeyboardAwareScrollView` scrolls to whatever has focus.

- Forms — `edit-profile`, `sign-in`, `sign-up`, `verify` — use
  `KeyboardAwareScrollView`, and their old wrappers were removed rather than
  nested, since two of them fight over the same inset.
- Pinned composers — the post reply box and `compose` — keep a
  `KeyboardAvoidingView`, but the library's, which behaves the same on Android.
  The stock one takes `undefined` behaviour there and leaves a pinned composer
  under the keyboard.
- `KeyboardProvider` wraps the app in `app/_layout.tsx`.

**This adds a native module, so the app must be rebuilt natively.** A JS reload
gives `The package 'react-native-keyboard-controller' doesn't seem to be
linked`, which is what it looks like when Metro has the JS and the binary does
not.

### Android build — not completed

`edgeToEdgeEnabled` was removed from `app.json` (Android 16 makes edge-to-edge
mandatory and prebuild now rejects the flag) and `expo-system-ui` was installed
so `userInterfaceStyle` works. `npx expo prebuild --platform android` succeeds.

The build itself did not run: **the only JDK on this machine is Java 26**, and
Gradle for RN 0.86 does not support it. Android Studio ships a JDK at
`/Applications/Android Studio.app/Contents/jbr` which is usually the right
version — point `JAVA_HOME` at it, or `brew install openjdk@17`. Then:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=~/Library/Android/sdk
cd android && ./gradlew assembleRelease
```

EAS avoids the toolchain question entirely: `eas build -p android --profile preview`.

## The algorithm moved to the server — 15 Aug 2026

Prompted by the owner asking the obvious question: *"does what i use to build my
feed get stored on the database?"* It did not. The six dials, every topic weight,
the timed boosts and the whole ledger lived in AsyncStorage on one handset, which
made the product's central claim — your algorithm is yours, legible and
reversible — true only on the phone you happened to tune it on.

`supabase/migrations/0004_algo_state.sql` adds two tables:

- **`algo_state`**, one row per person, weights and dials as `jsonb`. They are
  read and written as a unit and never queried field-by-field, and a column per
  topic would mean a migration every time a subject is added.
- **`algo_ledger`**, one row per change, with the inverse patch that undoes it.
  The client generates the id so an entry can be written optimistically and
  updated later without a round trip in between.

Both are owner-only, **including for select**. How a feed is tuned is not a fact
about a person anyone else is entitled to.

### How it stays in step

- **Writes are a store subscription, not a call in each action.** Nine actions
  can change `algo` and more will follow; making each remember to save is a rule
  that gets forgotten exactly once and then goes quietly wrong. Stated once, it
  cannot be skipped.
- **Debounced at 1.2s.** A dial is a slider — dragging it produces a change per
  frame and the server only needs where it came to rest.
- **The ledger sends only what changed.** A whole-list write on every undo would
  resend sixty rows to flip one boolean.
- **Conflicts are last-write-wins per device**, using `algoSyncedAt` against the
  server's `updated_at`. Enough for one person on two phones, which is the case
  that exists; genuinely concurrent editing would need per-field timestamps.
- **`applyingRemote` guards the load**, or adopting the server's copy would
  count as a change and immediately re-upload what had just been downloaded. It
  is released in a `finally` — left stuck on, every later change would silently
  stop saving.

### Sign-out now drops the algorithm, and that is the point

It used to be kept, on the grounds that it was the device's tuning with no table
behind it. With a table, keeping it is actively wrong: the leftover
`algoSyncedAt` would make the next account's sync believe this device held the
newer copy, and it would upload the previous person's dials into their account.
Dropped on sign-out; the server hands it back on the next sign-in.

## Bug sweep — 15 Aug 2026

Asked for after the migration settled: *"fix all other bugs"*. Static audit plus
two reports from the owner. Everything below is fixed; typecheck clean.

- **New accounts skipped setup and the personalizing screen.** Reported. The
  `onboarded` flag is persisted on the *device*, and setup is a fact about an
  *account* — so the second account to sign in on the same phone inherited the
  first one's "already set up" and walked straight into the feed, with the first
  account's topic answers already applied. There is now an `onboardedFor` id
  alongside it, and the gate checks that it matches whoever is signed in.
- **`@someone` on your own replies.** Reported. Your profile lives in
  `profile`, not in the `authors` map — the map holds other people, filled from
  whatever the feed and thread queries returned. A reply you had just posted
  looked up its author, found nothing, and printed the fallback. `useAuthor`
  now resolves the viewer from `profile`, and replies were extracted into a
  `ReplyRow` component so they go through that lookup at all (hooks cannot run
  inside a `.map()`, which is why they were reading the raw map).
- **"Followers" on your own profile was the literal constant `0`**, and "Posts"
  counted only the ones still inside the loaded feed window. Both are queries
  now.
- **A post outside the feed window could not be opened.** The window is the
  recent slice the feed ranks; anything liked or saved a while ago, or reached
  from a link, resolved to "Post not found". The post screen and the full-screen
  photo viewer both fall back to fetching by id.
- **Drafts stored `file://` paths in a server row.** A draft is a row on the
  server now, and a local path means nothing to another device — or to this one
  once iOS clears the cache, at which point the draft reopens with its pictures
  gone. Photos are uploaded in the background after the draft saves, so closing
  never waits on the network and a failed upload leaves the local path in place.
- **Discover claimed "N posts today"** while counting everything loaded. It says
  "N in your feed", which is what it counts.
- **The sync guard was not keyed to an account.** Sign out and back in as
  someone else while a sync was in flight, and the new account was handed the
  previous one's load and sat there empty.
- Orphaned imports and one duplicated comment block left by the migration.

### Known and not fixed

- ~~Photos upload full-size as HEIC.~~ — **fixed 15 Aug 2026.** Every image is
  re-encoded as JPEG and capped on its long edge (1600px for post media, 800px
  for avatars) before it leaves the device. The conversion lives in
  `uploadImage`, the single door out, so an upload path added later cannot
  forget it. A conversion failure falls back to the original rather than losing
  the upload, and logs. **The one already-uploaded HEIC is still HEIC** — the
  fix is not retroactive; delete that post and repost it if you want it to
  render on Android.
- **No pagination.** `fetchFeed` takes the 200 most recent visible posts.
- A repeating dev-only warning toast covers the tab bar; not diagnosed.

## Next, in order

0. **All four migrations are applied** (verified 15 Aug 2026 against the live
   project: `replies`, `algo_state` and `algo_ledger` all answer, both algo
   tables correctly return nothing to an anonymous caller, and the feed, thread
   and algo-state queries the app actually runs all return 200). What remains is
   driving it. Every screen below was rewritten to fetch instead of import, and
   most of it has not been on the simulator. Sign in, and expect the first
   pass to find bugs a typecheck cannot: a query that returns a shape the
   mapper does not expect, a screen that renders before its fetch lands, an RLS
   policy that says no. The queries themselves are verified — every select,
   embed and foreign-key hint in `src/services/db.ts` was run against the live
   project and parses (a wrong column or FK name returns an error, not an empty
   array, which is how that check is worth something).

1. ~~**Discover: surface "Add people" in search.**~~ — **done 15 Aug 2026.**
   Discover's People heading now carries an action: **Add people** while
   browsing, **See all** while searching, both landing on `app/people.tsx`, and
   the search words are handed over as a `q` param so the box is not typed into
   twice. With a query, People is the first section on the page; browsing, the
   page keeps its editorial order and People closes it, capped at three with the
   heading link doing the "see all" job. Typecheck clean, **not run on device**
   — Discover is behind the account and setup gates.
2. **Verify on device**: `edit-profile`, `people`, `room/[id]`, `personalizing`,
   pull-to-refresh, avatar upload. All are written and typecheck; none has been
   driven on the simulator. Reaching them needs a signed-in account, so either
   sign in or temporarily flip the guards in `app/_layout.tsx`.
3. ~~Apply the schema~~ — **done, you ran it.** All twelve tables answer.
4. ~~Wire the app off seed data~~ — **done.** See below.

## Where things live now

| Want to… | Screen |
|---|---|
| Change name, @nickname, bio, picture | `app/edit-profile.tsx` — Settings → You, or tap your name on Profile |
| Add people by name or nickname | `app/people.tsx` — Settings → You → Add people |
| See the ranking internals | `app/algo-advanced.tsx` — Your Algo → Advanced |
| Everything Profile used to hold | `app/settings.tsx` — gear on Profile |
| A room | `app/room/[id].tsx` — tap a room card in Discover |
| A photo full screen | `app/photo/[id].tsx` — tap any post media |

Running log of what is built, what is not, and what needs picking up.

---

## Current work — UI simplification pass (15 Aug 2026)

Direction from the owner, in their words: *"the app is too complex, make the ui
very user friendly, then in the backend thats where the real work goes, how do
you expect me to understand this your algo?"*

**This reverses the screen's founding assumption and is worth stating plainly.**
The PRD sells radical legibility — six named dials, receipts showing the actual
arithmetic. That thesis assumed the person reading it wants the arithmetic. The
owner, reading it cold, did not. The machinery is not being deleted; it is moving
behind an Advanced entry so the default surface speaks plain language and the
transparency is still there for anyone who goes looking.

Rule for this pass: **no jargon and no raw numbers on any primary surface.**
`topicPull`, `serendipity`, `variety`, `+0.42`, "genome" and "constellation" are
all advanced-only vocabulary now.

| # | Work | State |
|---|---|---|
| 1 | Your Algo → plain language, advanced behind a door | **done** |
| 2 | Compose: attach photos | **done** |
| 3 | Compose: replace the radial "solar system" audience dial | **done** |
| 4 | Profile → Liked / Saved / Drafts tabs, settings behind a gear | **done** |
| 5 | Discover: rebuild Rooms and Subjects | **done** |
| 6 | Post-setup "building your feed" animated screen | **done**, unverified |
| 7 | Feed scroll bug — self-reordering list | **done** |
| 8 | Light-mode wash-out; boundary tags; REEL badge | **done** |
| 9 | Tap media → full-screen viewer | **done** |
| 10 | Room detail screen, pull-to-refresh, avatar upload, early-adopter badge | **done**, unverified |
| 11 | Edit nickname / add people screens | **done**, unverified |
| 12 | Tab pill lost its volt colour | **done** |
| 13 | Post tags trimmed — circle name out, topics capped at two | **done** |
| 14 | Supabase schema + RLS written | **done**, applied |
| 15 | Wire the app off seed data | **done**, unverified |

### Android release

`eas.json` now exists with an APK profile. The Android folder is generated
(`/android` is gitignored), so a local release build starts with a prebuild:

```bash
npx expo prebuild --platform android --clean
```
```bash
cd android && ./gradlew assembleRelease
```

APK lands at `android/app/build/outputs/apk/release/app-release.apk`. Note that a
locally built release is signed with the **debug** keystore unless signing is
configured — installable, not shippable to Play. Because prebuild regenerates the
folder, keystore config added by hand there gets wiped; EAS is the durable route:

```bash
eas build --platform android --profile preview
```

`preview` produces an APK, `production` an AAB for Play. `*.keystore` is now
gitignored — a committed signing key cannot be un-leaked.

### The colour-draining bug, twice

The attention budget was quietly desaturating the UI in two places, and both read
as "the design is broken" rather than as a nudge, because nothing on screen
connected the greying to the limit:

- `PostCard` faded the whole card up to 30% → on a light ground that is a white
  film over photos and text.
- The tab bar pill interpolated volt → grey → the marker stopped being lemon.

Both now hold their colour. The budget still says its piece, in words, in the
feed footer where it can be understood.

Done so far in this pass: `Draft` type + `drafts` store slice (persisted),
`expo-image-picker` installed and permission string added to `app.json`.

### Your Algo, rebuilt

`app/(tabs)/algo.tsx` now asks three things a person can answer about themselves
— show me more of what, less of what, and how adventurous — using setup's own
calm / balanced / open vocabulary, which is the one wording the user has already
met. No dial names, no weights, no constellation. `applyPreset` and `matchPreset`
in the store back the three-way choice; `matchPreset` returns `null` when the
dials have been hand-edited, so the screen says "none of these" instead of
highlighting the nearest and lying.

Everything removed moved to `app/algo-advanced.tsx` — six dials, every topic as a
slider, the constellation, timed boosts, daily limit, ledger and Time Machine.
Nothing was deleted.

### The feed scrolled by itself — fixed

Reported as *"when i scroll, it just keeps like going down or refreshing"*. It was
a genuine feedback loop, not a rendering glitch:

scroll → `onViewableItemsChanged` marks posts seen → `seenIds` changes → the
`ranked` memo depends on it → `rankFeed` demotes seen posts → **the list reorders
under the reader's finger** → different posts become visible → marked seen →
reorder again.

The feed order is now frozen while you read it. `seenIds` is read once per
rebuild via `useVybe.getState()` and is no longer subscribed to, so `markSeen`
does not re-render the list at all. Seen state still demotes posts — on the next
rebuild, which is what **pull-to-refresh** now triggers. That gives the gesture a
real job: it folds in everything you scrolled past and lifts what you have not
seen.

### Light-mode wash-out — fixed

`PostCard` faded the whole card by up to 30% as the attention budget was spent.
In dark mode that reads as dimming; on a near-white ground it reads as a white
film over the photos and the text, which is what was reported. The card no longer
fades — the footer already says the limit is reached, in words, which does the
same job without costing legibility.

Also removed from posts: the Close friends / Work boundary tag, and the REEL
badge. The view count stays.

### Still fake, and worth knowing

- **Video does not play.** `expo-video` is installed and the tap target is wired,
  but the seed has zero video files — the one `kind: 'video'` post points at a
  still image. Tapping it opens the photo viewer. Real playback needs real
  assets, which is part of the Supabase migration.
- **Followers reads 0** on your own profile. `ME.followers` was a seeded number
  and quoting it back at a real account would be a lie.
- **Rooms are joinable in local state only** — the button is honest about
  nothing else, but there is no membership table behind it yet.
- **The early-adopter badge** is keyed off `profile.joinedAt` on this device.
  Once accounts are real it should key off `auth.users.created_at` instead, or
  reinstalling the app grants a fresh badge. The cutoff is `EARLY_ADOPTER_UNTIL`
  in `useVybe.ts` — 1 Oct 2026.

~~**Found while testing, not yet fixed.** The seeded `initialTopicWeights`…~~ —
**fixed 15 Aug 2026** by the honest route: the defaults are now empty, so a new
account has no opinions until setup gives it some.

**One environment note already earned:** `npx expo install` re-resolved
dependencies and broke the typecheck — `@react-navigation/bottom-tabs` is a
direct dependency, but Expo Router 57 bundles its own React Navigation, so the
two copies no longer match structurally. `LiquidTabBar` now declares the two
fields it actually reads instead of importing `BottomTabBarProps`. The standalone
package is unused by our code and is a candidate for removal.

## Wired off seed data — 15 Aug 2026

Direction from the owner: *"dont add anything in the database, let me start
afresh, remove every single dummy data"*. So `src/data/seed.ts` was deleted
outright — 8 invented people, `ME`, 4 starter circles with invented members,
5 rooms and ~20 posts — and every screen that imported from it now reads the
database instead. **No rows were inserted anywhere.** The account starts empty
because it genuinely is empty.

**Topics survived, and are not content.** The 22 subjects moved to
`src/data/topics.ts`. Their ids are what `posts.topics` stores and what every
topic weight is keyed by, so they are schema, not seed — but treat the ids as
permanent, because changing one orphans every row that used it.

### What is where now

| Layer | File | What it does |
|---|---|---|
| Queries | `src/services/db.ts` | Every `supabase.from()` in the app. Screens never call it directly except to fetch one thing they own. |
| State | `src/store/useVybe.ts` | `sync()` loads everything in one parallel pass; writes apply locally and reconcile behind the tap. |
| Ranking | `src/algo/engine.ts` | No longer imports anything. Authors and circles are passed in. |

Decisions worth knowing:

- **The persisted slice shrank to what the device owns**: theme, the two
  onboarding flags, the algorithm, the ledger, the budget. Posts, profile,
  circles, drafts, likes, saves, boosts and follows are all fetched on launch.
  Persisting them would mean a cold start shows yesterday's world and then
  replaces it — and would leave a readable cache of a feed on a signed-out
  device.
- **Reactions are optimistic, and roll back.** A like that waits for a round
  trip before the heart fills reads as a broken button. A failed write puts the
  local state back.
- **Circles are not optimistic.** They are rows owned by you, and an optimistic
  circle would carry a fake id that the next membership write would fail
  against. The server answers first.
- **Sign-out wipes account state.** Otherwise the next person to sign in on the
  phone sees the last one's feed, saves and name until the fetch lands.
- **`initialTopicWeights` is now empty.** It used to arrive with a dozen
  opinions pre-loaded, which made every fresh install look like it already knew
  the person. This also fixes the thirteen-chip wall noted in the last pass.
- **The early-adopter badge keys off `profiles.created_at`**, so reinstalling no
  longer grants a fresh one. That was an open item; it is closed.

### Things that were fake and are now simply absent

- **The verified tick.** Nothing in the database confers one. A badge that is
  always false is worse than no badge, so the field is gone from `Author`. The
  volt disc on your own profile stays — it is the early-adopter mark, and now
  says so.
- **Member faces on room cards.** Rooms have a member count and no member list;
  the faces were drawn from the seeded author list. The count stays, the faces
  went.
- **`viralityRatio`.** Reach is not measured anywhere, so it is 0 and the crowd
  receipt reports the two counts that are real instead.
- **The comment thread on a post.** Two seeded replies and a working composer
  that appended to local state. Replies now say plainly that they are not built,
  and the composer still drives `@my_algo`, which is the part that was ever real.
- **Rooms while `spaces` is empty** — the section hides itself rather than
  showing an empty shelf, per your call. It reappears the day a room exists.
- Three inert rows in Settings (export, fediverse, ranking source) now say
  "Not built yet" rather than implying a button that does nothing.

### Two gaps in the schema this exposed

1. ~~There is no replies table.~~ — **fixed by `0002_replies.sql`**, see below.
2. **`posts` has no `space_id`.** A post cannot belong to a room, so a room
   screen can only show posts that happen to match its topics. That is what
   `app/room/[id].tsx` does today, and it is a guess rather than a membership.

### You were listed in your own directory — fixed 15 Aug 2026

Discover and Add-people both listed the signed-in user among the people to add.
A directory is a list of people you might put in a circle, and you are not one of
them; listed, you appear beside yourself under whatever nickname the list was
fetched with, which reads as a duplicate account. `searchProfiles` now takes the
viewer's id and excludes it in the query.

### The third user was an abandoned sign-up — fixed by `0003`

Reported as *"i created an account, edited the nickname, and now there are three
users"*. Reading `auth.users` settled it: three accounts, three distinct emails,
and **the middle one was never confirmed**.

| created | email | confirmed |
|---|---|---|
| 07:45 | `…352@gmail.com` | yes — the original account |
| 14:59 | `…+1@gmail.com` | **no** — abandoned at the code screen |
| 15:00 | `…352+!@gmail.com` | yes — signed up again 50s later |

Editing the nickname did not create anything. But the ghost row is a real
defect, and 0001 caused it: provisioning hung on `after insert on auth.users`,
which fires at sign-up, *before* the emailed code is typed. 0001's own comment
called an abandoned sign-up holding its handle "the cheaper failure" — that was
wrong. It makes somebody who never proved they own an address into a permanent
listing in the people directory, beside real accounts. It took less than a day
of testing to produce one.

`0003_profile_on_confirm.sql` moves provisioning to confirmation: one trigger on
insert for accounts that arrive already confirmed (OAuth, or confirmation
switched off), one on `email_confirmed_at` going from null to set. The function
is now idempotent — `ensureMyProfile` may have created the row from the client
first, and a duplicate-key error raised inside a trigger on `auth.users` would
abort the confirmation itself, locking the user out of the account they had just
proved they owned.

**The existing ghost row is not removed by the migration** — deleting accounts is
the owner's call. `delete from auth.users where email = '…'` cascades the profile
away.

## Replies — 15 Aug 2026

Direction from the owner: *"i should be able to comment on my post, other people
in the app as well, im seeing only @my_algo can send replies, nahhhh, everyone
should send replies and who tf is my_algo?"*

`supabase/migrations/0002_replies.sql` adds the missing table. **It must be run
before the app works at all** — `fetchFeed` now asks for `replies(count)`, and
PostgREST refuses the whole query if the relationship is absent, so the feed
comes back empty until it is applied.

- **Permission is not reinvented.** The insert policy calls `can_reply_to_post`,
  the same function the likes and boosts policies use, so a reply obeys exactly
  the rule the composer's audience step already sets. That function returns true
  for the post's own author, so you can always answer your own post whatever you
  set the policy to — the screen now mirrors that, having previously locked the
  author out of their own thread.
- **Deleting** is allowed for the reply's author *and* the author of the post it
  sits under — the smallest moderation tool that makes a thread survivable.
- **`Post.comments` is a real count now**, from `replies(count)`.

### @my_algo is no longer in anyone's way

It was the PRD's signature move: type `@my_algo show me less like this` as a
reply and it retunes your feed. Read cold by someone who had not met the idea, it
looked like the only thing the reply box could do and like a stranger in the
thread. The box is now a plain reply box — placeholder "Write a reply…", no
suggestion chips, no accent-swapping, no cpu icon.

**The behaviour survives, quietly.** A reply is posted as an ordinary reply
first; if the text happens to parse as an algorithm command it also applies the
tuning, and the toast says what it changed. That is closer to the PRD's original
intent than the old version, which applied the tuning *instead of* posting
anything.

### Still missing, now that it is visible

- **Nothing calls `fetchMySpaceIds` into a joined-rooms view** beyond the join
  button state — fine, but worth knowing the data is loaded.
- **No pagination anywhere.** `fetchFeed` takes the most recent 200 posts the
  viewer may see and the engine ranks that window. That is correct for now and
  will not be at any real scale.
- **A follow button now exists** (on someone else's profile) — before this pass
  there was none anywhere, which meant the Following feed mode could never have
  had content.

## Backend — schema applied 15 Aug 2026

`supabase/migrations/0001_init.sql` is the full schema with row-level security,
and it has been run against the live project. All twelve tables answer.

**The point of the file is that the Boundary is enforced in the database.** Open
item 2 has been "required before any beta" since the start: `canView()` in the
engine is a rendering convenience, and a post restricted to a Circle must never
be *serialised* to someone outside it. `can_view_post()` is a `security definer`
function inlined into the `posts` select policy and reused by `post_media`, so a
private post is not filtered out of a result set — it is never in one. A client
bug cannot route around it.

Decisions worth knowing before this is applied:

- **The Boundary is two columns, not one array.** `is_public` + `visible_circle_ids`,
  and a separate `reply_policy` enum. The client's `visibleTo: ['public']` used a
  sentinel string inside an id array; splitting it matches the rebuilt audience
  picker exactly and indexes properly.
- **Circle membership is one-directional.** Members are never told which of your
  circles they are in — there is no select policy that would let them look.
- **Saves are private both ways.** Not even the author of a post can see who
  saved it. Likes and boosts are visible to anyone who can see the post.
- **Acting requires reply permission.** `likes`/`boosts` insert checks
  `can_reply_to_post`, so a read-only audience cannot like into a conversation it
  was only allowed to watch.
- **Profiles are provisioned by trigger**, with handle collisions resolved by
  suffix rather than failing the sign-up. Otherwise there is a window where a
  signed-in user has no profile row and every foreign key breaks on first use.
- **Storage is namespaced `<uid>/<file>`**, which makes the owner check a path
  comparison instead of a lookup.

### Schema review — 15 Aug 2026, five fixes applied

Read back end to end before applying. Five things were wrong or missing; all are
now fixed in the file. **The SQL has still never been executed** — there is no
Postgres, no `supabase` CLI and no Docker on this machine, so "reviewed" is the
strongest word that applies. The first run against the live project is the test.

- **The handle format check did nothing against mixed case.** `handle` is
  `citext`, and citext overrides `~` to be case-insensitive — so
  `^[a-z0-9_]{3,20}$` accepted `Tomisin` and stored the capital. Now
  `handle::text ~ …`, which restores a case-sensitive match; uniqueness is
  unaffected, since the index is still on the citext column.
- **A null email broke sign-up.** `auth.users.email` is nullable (phone, and
  some OAuth providers). `split_part(null, …)` is null, which walked all the way
  to a not-null violation on `handle` — surfacing to the user as *Database error
  saving new user* with nothing to act on. Now coalesced.
- **A post could be addressed to a circle its author does not own.**
  `visible_circle_ids` was an unvalidated uuid array, so a crafted client could
  push a private post into a stranger's circle — the Boundary running backwards.
  A check constraint cannot ask this (it needs a subquery), so it is now a
  `before insert or update` trigger, `security definer` because the author
  cannot select another owner's circles to prove the negative.
- **Every policy re-evaluated `auth.uid()` per row.** Wrapped as
  `(select auth.uid())` throughout, which lets the planner hoist it to an
  InitPlan. This matters most on `posts`, where the select policy already calls
  a function per row.
- **Nothing could delete from storage.** Replacing an avatar or discarding a
  draft's photos left the old objects billable and unreachable. Both buckets now
  have an owner-scoped delete policy.

Two deliberate gaps, flagged rather than changed: `spaces` has no insert policy,
so rooms can only be created with the service key (curated, which is the current
product intent), and `space_members` is world-readable, so room membership is
public. Both are decisions rather than oversights — worth confirming they are
the ones you want before beta.

Remaining before dummy data can go: wire the app's reads and writes to these
tables, upload media to the buckets instead of holding local `file://` URIs,
and key the early-adopter badge off `auth.users.created_at` rather than a
device-local `joinedAt`.

## Open items

### ~~1. Onboarding tour does not advance past page 1~~ — **fixed 15 Aug 2026**

Neither hypothesis in the original note was right, and `onboarded` *is* persisted.
Three separate defects, now all fixed and verified on the simulator.

**a. The tour could not advance (the reported symptom).** `app/tour.tsx` tracked the
current page in `page` state that was only ever written by `onMomentumScrollEnd`.
That callback does not fire for a programmatic `scrollTo`, so after the first
**Next** tap the ScrollView sat on page 2 while `page` stayed `0`; every later tap
recomputed `goTo(0 + 1)` and scrolled to the page already on screen. `last` never
became true either, so "Start using Vybe" never appeared. `goTo` now sets `page`
itself and clamps to the slide range.

**b. Routing was decided against pre-hydration defaults.** `app/_layout.tsx` was the
stale file — written before `tourSeen`, `hydrated`, `setup.tsx` and `(auth)/` existed,
and never updated. It ran `router.replace('/tour')` in a mount-only effect, which
fires before the persisted slice is read off disk and can never correct itself.
It also gated on `onboarded` (which means "the feed has been set up") rather than
`tourSeen`, and never read `useAuth` at all — so `(auth)/sign-in`, `(auth)/sign-up`
and `setup.tsx` were unreachable dead screens, and **`useAuth.init()` was never
called anywhere**, leaving `status` stuck on `'loading'` forever.

The four gates — tour, account, setup, feed — are now `Stack.Protected` guards
(the SDK 53+ pattern; the `useEffect` + `replace` approach is explicitly legacy).
Guards re-evaluate on every render, so the navigator moves the moment a flag lands
rather than deciding once against defaults. The splash is held until fonts, the
persisted slice and the stored session have all resolved, so nobody sees a frame
of the tour they finished months ago.

Flipping a flag is now the only way to move between gates; nothing navigates to
these routes by hand. That is why Profile's "Take the tour" calls the new
`replayTour()` instead of `router.push('/tour')` — pushing a guarded route cannot
work once the guard has closed behind it — and why `setup.tsx` no longer calls
`router.replace('/(tabs)')` after `applySetup`.

**c. A storage failure bricked the app.** Making routing wait on `hydrated` turned a
previously silent failure into a splash screen that never cleared. Both stores now
degrade instead: `useVybe`'s AsyncStorage adapter catches read/write rejections and
starts fresh, and `useAuth.init()` catches a failed `getSession()` and resolves to
`signed-out`. Starting empty is a far better answer than not starting at all.

**Verified on the iPhone 17 Pro simulator.** Fresh install → tour page 1; Next
advances through all five pages; finishing routes to the account gate; a cold
restart goes straight back to the account gate with no tour flash, confirming the
persisted flag and the hydration gate both work. Typecheck clean.

**Not verified on device:** the setup gate. Reaching it needs a signed-in Supabase
session, and creating an account is not something to do from here. Its guard is the
same mechanism as the three that were exercised, but it has not been run.

### 1b. Sign-up OTP — **built 15 Aug 2026, round trip untested**

Sign-up now confirms with a six-digit emailed code instead of a link. New screen
`app/(auth)/verify.tsx`; `useAuth` gained `verifyOtp`, `resendOtp` and
`cancelConfirmation`.

Routing follows the same rule as everywhere else — a flag, not a `push`.
`pendingConfirmation` guards the verify screen in `(auth)/_layout.tsx` and guards
sign-up/sign-in off while it is set, so the two states cannot both be on the stack
and there is no half-finished sign-up to swipe back to. Verifying clears the
address and produces a session, and the root layout moves on to setup by itself.

Details worth knowing:

- **The Supabase email template must be changed by hand.** The default *Confirm
  signup* template emails `{{ .ConfirmationURL }}`, not `{{ .Token }}` — on a
  default project no code is ever sent and the verify screen has nothing to
  accept. See the README.
- **Signing in with an unconfirmed account no longer dead-ends.** It used to say
  "confirm your email first" with no way to do so, since the original code had
  expired. It now sends a fresh code and routes to verification.
- `clearError()` no longer clears `pendingConfirmation` — it was doing two
  unrelated jobs, and sign-up clears errors on every keystroke. Leaving
  verification is now `cancelConfirmation()`.
- Typing the sixth digit submits; a `useRef` of the last attempt stops a wrong
  code from re-submitting on every render.

**Untested:** the actual round trip. Exercising it means creating a real account
against the live project, which is yours to do — sign up, check the inbox, type
the code. Everything up to the network call is verified: typecheck clean, app
reloads with no runtime errors, sign-up renders.

### 2. Server-side Boundary enforcement — **required before any beta**

`canView()` in `src/algo/engine.ts` is a rendering convenience, not a security control. A post restricted to a Circle must be filtered at the query in the candidate service and never serialised to a user outside it. See PRD §5.3.

### 3. Cold start is unresolved

A new user has no topic weights, so `topicPull` contributes nothing and the feed leans on freshness and crowd — the exact defaults the product argues against. Three options written up in PRD §11.1; current lean is the honest one (tell the user we do not know them yet).

---

## Visual language — replaced 15 Aug 2026

The flat, hairline-ruled, Inter/blue "editorial" skin is gone. The app now
follows the Social Tree reference: near-black ground, volt-lime accent, Outfit
type, and large rounded cards.

No feature was added, removed or renamed. Stories, LIVE, Reels and Events
appear in the reference and were **not** built — they are not in the PRD.

| Was | Is |
|---|---|
| Inter, 15/21 | Outfit, 15/22, tighter display tracking |
| `#4C8DFF` blue accent | `#D2F34C` volt (`c.volt` / `c.onVolt`) |
| `#000` ground, full-bleed rows split by hairlines | `#08090A` ground, 24px cards separated by gaps |
| Media inset in the text column, 16px radius | Media full-bleed to the card edge, chrome floating on it in dark pills |
| Actions as a bare icon row | Two pill groups: engagement, then save |
| Underlined feed-mode tabs | Filled volt chips |
| Glass tab bar, equal slots, all four labelled | Pill bar, active tab expands to icon + label, compose inline at centre |
| Profile as a colophon | Volt hero card (both own profile and other accounts) |

Two things are worth knowing before touching the palette:

- **`primary` and `volt` are different roles.** `volt` is the literal fill and is
  identical in both themes, always paired with `onVolt` ink. `primary` has to
  survive as a 1px stroke and as 12px text, which volt does not do on a light
  ground — so in light mode `primary` darkens to `#405F00` while `volt` stays
  put. Use `volt` for filled surfaces, `primary` for strokes, meters and tinted
  text.
- **The page gutter belongs to the list, not to `PostCard`.** The card fills its
  column. `app/(tabs)/index.tsx` supplies `paddingHorizontal`; the post detail
  and author screens already had their own.

Verified on the iPhone 17 Pro simulator in both themes: feed (text and media
posts), Discover, Your Algo, own profile, tour. Typecheck clean.

## Built and verified on device

Verified by driving the iPhone 17 Pro simulator (iOS 26.5) screen by screen. Typecheck clean.

| Area | State |
|---|---|
| Ranking engine (`src/algo/engine.ts`) | 8 explainable terms, greedy variety pass, receipts generated in the same pass as the score |
| Feed | For You / Following / Circles / Latest; chronological modes bypass ranking and say so |
| Receipts | Score decomposition + `signal × weight` + inline More/Less/Mute/Less-from-them |
| Your Algo | Genome (draggable topic constellation), topic sliders, 6 dials, temporary modes with expiry rings |
| Circles & Boundaries | Circle management with feed boost; dual-handle radial dial (see vs reply), inner handle constrained by outer |
| `@my_algo` | Parser handles direction, topic, deixis ("this"), duration; verified live re-rank #1 → #5 |
| Algorithm Ledger | Append-only, per-entry inverse patch, one-tap undo; live diff banner after each change |
| Time Machine | 5 counterfactual presets; reports 5/10 displaced vs The Engagement Machine on seed data |
| Attention Budget | Countdown ring, feed desaturates past limit, no lockout |
| Discover | Spaces, topic grid, "What you are not seeing", people + circle assignment |
| Profile | Attention shape, circles, data/portability, appearance |
| Theming | Light + dark verified independently; volt/violet role swap holds contrast in light mode |
| iOS Liquid Glass | Real `GlassView` on iOS 26 with merge container; blur → solid fallbacks |

## Not built (v1.1 — PRD §9.2)

Application backend (Postgres schema + Redis + candidate service), real media
pipeline, push notifications, block/report, Space moderation, full data export,
Android polish pass.

**Auth is built and is the one server-side thing in the app.** Sign-up, sign-in and
OTP confirmation run against a live Supabase project, which provisions and owns
`auth.users` itself — no schema of ours is involved, which is why the account flow
works with no tables defined.

Nothing else talks to the server: there is not one `supabase.from()` call in the
codebase. Posts, circles and topics come from `src/data/seed.ts` into zustand and
persist to AsyncStorage. So a real account carries an email and a display name and
nothing else — sign in on a second device and the feed is back to defaults, because
the algo state is on the first device's disk. Worth being deliberate about before
beta: it is the same missing piece as open item 2, since a Boundary cannot be
enforced at a query that does not exist.

Ranking runs client-side against seeded data **by design**, not as a shortcut — see PRD §5.1.

---

## Environment notes (bites that already cost time)

- **`npm install` must use `--legacy-peer-deps`.** There is a pre-existing `react` / `react-dom` peer conflict. A plain `npm install` silently pruned `babel-preset-expo` and `react-native-worklets`, which broke Metro and CocoaPods in two separate ways.
- **`react-native-worklets` must stay on 0.10.x.** Reanimated 4.5.1 rejects 0.11+ at podspec validation.
- **CocoaPods on Ruby 4.x** fails with a Unicode normalization error. Run `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before `pod install`.
- **Native build required.** `expo-glass-effect`, Reanimated and Gesture Handler are not in Expo Go.
- **The simulator build goes stale silently.** The `.app` installed on the simulator
  had been built before `@react-native-async-storage/async-storage` was linked, so
  every persisted write failed at runtime with `AsyncStorageError: Native module is
  null` — invisible until something depended on rehydration. JS-only changes reload
  over Metro, but after any dependency change rebuild natively (`npx pod-install`
  then `npx expo run:ios`) rather than relaunching the installed binary.
- **Gesture callbacks are worklets.** They cannot call JS closures. This already caused one crash in `BoundaryDial` (`rFor()` called on the UI runtime) — pass numbers into handles, not functions.
- **Liquid glass needs an explicit tint in dark mode.** Left untinted the system material lifts toward white and blows out the UI.
- **Metro may run on :8081 from another session.** Check before starting a second one.
