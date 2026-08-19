// @ts-nocheck
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    "mailto:contact@vybe.app",
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { recipientId, title, body, url } = await req.json();

    if (!recipientId) {
      return new Response(JSON.stringify({ error: "Missing recipientId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: subs, error } = await supabase
      .from("web_push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", recipientId);

    if (error || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "No active subscriptions" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    const payload = JSON.stringify({
      title: title || "Vybe",
      body: body || "New update received",
      url: url || "/",
    });

    const sendPromises = subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from("web_push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    });

    await Promise.allSettled(sendPromises);

    return new Response(JSON.stringify({ success: true, attempted: subs.length }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});