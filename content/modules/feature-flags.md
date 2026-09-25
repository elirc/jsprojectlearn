# Feature flags in practice

Feature flags let you merge unfinished work, release to 5% of users, and switch
off a broken feature in seconds without a deploy. They are also a common source
of dead code, untested combinations and "why is this user seeing the old
checkout?" bugs. Interviewers ask about flags alongside trunk-based development,
safe releases and incident mitigation, and they want to hear both the benefits
and the discipline.

[env-config-secrets](env-config-secrets.md) introduces flags as configuration;
this guide covers how to design, evaluate, roll out and retire them.

## Deploy is not release

Without flags, deploying code and exposing it to users are the same event, so
every deploy is a release with all its risk. Flags separate them:

- **Deploy:** new code reaches production, switched off.
- **Release:** you turn it on for staff, then 1%, 10%, 50%, everyone,
  watching metrics at each step.
- **Rollback of a feature:** flip the flag off, in seconds, without a deploy.

This is what makes trunk-based development workable: half-built features merge
to `main` daily behind a flag instead of living on a branch for weeks (see
[branching-and-release-flows](branching-and-release-flows.md)).

## Kinds of flag

| Kind | Purpose | Lifetime | Example |
| --- | --- | --- | --- |
| Release | hide unfinished or rolling-out work | days to weeks | `new-checkout` |
| Experiment | A/B test variants and measure outcomes | weeks | `pricing-page-variant` |
| Ops / kill switch | turn off an expensive or risky path under load | long-lived | `disable-recommendations` |
| Permission / entitlement | features for certain plans or customers | long-lived | `advanced-reports` for Pro |

Release flags must be short-lived; kill switches and entitlements are
permanent configuration. Treating them the same is how codebases end up with
hundreds of stale flags.

## How evaluation works

A flag evaluation takes a flag definition and a **context** (who is asking)
and returns a value:

```txt
flag "new-checkout":
  enabled: true
  rules:
    - if user.email ends with "@acme.com" -> on       (staff first)
    - if tenant.id in [42, 77]            -> on       (beta customers)
    - percentage rollout: 10% on, keyed by user.id
  default: off
```

Percentage rollouts must be **sticky**: the same user must get the same answer
on every request, or they will flip between old and new UI. Implementations
hash the flag key and a stable id into a bucket:

```js
import { createHash } from "node:crypto";

function bucket(flagKey, userId) {
  const hash = createHash("sha256").update(`${flagKey}:${userId}`).digest();
  return hash.readUInt32BE(0) % 100;          // 0..99, stable per user and flag
}

export function isEnabled(flag, user) {
  if (!flag.enabled) return false;
  if (flag.allowUsers?.includes(user.id)) return true;
  return bucket(flag.key, user.id) < flag.rolloutPercent;
}
```

Including the flag key in the hash means the same 10% of users are not the
guinea pigs for every rollout. Raising the percentage from 10 to 20 keeps the
original 10% enabled, because their buckets are still below the threshold.

Choose the key deliberately: `user.id` for per-user features, `tenant.id` when
everyone in a company should see the same thing (a B2B admin screen that
differs between colleagues generates support tickets).

## Where flags live

| Approach | Good for | Limits |
| --- | --- | --- |
| Environment variable or config file | a handful of per-environment switches | needs a redeploy or restart to change |
| Database table plus a small evaluator | teams that want control and no vendor | you build targeting, audit and UI |
| Managed service (LaunchDarkly, Unleash, Flagsmith, ConfigCat, Azure App Configuration) | targeting, audit log, instant updates | cost, and a dependency in your hot path |

Whichever you use, put an abstraction in front of it. **OpenFeature** is the
vendor-neutral standard API with SDKs for Node and .NET, so application code
calls `client.getBooleanValue("new-checkout", false, context)` and the provider
behind it can change. In .NET, `Microsoft.FeatureManagement` integrates with
configuration and ASP.NET Core:

```csharp
if (await featureManager.IsEnabledAsync("NewCheckout"))
{
    return await newCheckout.PlaceOrderAsync(cart);
}
return await legacyCheckout.PlaceOrderAsync(cart);
```

SDKs evaluate locally from a cached rule set that is streamed or polled, so a
flag check costs microseconds, not a network call. Decide what happens when the
flag service is unreachable: the **default value in code** is what users get,
so make it the safe option (usually "off" for new features).

## Server-side versus client-side flags

Flags evaluated in the browser are visible to anyone: the rules or the list of
enabled features ship to the client. That is fine for UI toggles, but never use
a client-side flag as access control. If a feature is for Pro customers, the API
must enforce the entitlement; the flag in the UI only hides the button.

For SPAs, evaluate on the server where possible and send the resulting values
with the initial payload, which also avoids a flash of the old UI while a
client SDK loads.

## Writing flag-friendly code

- **Branch high, not deep.** Check the flag once at the edge (the route, the
  component, the DI registration) and select a whole implementation, rather
  than scattering `if (flag)` through ten functions.
- **Keep both paths working and tested.** Tests should run with the flag on and
  off; the "off" path is what you fall back to in an incident.
- **Log and trace the variant.** Add the flag values to logs and span
  attributes so you can compare error rates and latency between variants.
- **Annotate changes.** Flag flips should appear on dashboards like deploys; a
  flag change is a production change.

## Flags and data

Flags can hide code, but they cannot un-migrate a database. A feature that
needs a new column still follows expand-and-contract: add the column (nullable
or with a default), deploy code that writes both shapes, backfill, switch reads
behind the flag, and remove the old column only after the flag is gone. If the
flagged path writes data the old path cannot read, turning the flag off is no
longer a safe rollback. Design for that before the rollout, not during an
incident.

## Rolling out safely

A typical progressive rollout:

1. Enable for the team and internal accounts; test in production.
2. Enable for 1% or a few friendly customers; compare error rate, latency and
   business metrics against the control group.
3. Step up (5%, 25%, 50%, 100%) with a pause at each stage long enough to see
   problems, and a written rollback criterion ("error rate above 1%").
4. At 100%, leave it a short while, then schedule removal.

If something goes wrong, the flag is the first mitigation (see
[incident-response](incident-response.md)): turn it off, confirm the metric
recovers, then investigate.

## Flag debt

Every flag doubles the number of paths through the code it touches. Ten
independent flags are over a thousand combinations nobody has tested. Keep
debt under control:

- Give each release flag an **owner and an expiry date** when it is created.
- Add removal of the flag to the feature's definition of done.
- Alert or fail CI when a flag passes its expiry, or review stale flags
  monthly; most managed services report flags not evaluated recently.
- When removing, delete the losing code path and its tests, not just the check.

A famous cautionary tale: in 2012 Knight Capital repurposed an old flag, a
deploy missed one server that still had the retired code, and the reactivated
path lost about 440 million dollars in 45 minutes. Stale flags and dead code
are not harmless.

## What you should be able to answer

- What does it mean to separate deploy from release, and why does it reduce
  risk?
- How does a percentage rollout keep each user on the same variant?
- Why must a client-side flag never be used for authorisation?
- What should happen if the flag service is down?
- How do flags interact with database migrations and rollbacks?
- What is flag debt, and what process keeps it under control?
