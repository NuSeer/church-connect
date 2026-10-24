// Supabase Edge Function: database webhooks -> phone notifications (messages, broadcasts, approval alerts for administrators, and "you are approved" for new members).
// Configure VERIFY_JWT=false for this webhook endpoint; authenticate with x-cc-webhook-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const secret = Deno.env.get("CC_PUSH_WEBHOOK_SECRET")!;
webpush.setVapidDetails(
  "mailto:" + Deno.env.get("CC_VAPID_CONTACT_EMAIL")!,
  Deno.env.get("CC_VAPID_PUBLIC_KEY")!,
  Deno.env.get("CC_VAPID_PRIVATE_KEY")!,
);
const db = createClient(url, key, { auth: { persistSession: false } });
async function deliver(subs: any[], payload: string) {
  const message = JSON.parse(payload);
  const ids = [...new Set(subs.map((s) => s.user_id).filter(Boolean))];
  const { data: settings, error: settingsError } = ids.length
    ? await db.from("cc_messaging_settings").select("*").in("user_id", ids)
    : { data: [], error: null };
  if (settingsError) throw settingsError;
  const { data: prefs, error: prefsError } = message.conversationId
    ? await db
        .from("cc_chat_preferences")
        .select("user_id,muted")
        .eq("conversation_id", message.conversationId)
    : { data: [], error: null };
  if (prefsError) throw prefsError;
  const eligible = subs.filter((s) => {
    if ((prefs || []).some((p: any) => p.user_id === s.user_id && p.muted))
      return false;
    const pref = (settings || []).find((p: any) => p.user_id === s.user_id);
    if (
      pref?.quiet_start == null ||
      pref?.quiet_end == null ||
      pref.quiet_start === pref.quiet_end
    )
      return true;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: pref.timezone,
      }).format(new Date()),
    );
    return !(pref.quiet_start < pref.quiet_end
      ? hour >= pref.quiet_start && hour < pref.quiet_end
      : hour >= pref.quiet_start || hour < pref.quiet_end);
  });
  const results = await Promise.allSettled(
    eligible.map(async (s: any) => {
      const { data: claimed, error: claimError } = await db.rpc(
        "cc_claim_push",
        { p_message: message.messageId, p_subscription: s.id },
      );
      if (claimError) throw claimError;
      if (!claimed) return "duplicate";
      const state = (status: string) =>
        db
          .from("cc_push_attempts")
          .update({ status, attempted_at: new Date().toISOString() })
          .eq("message_id", message.messageId)
          .eq("subscription_id", s.id);
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 86400 },
        );
        const r = await state("accepted");
        if (r.error) throw r.error;
        return "accepted";
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.from("member_push_subscriptions").delete().eq("id", s.id);
          await state("expired");
          return "expired";
        }
        await state("pending");
        throw err;
      }
    }),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  return Response.json(
    {
      attempted: eligible.length,
      accepted: results.filter(
        (r) => r.status === "fulfilled" && r.value === "accepted",
      ).length,
      failed,
    },
    { status: failed ? 503 : 200 },
  );
}
// Church-wide broadcast: a member_updates row with no ministry goes to every approved member of that church. The title (not private) is shown.
async function broadcast(m: any) {
  if (!m?.id || !m?.church_id || m.ministry_id)
    return new Response("Ignored", { status: 200 });
  const { data: people, error: pe } = await db
    .from("member_profiles")
    .select("user_id")
    .eq("church_id", m.church_id)
    .eq("approved", true);
  if (pe) throw pe;
  const ids = (people || [])
    .map((x: any) => x.user_id)
    .filter((id: string) => id !== m.created_by);
  if (!ids.length) return new Response("No recipients", { status: 200 });
  const subs: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("member_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", ids.slice(i, i + 200));
    if (error) throw error;
    subs.push(...(data || []));
  }
  return await deliver(
    subs,
    JSON.stringify({
      title: "Church announcement",
      body: String(m.title || "New message from your church").slice(0, 100),
      view: "updates",
      messageId: m.id,
    }),
  );
}
// Stable id for events that have no single uuid (used so webhook retries do not notify twice).
async function idFor(text: string) {
  const h = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  ).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
// Tell a church's administrators and pastors (everyone in church_admins) that someone is waiting for approval.
async function approvalAlert(
  title: string,
  body: string,
  churchId: string | null,
  key: string,
) {
  if (!churchId) return new Response("Ignored", { status: 200 });
  const id = await idFor(key);
  const { data: admins, error: ae } = await db
    .from("church_admins")
    .select("user_id")
    .eq("church_id", churchId);
  if (ae) throw ae;
  const ids = (admins || []).map((x: any) => x.user_id);
  if (!ids.length) return new Response("No administrators", { status: 200 });
  const { data: subs, error: se } = await db
    .from("member_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", ids);
  if (se) throw se;
  return await deliver(
    subs || [],
    JSON.stringify({
      title,
      body: body.slice(0, 120),
      page: "membership",
      messageId: id,
    }),
  );
}
// Tell a member (only that member) that an administrator approved them. Needs a webhook on member_profiles for UPDATE.
async function approvedNotice(m: any, old: any) {
  if (!m?.user_id || m.approved !== true || old?.approved !== false)
    return new Response("Ignored", { status: 200 });
  const id = await idFor("approved:" + m.user_id);
  const { data: church } = m.church_id
    ? await db
        .from("churches")
        .select("name")
        .eq("id", m.church_id)
        .maybeSingle()
    : { data: null };
  const { data: subs, error: se } = await db
    .from("member_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("user_id", m.user_id);
  if (se) throw se;
  return await deliver(
    subs || [],
    JSON.stringify({
      title: "You are approved!",
      body: `Welcome to ${String(church?.name || "your church").slice(0, 80)}. Tap to open Church Connect.`,
      view: "updates",
      messageId: id,
    }),
  );
}
async function joinRequestAlert(m: any) {
  if (!m?.user_id || !m?.ministry_id || m.status !== "pending")
    return new Response("Ignored", { status: 200 });
  const { data: ministry, error: me } = await db
    .from("ministries")
    .select("name,church_id")
    .eq("id", m.ministry_id)
    .single();
  if (me || !ministry) throw me || Error("Ministry missing");
  const { data: person } = await db
    .from("member_profiles")
    .select("display_name")
    .eq("user_id", m.user_id)
    .maybeSingle();
  return await approvalAlert(
    "Ministry request",
    `${String(person?.display_name || "A member").slice(0, 60)} asked to join ${String(ministry.name).slice(0, 60)}.`,
    ministry.church_id,
    `join:${m.user_id}:${m.ministry_id}`,
  );
}
// Tell the church's webmasters (members with the Webmaster permission, or the administrators if nobody has it) that a request is waiting.
async function webmasterAlert(m: any) {
  if (!m?.id || !m?.church_id || m.status !== "open")
    return new Response("Ignored", { status: 200 });
  const id = await idFor("webmaster:" + m.id);
  const { data: wm, error: we } = await db
    .from("cc_staff_delegations")
    .select("user_id")
    .eq("church_id", m.church_id)
    .eq("permission", "website_manage");
  if (we) throw we;
  let ids = (wm || []).map((x: any) => x.user_id);
  if (!ids.length) {
    const { data: admins, error: ae } = await db
      .from("church_admins")
      .select("user_id")
      .eq("church_id", m.church_id);
    if (ae) throw ae;
    ids = (admins || []).map((x: any) => x.user_id);
  }
  if (!ids.length) return new Response("No webmaster", { status: 200 });
  const { data: subs, error: se } = await db
    .from("member_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", ids);
  if (se) throw se;
  const what: Record<string, string> = {
    event: "New event to list",
    event_change: "Event change",
    photo: "Photo to upload",
    other: "Website request",
  };
  return await deliver(
    subs || [],
    JSON.stringify({
      title: "Message for the webmaster",
      body:
        (what[m.kind] || "Website request") +
        (m.message ? ": " + String(m.message).slice(0, 90) : ""),
      page: "admin-center",
      messageId: id,
    }),
  );
}
// Tell a member (only that member) how their ministry request was answered. Needs a webhook on ministry_join_requests for UPDATE.
async function joinDecisionNotice(m: any, old: any) {
  if (
    !m?.user_id ||
    !m?.ministry_id ||
    old?.status !== "pending" ||
    !["approved", "rejected"].includes(m.status)
  )
    return new Response("Ignored", { status: 200 });
  const id = await idFor(
    "joindecision:" +
      m.user_id +
      ":" +
      m.ministry_id +
      ":" +
      m.status +
      ":" +
      String(m.requested_at || ""),
  );
  const { data: ministry } = await db
    .from("ministries")
    .select("name")
    .eq("id", m.ministry_id)
    .maybeSingle();
  const name = String(ministry?.name || "the ministry").slice(0, 60);
  const { data: subs, error: se } = await db
    .from("member_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("user_id", m.user_id);
  if (se) throw se;
  const approved = m.status === "approved";
  return await deliver(
    subs || [],
    JSON.stringify({
      title: approved ? "Ministry request approved" : "Ministry request update",
      body: approved
        ? "You are now part of " + name + "."
        : "Your request to join " +
          name +
          " was not approved this time. You can ask again from My Profile.",
      view: "profile",
      messageId: id,
    }),
  );
}
Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (!secret || request.headers.get("x-cc-webhook-secret") !== secret)
    return new Response("Unauthorized", { status: 401 });
  try {
    const event = await request.json();
    const m = event.record;
    if (event.type === "INSERT" && event.table === "member_updates")
      return await broadcast(m);
    if (event.type === "INSERT" && event.table === "member_profiles")
      return m?.approved === true
        ? new Response("Ignored", { status: 200 })
        : await approvalAlert(
            "New member waiting for approval",
            `${String(m?.display_name || "Someone").slice(0, 60)} asked to join. Tap to review.`,
            m?.church_id ?? null,
            "profile:" + m?.user_id,
          );
    if (event.type === "UPDATE" && event.table === "member_profiles")
      return await approvedNotice(m, event.old_record);
    if (event.type === "INSERT" && event.table === "ministry_join_requests")
      return await joinRequestAlert(m);
    if (event.type === "UPDATE" && event.table === "ministry_join_requests")
      return await joinDecisionNotice(m, event.old_record);
    if (event.type === "INSERT" && event.table === "cc_webmaster_requests")
      return await webmasterAlert(m);
    if (
      event.type !== "INSERT" ||
      event.table !== "messages" ||
      !m?.id ||
      !m?.conversation_id ||
      !m?.sender_id
    )
      return new Response("Ignored", { status: 200 });
    // Webhook retries must not notify twice: claim the message id first and stop if another delivery already did.
    const { data: conversation, error: ce } = await db
      .from("conversations")
      .select("id,kind,ministry_id")
      .eq("id", m.conversation_id)
      .single();
    if (ce || !conversation) throw ce || Error("Conversation missing");
    const { data: allowed, error: ae } = await db.rpc("cc_push_recipient_ids", {
      p_conversation: m.conversation_id,
    });
    if (ae) throw ae;
    const recipients = (allowed || [])
      .map((x: any) => x.user_id)
      .filter((id: string) => id !== m.sender_id);
    if (!recipients.length)
      return new Response("No approved recipients", { status: 200 });
    const { data: subs, error: se } = await db
      .from("member_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", recipients);
    if (se) throw se;
    const payload = JSON.stringify({
      title:
        conversation.kind === "ministry"
          ? "New ministry message"
          : "New private message",
      body: "You have a new message in Church Connect.",
      conversationId: m.conversation_id,
      messageId: m.id,
    });
    return await deliver(subs || [], payload);
  } catch (err) {
    console.error(err);
    return new Response("Push dispatch error", { status: 500 });
  }
});
