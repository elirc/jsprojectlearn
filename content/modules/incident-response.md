# Incident response and debugging production

"Tell me about a time production broke" is one of the most common behavioural
questions, and "the error rate just tripled, what do you do?" is one of the most
common scenario questions. Both reward the same thing: a calm, repeatable
process that restores service first, uses logs, metrics and traces to narrow
the problem quickly, and ends with changes that stop the whole class of
failure. This guide is that process.

It builds on [logging-and-observability](logging-and-observability.md), which
covers producing the signals, and [debugging-playbook](debugging-playbook.md),
which covers bugs in general.

## The shape of an incident

```txt
detect ──► triage ──► mitigate ──► resolve ──► learn
   │          │           │            │          │
 alert,    how bad,    stop the     fix the    postmortem,
 report    who leads   bleeding     cause      action items
```

The most important rule is the order: **mitigate before you diagnose**. Users
care that checkout works again, not why it broke. Root cause can wait until
the damage has stopped, and it is far easier to find without adrenaline.

## Severity and roles

Agree severity levels in advance so nobody debates them mid-incident:

| Severity | Example | Response |
| --- | --- | --- |
| SEV1 | checkout or login down for most users, data loss | page now, incident lead, status page |
| SEV2 | a major feature degraded, or one region or tenant down | page in hours, lead assigned |
| SEV3 | minor degradation with a workaround | ticket, fix in normal work |

For anything above SEV3, assign roles explicitly, even if one person holds
several:

- **Incident lead (commander):** coordinates, decides, keeps a single thread of
  action. Does not debug.
- **Operations:** investigates and applies changes, announcing each one before
  doing it.
- **Communications:** updates stakeholders and the status page on a fixed
  cadence.
- **Scribe:** keeps a timestamped log of observations and actions.

Without a lead, three engineers change three things at once and nobody can tell
which one helped or hurt.

## Triage: how bad, since when, what changed

In the first five minutes, answer three questions from dashboards rather than
guesses:

1. **Impact.** Which users, which features, what error rate or latency? One
   tenant, one region or everyone?
2. **Start time.** When did the graphs bend? Be precise to the minute.
3. **What changed near then?** Deploys, feature-flag changes, config changes,
   infrastructure changes, traffic spikes, a dependency's status page, a
   scheduled job, a certificate expiry.

Most incidents are caused by a change. A deploy that finished two minutes
before the error spike is the prime suspect until proven otherwise, which is
why every deploy and flag change should be annotated on your dashboards.

## Mitigation options

Pick the fastest safe action that reduces impact:

| Action | When it fits | Watch out for |
| --- | --- | --- |
| Roll back the deploy | the incident started with a release | irreversible migrations; roll forward instead |
| Turn off a feature flag | the new feature is the culprit | flags that also gate data migrations |
| Scale out | saturation: CPU, pool or queue backlog | a database that cannot take more connections |
| Fail over | a zone, region or primary database is down | replica lag and split-brain writes |
| Shed or rate-limit load | a traffic spike or abusive client | blocking legitimate users |
| Disable a non-critical dependency | a slow third party is cascading | keep a degraded but working UX |
| Restart | a leak or stuck state, as a stopgap | it destroys the evidence; take a dump first if you can |

After each action, check whether the metric moved. If it did not, undo it or
move on; do not stack changes blindly.

## Debugging with the three signals

When mitigation is not obvious, narrow down using signals in a deliberate order.

**Metrics tell you what and where.** Start with the golden signals for each
service: request rate, error rate, latency percentiles and saturation (CPU,
memory, connection pools, queue depth). Then **slice** by dimension: endpoint,
status code, instance, availability zone, customer tier, app version. The
question is always "what is different about the failing requests?"

- Errors only on one instance: a bad host or node, not the code.
- Errors only on one endpoint: that code path or its dependency.
- Errors only on the new version: the deploy.
- Latency up everywhere with saturation of one pool: a shared bottleneck.

**Traces tell you where the time goes.** Pick a slow or failed trace for the
affected endpoint and read its spans: which downstream call is slow or
erroring, whether calls that could run in parallel are serial, whether a
database span dominates. Remember that with head-based sampling the exact
failing request may not have a trace; filter by error status and duration
anyway.

**Logs tell you why.** With the trace id or correlation id from a failing
request, pull every log line for it across services:

```txt
service:orders-api AND level:error AND trace_id:4bf92f3577b34da6
```

Then look at the error's message, stack trace and context (tenant, entity ids,
input shape). Structured logs let you aggregate: count errors by
`exception.type` and `route` for the last hour and the top entry is usually your
culprit.

| Signal | Best at | Weak at |
| --- | --- | --- |
| Metrics | "is something wrong, where, since when?" | explaining one request |
| Traces | "where did this request spend its time?" | rare events when sampled |
| Logs | "what exactly happened and why?" | aggregate trends, cost at volume |

## Common production failure patterns

Recognising the shape saves time:

- **Saturation cascade:** a dependency slows, requests hold connections or
  threads while waiting, pools exhaust, and unrelated endpoints fail. Look for a
  pool or thread-pool metric at its ceiling. Fix with timeouts, circuit
  breakers and bulkheads.
- **Retry storm:** a brief failure triggers retries at every layer, multiplying
  load so the system cannot recover. Look for request rate rising while user
  traffic is flat.
- **Thundering herd:** a cache expires or a service restarts, and everything
  hits the database at once.
- **Resource exhaustion:** disk full, file descriptors, memory limit (OOMKilled),
  database connections, certificate expiry. Often gradual, then sudden.
- **Bad data:** one customer's unusual record breaks a code path. Errors cluster
  on one tenant or entity id.

[memory-leaks-and-performance](memory-leaks-and-performance.md) covers the
memory and CPU side in depth.

## Communicating during an incident

Stakeholders need three things: that you know, what is affected, and when they
will hear more. A short update beats a detailed one:

```txt
14:32 UTC — Investigating: some customers cannot complete checkout
(about 30% of attempts are failing). Orders already placed are unaffected.
We rolled back this afternoon's release and are monitoring.
Next update by 15:00 UTC.
```

Always give the time of the next update, and keep to it even if nothing has
changed. Do not speculate about cause or promise a fix time.

## After the incident: the postmortem

Write it within a few days, blameless by design: people acted reasonably with
the information they had, so the question is how the system let the failure
happen and why it was not caught earlier.

A useful template:

- **Summary:** what happened, impact in numbers, duration.
- **Timeline:** detection, key observations, actions, resolution (from the
  scribe's log).
- **Root cause and contributing factors:** usually several, such as a bug plus a
  missing test plus an alert that fired too late.
- **What went well, what went badly, where we were lucky.**
- **Action items:** specific, owned, dated, and aimed at the class of problem
  (a guardrail, a test, an alert, a runbook), not "be more careful".

Track action items to completion; a postmortem whose actions are never done is
a record of the next incident.

## Being ready before it happens

- Alerts page only on user-facing symptoms and link to a **runbook** with
  checks and safe mitigations.
- Every service exposes its version, and deploys and flag changes are
  annotated on dashboards.
- Rollback is one command and is rehearsed.
- Dashboards exist per service with the golden signals, already sliced by
  instance and version.
- On-call is sustainable: a handover, a rota, and a review of noisy alerts.

## What you should be able to answer

- Error rates just tripled. Walk through your first ten minutes.
- Why mitigate before finding the root cause, and when is rolling forward
  better than rolling back?
- How do you use metrics, traces and logs together to find a failing
  dependency?
- What is an incident lead for, and why should they not be debugging?
- What goes into a good status update and a good postmortem?
- Describe a cascading failure and the patterns that contain it.
