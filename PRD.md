# Vybe — Product Requirements Document

**Your Social Experience, Your Rules.**

Version 1.0 · Expanded from the original Product Specification
Owner: Tomisin · Status: MVP built, pre-beta

---

## 0. What changed from the original spec

The original spec named three pillars: an Instagram + X content foundation, algorithmic control ("Your Algo", "Dear Algo", multiple feeds), and Circles/Boundaries. All three are in this document and all three are built.

This PRD adds the parts the spec left implicit — and one argument it did not make:

> Letting people configure an algorithm is not the same as making an algorithm accountable. A slider you cannot audit is still a black box with a nicer front end.

Everything new here follows from that. **Receipts** (§4.2), the **Algorithm Ledger** (§4.5), the **Time Machine** (§4.6), and the **Attention Budget** (§4.7) exist so that the control the spec promised is *checkable*, not merely offered.

---

## 1. Vision

### 1.1 Mission

Build a social platform where users are the architects of their own experience, not the product of an opaque algorithm.

### 1.2 The problem, stated precisely

Every major feed optimises a hidden objective — usually predicted engagement — and exposes no interface to it. Three consequences:

1. **No agency.** "Not interested" is a suggestion; the system remains in charge.
2. **No explanation.** Users cannot find out why they saw something, so they invent theories, and the theories are usually wrong and usually paranoid.
3. **No exit.** Preferences cannot be exported, inspected, or turned off. A chronological feed, where it survives at all, is buried.

### 1.3 Product principles

These are constraints on implementation, not marketing copy. Each one is enforced somewhere in the codebase.

| # | Principle | Enforced by |
|---|---|---|
| P1 | **No signal the user cannot see and change.** The ranking function has exactly six weights and they are all user-set. | `src/algo/engine.ts` — every term is `signal × user_weight`, and every term is emitted into the receipt |
| P2 | **Every post can explain itself.** The explanation is the computation, not a reconstruction of it. | `scorePost()` returns `{total, factors}` in one pass |
| P3 | **Every change is reversible.** | Algorithm Ledger with per-entry inverse patches |
| P4 | **Virality has exactly one door, and it has a lock.** Set `crowd = 0` and popularity cannot enter the feed at all. | The `crowd` dial is the only term reading likes/boosts |
| P5 | **Nothing is set forever.** Time-boxed modes expire on their own. | `TemporaryMode.expiresAt`, checked at score time |
| P6 | **The product does not want more of your time than you offered it.** | Attention Budget; feed desaturates past the limit, never locks |
| P7 | **Audience and interaction are separate questions.** | `Boundary { visibleTo, canInteract }` |

### 1.4 Non-goals for v1

- Engagement-prediction models of any kind.
- Ads, sponsored placement, or paid reach. (See §10 on why this is a business-model constraint, not a phase.)
- Streaks, daily-login rewards, or any variable-reward loop.
- Full ActivityPub federation (v1 ships read-only mirroring only — §9.3).
- DMs (v2).

---

## 2. Users

### 2.1 Primary personas

**The Refugee** — left or reduced use of a major network because the feed stopped serving them. Technically comfortable, ideologically motivated, will read the receipt. Highest-value early adopter and highest-value evangelist. Acquisition: word of mouth, tech press, the Time Machine screenshot.

**The Curator** — photographer, designer, writer. Cares about reach *and* about who can reply. Boundaries is their feature; algorithmic control is a bonus. Acquisition: Spaces, cross-posting.

**The Boundary-Setter** — posts to different groups and currently maintains multiple accounts to do it. Circles collapses those accounts into one. Acquisition: direct — this is a pain nobody else solves.

**The Curious Normal** — no ideology, just tired. Will never open the Genome. Must get a good feed on defaults and must not be punished for ignoring every control. **This persona is the hardest constraint in the product** (§3.3).

### 2.2 Anti-persona

The growth-hacker who wants reach without relevance. Vybe has no mechanism to buy or game distribution, and this is deliberate.

---

## 3. Experience architecture

### 3.1 Information architecture

```
Feed (tab)          For You · Following · Circles · Latest
  └ Post detail       comments + @my_algo composer
  └ Author            circle assignment + per-author weight
Discover (tab)      Spaces · Topics · What you are not seeing · People
Your Algo (tab)     Genome · Topics · Dials · Temporary modes · Budget
You (tab)           Attention shape · Circles · Data · Appearance
Compose (modal)     write → Boundaries dial → publish
Time Machine (modal)
Ledger (modal)
```

Four tabs, matching the ≤5 bottom-nav limit. Compose is a distinct floating action rather than a fifth tab, because it is an action and not a place.

### 3.2 Design system

| Token | Value | Rationale |
|---|---|---|
| Ground | `#08080C` | The brand mark is a white lightning-V on near-black; the app is dark-first |
| **Volt** `#C2F53F` | primary | User agency. Boost, "your" settings, the things you control |
| **Pulse** `#7C5CFF` | accent | The machine side. Algorithm, receipts, `@my_algo` |
| **Ember** `#FF5C7A` | reaction | Affection and negative weights. Never system state |
| Display | Space Grotesk | Technical, slightly engineered — the feed is an instrument |
| Body | Outfit | Geometric, high legibility at 16px |
| Motion | 150–300ms, spring-settled | Below 150ms reads as a glitch; above 300ms reads as slow |

**Semantic colour discipline:** volt always means *you did this*; pulse always means *the system did this*. In light mode volt would fail contrast as text, so the roles swap: violet carries emphasis and volt survives only as a fill behind dark text.

**The Aura.** Every screen carries a slow ambient wash coloured by the topics the user has actually turned *up*. Two people running Vybe on the same day see different rooms. The feed's identity is theirs, not the brand's.

### 3.3 The Curious Normal constraint

Every control ships with a defensible default, and the app must be good with zero configuration:

- Default dials produce a feed that is recent, close-friends-first, and only mildly popularity-driven.
- Receipts are collapsed by default — a one-line summary, no numbers, until tapped.
- The Genome is the *third* thing in Your Algo, after the plain-language summary.
- No onboarding wizard demands the user configure an algorithm before seeing content.

**Measurable form of this constraint:** D7 retention for users who never open Your Algo must be within 15% of users who do. If tuning becomes mandatory for a good experience, the product has failed this persona.

---

## 4. Features

### 4.1 Content & engagement (spec §2)

| Type | Notes |
|---|---|
| Photo / Carousel | Up to 10 images, swipeable, deterministic gradient placeholder while loading |
| Video (Reels) | Short-form vertical |
| Text | Short-form, no character theatre |
| Thread | Numbered, self-linking |
| Article | Long-form; Vybe will not cut you off at 280 |

Reactions: like, comment, boost (repost), save. **Boosts are the only mechanism that moves content between social graphs** — there is no house amplification.

**Spaces** are topic rooms with their own membership and rules. Posts may belong to a Space and to the author's followers simultaneously.

### 4.2 Revolutionary Feature #1 — Algorithmic control

#### 4.2.1 The ranking function

A post's score is the sum of eight explainable terms. There is no ninth term.

| Term | Signal | Weight | Notes |
|---|---|---|---|
| Topic affinity | mean user weight over the post's topics, −1…1 | `topicPull` | Negative weights are real demotions, not just absence |
| Freshness | `0.5 ^ (age / halfLife)` | `freshness` | Half-life is **derived from the dial**: 48h at 0, 4h at 1 |
| Crowd | `log₁₀(1 + likes + 2·boosts) / 5` | `crowd` | The only virality door (P4) |
| Closeness | max circle boost, else 0.35 if followed | `intimacy` | Circle membership beats a raw follow |
| Serendipity | stable per-(post, day) noise, full strength only off-profile | `serendipity` | Stable so the feed does not shuffle under the user |
| Variety | `−min(1, 0.5 × repeats above)` | `variety` | Applied *greedily during selection*, so it reflects the feed being built |
| Author note | direct weight from `@my_algo` / receipts | 1.0 | Unmediated — what you said is what is applied |
| Already seen | −0.4 | 1.0 | A soft demotion, never a hard hide |

**Design note on greedy variety.** Variety cannot be a pre-pass: the penalty depends on what has already been placed. The engine therefore selects one post at a time, re-scoring the remainder each round. O(n²) at feed scale, which is fine for the ~200-candidate window and is the honest implementation.

#### 4.2.2 The six dials

`topicPull`, `freshness`, `crowd`, `intimacy`, `serendipity`, `variety` — each 0…1, each with a plain-language description of what it does and what happens at either extreme.

#### 4.2.3 The Feed Genome

The same numbers as the topic sliders, expressed spatially: the user is the centre, and each topic sits at a distance they set by dragging along its own spoke. Pull it in to see more; push it to the rim to fade it out.

This exists because a column of sliders never shows the *shape* of someone's attention — which three things they have pulled close, and how much everything else orbits at arm's length. Nodes scale and glow with weight, so a glance reads as a portrait.

#### 4.2.4 Temporary modes (spec: "Show more sports for the next 3 days")

A time-boxed delta layered on top of the base weight, with a countdown ring. It expires by itself. The user never has to remember to undo it — which is the entire point, since forgotten preference changes are how black-box feeds silently drift.

#### 4.2.5 Multiple feeds (spec §3.3)

| Feed | Behaviour |
|---|---|
| **For You** | Full engine, receipts on every post |
| **Following** | Reverse-chronological, follows only, ranking bypassed |
| **Circles** | Engine, restricted to accounts in a Circle |
| **Latest** | Reverse-chronological, everything visible |

In the chronological feeds the receipt reads **RAW** and states plainly: *"Ranking is switched off in this feed. Newest first, nothing else."* Turning the algorithm off must be as legible as turning it on.

### 4.3 Receipts — "Why am I seeing this?"

**New in this PRD. The most important feature in the product.**

Every post carries a collapsed one-line strip: its rank, a plain-language headline (*"Mostly lifted by closeness"*), and its score. Tapping expands the full decomposition: a diverging bar per term, the `because` sentence in plain English, and the arithmetic — `signal 0.50 × your weight 0.70`.

Below the breakdown, the same panel offers **More / Less / Mute 7 days / Less from them**. Reading why and changing it are one gesture.

This is what converts "you control the algorithm" from a claim into something a user can check in four seconds.

### 4.4 "Dear Algo" — `@my_algo` (spec §3.2)

Replying to a post with `@my_algo show me less like this` posts a normal public reply **and** retunes the feed. The parser handles direction (`less`/`fewer`/`mute` vs `more`/`boost`), explicit topics, deictic reference ("this" → the post's topics), and durations ("for 3 days" → a temporary mode).

The reply is tagged in-thread — *"Your feed was retrained by this reply"* — so the dual effect is never hidden. In testing, a `less like this` on a top-ranked photography post dropped it from #1 to #5 immediately, visibly.

### 4.5 The Algorithm Ledger

**New.** An append-only history of every change ever made to the feed — from the panel, the Genome, a receipt, an `@my_algo` reply, or a mode — each with a one-tap undo backed by a stored inverse patch.

After any change the feed also surfaces a **live diff**: *"Your change reordered 9 posts · @lumen ↑4 · @buzzfold ↓6"*, with Undo. Cause and effect, immediately, in ranks moved rather than reassurance.

### 4.6 The Feed Time Machine

**New.** Runs the user's real posts through a *different* algorithm and shows exactly what would have surfaced.

| Preset | What it demonstrates |
|---|---|
| **The Engagement Machine** | `crowd = 1`, topics ignored — what a conventional platform would show you |
| **Nothing At All** | Pure reverse-chronological |
| **People, Not Posts** | Circles first, popularity off |
| **Take Me Somewhere Else** | Maximum serendipity, deliberately uncomfortable |

It reports one number: how many of the alternative feed's top 10 never reach the user's real top 10. On seed data against the Engagement Machine that number is **5** — and the two accounts at the top are a gossip aggregator and a crypto shill.

A time scrubber rewinds up to 72 hours; because recency is genuinely time-dependent, rewinding re-ranks the feed as it actually stood.

**This is the single best acquisition asset in the product.** It is a screenshot that makes the argument on its own.

### 4.7 The Attention Budget

**New.** The user sets a daily limit. A ring in the header counts *down* the time they gave themselves, rather than counting up the time the product extracted.

Past the limit: the Aura dims, cards desaturate, the tab indicator cools from volt to slate, and the feed footer says *"The feed is still here and nothing is locked. It just stopped trying to be interesting."*

No lockout, no shame screen, no streak to break. The only affordance offered is *"Give myself 10 more minutes"* — an explicit, unpunished choice.

### 4.8 Revolutionary Feature #2 — Circles & Boundaries (spec §4)

**Circles** are user-defined lists (Close Friends, Work, Photography Enthusiasts, Family) that do two jobs at once:

1. **Audience** — who can see and who can reply to a post.
2. **Ranking** — each Circle carries a boost that feeds the `intimacy` term.

That dual role is why Circles are worth maintaining. A list that only filters is a chore; a list that also improves your feed pays for itself.

**Boundaries** are set on the composer's radial dial. Reach is drawn as distance: tighter ring, fewer people. Two handles ride the same spoke — an outer one for who can *see*, an inner one for who can *reply*.

The inner handle can never pass the outer one, so an impossible boundary ("only close friends can see it, but everyone can comment") cannot be expressed. The spec's example — *"only Close Friends can comment, but everyone can see"* — is two drags.

Every post displays its boundary as a badge, on the author's copy and on the reader's. Readers outside the reply set see: *"The author limited replies to a Circle you are not in. You can still read and boost."* — stated, not silently disabled.

---

## 5. Technical architecture (spec §5)

### 5.1 Client

Cross-platform React Native on Expo SDK 57 — a single codebase for iOS and Android, per the spec's §6.4 recommendation.

| Concern | Choice |
|---|---|
| Routing | `expo-router` (file-based, typed routes, deep-link ready) |
| Animation | Reanimated 4 + Gesture Handler, all gestures on the UI thread |
| State | Zustand |
| Glass | `expo-glass-effect` → `expo-blur` → solid |
| Ranking | Runs **client-side** in v1 |

**Why ranking runs on the client.** A transparent algorithm you cannot execute is still a claim. Running it locally means the receipt is generated by the same code path that ordered the feed, the app works with a stale candidate set offline, and no dwell-time telemetry needs to leave the device. At scale the server pre-filters candidates; it does not rank them.

### 5.2 iOS Liquid Glass

On iOS 26+ the navigation chrome uses the system's real Liquid Glass material via `GlassView`, with live refraction and specular response to touch. The floating tab bar and the compose button are siblings inside a `GlassContainer`, so the system merges and morphs their materials as they animate — they read as one body of liquid rather than two chips.

Two implementation notes worth keeping:

- **Tint is mandatory in dark mode.** Left untinted, the system material lifts toward white and blows out a dark UI. A `#0E0E16` ground tint keeps it reading as glass over our own surface.
- **Android and older iOS get `expo-blur` + a tint layer** with identical geometry. Call sites never branch on platform.

### 5.3 Server (to build)

Per the spec's hybrid model:

- **Postgres** — users, follows, posts, circles, boundaries, algo state.
- **S3-compatible object storage** — media, with CDN in front.
- **Redis** — per-user algo state at the edge; candidate-set cache; feed-position cache.
- **Candidate service** — assembles ~200 boundary-eligible candidates per request (follows + circles + Spaces + an explore pool sized by the user's `serendipity`), then **stops**. Ranking is the client's job.

**Boundary enforcement is server-side and non-negotiable.** The client's `canView` check is a rendering convenience. A post restricted to a Circle must never be serialised to a user outside it — filtered at the query, not in the response.

### 5.4 Data model

```ts
Post {
  id, authorId, kind, body, media[], topics[], createdAt,
  likes, comments, boosts,
  viralityRatio,                 // share of reach that came from boosts, not follows
  boundary: { visibleTo[], canInteract[] },
  spaceId?, readSeconds
}

AlgoState {
  topicWeights: Record<TopicId, number>,   // -1 … 1
  authorWeights: Record<AuthorId, number>, // -1 … 1
  dials: { topicPull, freshness, crowd, intimacy, serendipity, variety },
  modes: TemporaryMode[]
}

ScoreReceipt {
  postId, total, rank, headline,
  factors: { key, label, signal, weight, contribution, because, actionableTopic? }[]
}
```

`viralityRatio` is stored per post and surfaced in the receipt — *"94% of its reach was virality"* — so users can see the difference between something their circle liked and something the internet did.

### 5.5 Open-source commitment

`src/algo/engine.ts` is published. It is ~400 lines and readable in one sitting; that is a design goal, not an accident. A ranking function nobody can read is not meaningfully open.

The Profile screen links to it directly: *"The engine that built your feed is open. Every term is in it."*

---

## 6. Accessibility

Non-negotiable, verified before ship:

- Touch targets ≥44×44pt, `hitSlop` where the glyph is smaller.
- Body text ≥4.5:1 in both themes; secondary ≥3:1.
- Every control has a descriptive `accessibilityLabel`; sliders expose `accessibilityRole="adjustable"` with a spoken value.
- Colour is never the only channel — score direction carries a sign and a word, not just volt-vs-ember.
- Reduced motion: the Aura holds its colour and stops drifting; nothing depends on animation to be understood.
- Pressed states never change layout bounds.

---

## 7. Metrics

### 7.1 What we measure

| Metric | Target | Why |
|---|---|---|
| **Receipt open rate** | >25% of WAU weekly | Do people actually check the claim? |
| **Algo edits per WAU** | >3 / week | Is control used, or decorative? |
| **Time Machine reach** | >40% within 14 days | Best conversion asset |
| **Boundary usage** | >30% of posts non-public | Is Circles load-bearing? |
| **Budget adherence** | >60% stop within 10 min of limit | Does calm-down work without a lock? |
| **Untuned D7 retention** | within 15% of tuned | §3.3 — the Curious Normal constraint |

### 7.2 What we refuse to measure or optimise

Time-in-app as a success metric. Session count. Notification-driven return rate. Any metric that improves when the product gets stickier rather than better.

**The budget makes this concrete:** a product optimising for time cannot ship a feature that desaturates its own feed. Shipping it is the commitment.

---

## 8. Trust, safety & moderation

Deliberately out of the original spec's scope and genuinely required before public beta.

- **Boundaries are a safety primitive, not just a privacy one.** Restricting replies to a Circle is the most effective anti-pile-on tool in the product, and it is available to every user by default.
- **Reporting and blocking** ship with v1. A block removes the account from every Circle and hard-filters it from candidates.
- **Spaces need moderators**; Space-level rules and removal are v1.1.
- **The algorithm is not a moderation tool.** A user turning a topic down must not be confused with a policy action. Muting is personal; removal is policy; the UI never blurs them.
- **`serendipity` is bounded by policy.** Off-profile injection draws from the same moderated pool as everything else — serendipity is not a loophole for unvetted content.
- **Known open question:** transparent ranking is also legible to bad actors. Since the weights are the *user's*, gaming them means guessing an individual's private settings rather than a global model — a materially harder attack. This needs adversarial testing before public beta (§11).

---

## 9. Roadmap

### 9.1 v1.0 — MVP (built)

Feed with four modes · full engine + receipts · Your Algo (Genome, topics, dials) · temporary modes · Circles & Boundaries dial · `@my_algo` · Ledger with undo · Time Machine · Attention Budget · Discover (Spaces, topics, people) · profile & data screens · light/dark · iOS Liquid Glass.

### 9.2 v1.1 — Beta hardening

Backend (Postgres + Redis + candidate service, **server-side boundary enforcement**) · auth · real media pipeline · push notifications (user-configured, never engagement-bait) · block/report · Space moderation · full data export · Android polish pass.

### 9.3 v1.2 — Openness

`engine.ts` published with a public changelog · ActivityPub **outbound mirroring** (read-only, off by default) · algorithm import/export as a shareable file — *"here is my feed, try it"*, which makes tuning social without making it competitive.

### 9.4 v2

DMs (boundary-aware) · full ActivityPub federation · collaborative Circles · Spaces with their own configurable ranking · algorithm marketplace (share presets, never sell placement).

---

## 10. Business model

Stated here because it is a product constraint, not a finance appendix.

Vybe cannot run on advertising. An ad system needs the ability to place content the user did not ask for, which breaks P1 and P4 simultaneously and makes every receipt a lie.

Viable paths: **subscription** (the honest one — the user is the customer); **Spaces-as-a-service** (paid tooling for communities, no reach purchase); **paid data portability/hosting** for power users.

**Test to apply to any future revenue idea:** *can it be fully described in a receipt without embarrassing us?* If not, it does not ship.

---

## 11. Open questions

1. **Cold start.** A new user has no topic weights, so `topicPull` contributes nothing and the feed leans on freshness and crowd — the exact defaults we are arguing against. Options: a one-screen topic picker at signup; borrowing weights from the accounts they first follow; or an explicit "we don't know you yet, here's what we're doing" state. **Leaning toward the third**, since it is the only one that is honest about the situation.
2. **Adversarial ranking.** See §8. Needs red-teaming before public beta.
3. **Client-side ranking at scale.** The greedy variety pass is O(n²). Fine at 200 candidates; needs measurement on low-end Android before the window grows.
4. **Does the Genome earn its complexity?** It is the most novel surface and the most skippable. Instrument it; if usage is under 10% of Your Algo sessions after beta, demote it from the default tab.
5. **Boost semantics.** Boosting is currently the only cross-graph mechanism, which makes it powerful and therefore worth gaming. Should a boost carry the booster's `intimacy` weight to the recipient, so it travels through trust rather than volume?

---

## 12. Success, in one sentence

A user opens Vybe, taps a receipt, sees exactly why a post reached them, disagrees, changes it in one tap, and watches the feed reorder in front of them.

Nothing else in this document matters if that sequence does not work.
