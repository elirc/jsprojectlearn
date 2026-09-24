# Calling other people's APIs: SDKs, webhooks and payments

Every product integrates something: Stripe, an email provider, a CRM, a
shipping API. The mistakes are predictable (no timeout, retrying a payment,
trusting a price the browser sent, accepting an unsigned webhook) and
interviewers test for exactly those. "How do you make sure a customer is not
charged twice?" is a mid-level question at any company that takes money.

## Put the provider behind your own interface

Use the official SDK when there is a good one; it handles auth, pagination and
signature checks. Either way, **wrap it behind an interface named in your
terms**:

```csharp
public interface IPaymentGateway
{
    Task<CheckoutSession> StartCheckoutAsync(Order order, CancellationToken ct);
}
```

Your code depends on `IPaymentGateway`, not on the vendor's types. Tests use a
fake. Switching provider, or running two during a migration, is one new
class. And the vendor's odd naming stays in one file.

## Timeouts, always

A call with no timeout is a request that can hang for minutes while holding a
thread, a connection and the user's patience. The defaults are worse than
people expect: .NET's `HttpClient` waits 100 seconds; Node's `fetch` (undici
underneath) has no overall deadline, and its per-phase defaults allow minutes
of silence.

```js
// Node: a hard deadline on every outbound call
const res = await fetch(`${BASE}/v1/customers/${id}`, {
  headers: { Authorization: `Bearer ${process.env.CRM_KEY}` },
  signal: AbortSignal.timeout(5_000),
});
```

In .NET, **never `new HttpClient()` per request**. Each instance owns its own
connection pool, and disposed ones leave sockets in `TIME_WAIT`, so under load
you run out of ports (socket exhaustion). One static client for ever has the
opposite bug: it never notices DNS changes. `IHttpClientFactory` solves both by
pooling and recycling the handlers underneath:

```csharp
builder.Services.AddHttpClient<CrmClient>(c => c.BaseAddress = new("https://api.crm.example/"))
    .AddStandardResilienceHandler(o =>
    {
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(5);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(15);
        o.Retry.DisableForUnsafeHttpMethods();   // never blindly retry a POST
    });
```

`CrmClient` is a **typed client**: a class that takes an `HttpClient` in its
constructor and exposes methods like `GetCustomerAsync`. In Node, `fetch`
already shares a global connection pool; create one undici `Agent` only when a
provider needs different pool or timeout settings.

## Retries, and why they need idempotency

`AddStandardResilienceHandler` (from `Microsoft.Extensions.Http.Resilience`,
built on Polly) gives you the standard stack in one line: a total timeout,
retries with exponential backoff and **jitter**, a circuit breaker, and a
per-attempt timeout. The rules behind it apply in any language:

- **Retry only what is safe to repeat.** GET, PUT and DELETE are idempotent;
  a POST is not, unless the provider accepts an **idempotency key**.
- **Back off with jitter.** 1 s, 2 s, 4 s, each randomised, so a thousand
  clients do not retry in lockstep.
- **Honour `Retry-After`** on 429 and 503. The provider is telling you when.
- **Stop hammering a dead dependency.** A circuit breaker fails fast for a
  while after repeated errors, instead of queueing every request behind a
  timeout.

The idempotency key is what makes a POST retry safe:

```js
// Generate once per logical operation, store it, reuse it on every retry
const key = order.paymentAttemptId;
await stripe.paymentIntents.create(
  { amount: order.totalCents, currency: 'gbp', metadata: { orderId: order.id } },
  { idempotencyKey: key },
);
```

A timeout tells you nothing about whether the charge happened. With the same
key, the retry returns the original result instead of charging twice. A fresh
key on each retry defeats the whole point.

## Webhooks: verify, de-duplicate, queue

A webhook is the provider calling you. Anyone on the internet can POST to that
URL, so the handler has four jobs:

1. **Verify the signature** over the **raw body**. The provider signs the exact
   bytes it sent; parse and re-serialise the JSON and the signature no longer
   matches.
2. **Reject old timestamps.** The signed payload includes a timestamp; refuse
   anything outside a replay window (Stripe's default is five minutes), so a
   captured request cannot be replayed next week.
3. **De-duplicate by event id.** Delivery is at least once. Store processed
   ids with a unique constraint and ignore repeats.
4. **Return 2xx quickly and queue the work.** Providers time out in seconds and
   retry; slow handlers cause duplicate deliveries.

```js
app.post('/webhooks/payments', express.raw({ type: 'application/json' }), async (req, res) => {
  const { t, v1 } = parseSignatureHeader(req.get('Payment-Signature'));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.sendStatus(400);

  const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(`${t}.`).update(req.body)         // req.body is a Buffer: the raw bytes
    .digest();
  const given = Buffer.from(v1 ?? '', 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.sendStatus(400);
  }

  const event = JSON.parse(req.body);
  await jobs.enqueueOnce(event.id, 'payment-event', event);   // unique on event.id
  res.sendStatus(200);
});
```

In .NET the same check is `HMACSHA256.HashData(key, bytes)` compared with
`CryptographicOperations.FixedTimeEquals`, after reading `Request.Body` into a
buffer yourself instead of model-binding it. Use the SDK's verifier when there
is one (`stripe.webhooks.constructEvent`, `EventUtility.ConstructEvent`); the
point of the code above is that you know what it does. The constant-time
comparison matters: `===` on strings leaks, through timing, how many
characters matched.

## Payments: never trust a client-sent amount

The browser is not part of your system. Anything it sends can be edited in dev
tools, including `"amount": 1`.

- **The server calculates the price** from product ids and quantities it looks
  up itself. The client sends *what* it wants, never *how much* it costs.
- **Prefer hosted checkout** (Stripe Checkout, Payment Links, the provider's
  hosted fields). Card numbers never touch your servers, which keeps you in the
  smallest PCI DSS scope. Your own card form means your own PCI problem.
- **The webhook is the source of truth.** The redirect back to your "thank
  you" page can be skipped, closed or forged. Mark the order paid when the
  signed `payment_intent.succeeded` (or equivalent) event arrives, and check
  that its amount and currency match the order.
- **Idempotency keys on every create call**, as above.

> "The client sends the basket, the server prices it, the provider takes the
> card, and the order is only paid when a verified webhook says so. Every
> create call carries an idempotency key, so a retry cannot charge twice."

## Sandbox keys, live keys and feature flags

Every serious provider has **test mode**: separate keys (Stripe's `sk_test_…`
and `sk_live_…`), separate data, and test card numbers. Rules that prevent the
worst day of your career:

- **Live keys exist only in production's secret store.** Development, CI and
  staging use sandbox keys, so a bug in a test cannot move real money.
- **Webhook secrets are per endpoint and per environment**, too.
- **Use restricted keys** with only the permissions the integration needs.
- **Record fixtures from the sandbox** for tests, and re-record them
  occasionally, because providers change their responses (contract drift).

**Feature-flag the integration.** Put a new provider, or a new version of the
call, behind a flag (`Microsoft.FeatureManagement` in .NET, a config value or a
flag service in Node). You can ship the code dark, turn it on for internal
users first, and switch it off in seconds without a deploy when the provider
has an outage. A flag with a fallback ("queue the email and send later") turns
their incident into a delay rather than your outage.

## Email, in one section

If your app sends email, deliverability is part of the integration. Set up
**SPF** (which servers may send for your domain), **DKIM** (a signature on each
message) and **DMARC** (what receivers should do when those fail). Since 2024,
Gmail and Yahoo require all three for bulk senders, plus one-click unsubscribe
and a low spam-complaint rate; without them your password-reset emails land in
spam.

## The integration checklist

- [ ] Behind your own interface, with a fake for tests
- [ ] A timeout on every call; `IHttpClientFactory` in .NET, `AbortSignal.timeout` in Node
- [ ] Retries only on idempotent calls or with an idempotency key; backoff with jitter; `Retry-After` honoured
- [ ] Webhooks: raw-body HMAC, constant-time compare, replay window, de-duplicated by event id, 2xx fast
- [ ] Prices computed server-side; payment confirmed by webhook, not redirect
- [ ] Sandbox keys everywhere except production; secrets in a secret store
- [ ] A feature flag and a fallback for when the provider is down
- [ ] Outbound calls logged with duration and status, and alerted on

## What you should be able to answer

- How do you make sure a customer is not charged twice?
- How do you verify that a webhook really came from Stripe?
- Why must the signature be checked against the raw body?
- Your provider times out: what does your API return, and what happens next?
- Why is `new HttpClient()` per request a problem, and what fixes it?
- Which calls is it safe to retry automatically?
- Why is the webhook, not the redirect, the source of truth for a payment?
- How do you switch off a failing integration without a deploy?
