/**
 * push-notify — turns a `notifications` row into a push notification.
 *
 * This is the piece that made notifications work between people rather than
 * only on the phone that caused them. The app used to schedule a *local*
 * notification during `sync()`, which by definition only ever appeared on the
 * device that scheduled it; nothing any user did could put a banner on anyone
 * else's phone.
 *
 * ## How it is wired
 *
 * Deploy, then point a Database Webhook at it:
 *
 *   supabase functions deploy push-notify --no-verify-jwt
 *   supabase secrets set PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"
 *
 * Then in Dashboard → Database → Webhooks, create one on `public.notifications`
 * for **Insert**, pointing at this function's URL, with an HTTP header
 * `x-webhook-secret: <the value you just set>`.
 *
 * `--no-verify-jwt` is required because the webhook is not a signed-in user;
 * the shared secret below is what replaces that check. Without it this endpoint
 * is an open relay that will push arbitrary text to any account's devices.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are injected by the platform.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string;
  type: 'like' | 'boost' | 'reply' | 'follow' | 'circle' | 'profile_view' | 'post';
  post_id: string | null;
};

/**
 * What each kind of event says, and whether it is worth interrupting somebody
 * for.
 *
 * `profile_view` is deliberately silent. It is recorded so the notifications
 * screen can show it, but a phone buzzing because someone looked at your page
 * is the kind of engagement bait this product exists to argue against.
 */
function compose(
  row: NotificationRow,
  actor: string,
  snippet: string,
): { title: string; body: string } | null {
  switch (row.type) {
    case 'like':
      return { title: actor, body: 'liked your post' };
    case 'boost':
      return { title: actor, body: 'reposted your post' };
    case 'reply':
      return { title: actor, body: snippet ? `replied: ${snippet}` : 'replied to your post' };
    case 'follow':
      return { title: actor, body: 'started following you' };
    case 'circle':
      return { title: actor, body: 'added you to a circle' };
    case 'post':
      return { title: actor, body: snippet ? `posted: ${snippet}` : 'shared a new post' };
    case 'profile_view':
      return null;
    default:
      return null;
  }
}

/** Deep link, so tapping the banner lands on the thing it is about. */
function target(row: NotificationRow): string {
  if (row.post_id) return `/post/${row.post_id}`;
  if (row.type === 'follow' || row.type === 'profile_view') return `/profile-view/${row.actor_id}`;
  return '/notifications';
}

Deno.serve(async (req: Request) => {
  // The shared secret is the whole authentication story for this endpoint.
  // Compared in full rather than early-returning on the first differing byte —
  // the timing difference is not realistically exploitable here, but writing it
  // the careless way is a habit that eventually lands somewhere it matters.
  const expected = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
  const provided = req.headers.get('x-webhook-secret') ?? '';
  if (!expected || provided.length !== expected.length || provided !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const row = payload?.record as NotificationRow | undefined;
  if (!row?.user_id) return new Response('No record', { status: 400 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Never notify somebody about their own action. The triggers in 0005 already
  // guard this, but a second check costs one comparison and the failure mode —
  // your phone buzzing at you for liking your own post — is the sort of thing
  // that ships.
  if (row.user_id === row.actor_id) return new Response('Self', { status: 200 });

  const { data: detail } = await supabase
    .from('notification_delivery')
    .select('actor_name, actor_handle, post_snippet')
    .eq('id', row.id)
    .maybeSingle();

  const actor = detail?.actor_name || (detail?.actor_handle ? `@${detail.actor_handle}` : 'Someone');
  const message = compose(row, actor, detail?.post_snippet ?? '');
  if (!message) return new Response('Silent', { status: 200 });

  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', row.user_id);

  if (!tokens?.length) return new Response('No devices', { status: 200 });

  // Expo accepts up to 100 messages per request.
  const messages = tokens.slice(0, 100).map((t: { token: string }) => ({
    to: t.token,
    title: message.title,
    body: message.body,
    sound: 'default',
    channelId: 'default',
    data: { url: target(row), notificationId: row.id },
  }));

  const res = await fetch(EXPO_PUSH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
    body: JSON.stringify(messages),
  });

  const result = await res.json().catch(() => null);

  /**
   * Expo reports a dead token as `DeviceNotRegistered`, and a token that is
   * never cleaned up is delivered to forever — the send keeps succeeding at the
   * API level while nothing arrives, which is the failure mode that looks like
   * "push is broken" and is impossible to diagnose from the client.
   */
  const dead: string[] = [];
  const receipts = result?.data;
  if (Array.isArray(receipts)) {
    receipts.forEach((r: { status?: string; details?: { error?: string } }, i: number) => {
      if (r?.details?.error === 'DeviceNotRegistered') dead.push(messages[i].to);
    });
  }
  if (dead.length) await supabase.from('device_tokens').delete().in('token', dead);

  return new Response(JSON.stringify({ sent: messages.length, pruned: dead.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
