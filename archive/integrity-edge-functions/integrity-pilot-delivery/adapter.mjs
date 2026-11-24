// Staging provider adapter. The server must persist the frozen intent before dispatch
// and supply live authorization and suppression decisions for every attempt.
const FROM = "Provision <updates@notify.codifiedresonance.com>";
const REPLY_TO = "drew@codifiedresonance.com";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const titles = Object.freeze({
  requested: "A reservation was requested",
  accepted: "Your reservation was accepted",
  declined: "Your reservation was declined",
  cancelled: "A reservation was cancelled",
  hold_expiring: "Your reservation hold is ending soon",
  expired: "Your reservation hold has expired",
  source_unfulfillable: "The Source cannot fulfil your reservation",
  collected: "Your reservation was marked collected",
  offer_withdrawn: "An offer linked to your reservation was withdrawn",
  safety_notice: "There is a safety update about your reservation",
});
const windowMs = 23 * 60 * 60 * 1000;
const normalize = s => typeof s === "string" ? s.trim().toLowerCase() : "";
const denied = error_code => ({outcome: "permanent_failure", error_code});
const retry = error_code => ({outcome: "retry", error_code});

export function freezeIntent({eventId, recipientId, recipient, kind, createdAt, portal, allowedOrigins}) {
  if (!uuid.test(eventId) || !uuid.test(recipientId) ||
      !Object.hasOwn(titles, kind) || !Number.isFinite(Date.parse(createdAt))) {
    throw Error("INVALID_DELIVERY_INTENT");
  }
  const to = normalize(recipient);
  if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(to) || to.endsWith(".invalid")) {
    throw Error("INVALID_PILOT_ADDRESS");
  }
  const url = new URL(portal);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !allowedOrigins.includes(url.origin)) throw Error("INVALID_PILOT_PORTAL");
  // No identifiers, tokens or business/claim details in the email body.
  const subject = titles[kind];
  const text = subject + ".\n\nOpen Provision to see the latest details:\n" + url.href;
  return Object.freeze({eventId, recipientId, createdAt, body: JSON.stringify({
    from: FROM, to: [to], reply_to: REPLY_TO, subject, text
  })});
}

export async function sendIntent(intent, {apiKey, allowedRecipients, readEligibility, fetchFn = fetch, now = Date.now()}) {
  if (!apiKey || !allowedRecipients?.size || typeof readEligibility !== "function") {
    return retry("DELIVERY_NOT_CONFIGURED");
  }
  const age = now - Date.parse(intent.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= windowMs) return denied("DELIVERY_WINDOW_CLOSED");
  if (!uuid.test(intent.eventId) || !uuid.test(intent.recipientId)) return denied("INVALID_DELIVERY_INTENT");
  let body;
  try { body = JSON.parse(intent.body); } catch { return denied("INVALID_DELIVERY_INTENT"); }
  const to = Array.isArray(body?.to) && body.to.length === 1 && normalize(body.to[0]);
  if (!to || to.endsWith(".invalid") || normalize(allowedRecipients.get(intent.recipientId)) !== to ||
      body.from !== FROM || body.reply_to !== REPLY_TO) return denied("RECIPIENT_NOT_APPROVED");
  let eligibility;
  try { eligibility = await readEligibility(intent.eventId, intent.recipientId); }
  catch { return retry("ELIGIBILITY_UNAVAILABLE"); }
  if (eligibility?.eligible !== true || eligibility?.suppressed !== false ||
      normalize(eligibility.email) !== to) return denied("RECIPIENT_INELIGIBLE");
  try {
    const response = await fetchFn("https://api.resend.com/emails", {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(5000),
      headers:{Authorization:"Bearer "+apiKey, "Content-Type":"application/json",
        "Idempotency-Key":"provision-staging/"+intent.eventId}, body:intent.body
    });
    const result = await response.json().catch(() => null);
    if (response.ok) {
      return typeof result?.id === "string" && uuid.test(result.id)
        ? {outcome:"accepted",provider_id:result.id}
        : retry("PROVIDER_RESPONSE_UNCERTAIN");
    }
    if (response.status === 409 && result?.name === "concurrent_idempotent_requests") {
      return retry("PROVIDER_REQUEST_IN_PROGRESS");
    }
    if (response.status === 409) return denied("PROVIDER_IDEMPOTENCY_CONFLICT");
    if (response.status === 429 || response.status >= 500) return retry("PROVIDER_TEMPORARY_FAILURE");
    return denied("PROVIDER_REJECTED");
  } catch {
    return retry("PROVIDER_RESPONSE_UNCERTAIN");
  }
}
