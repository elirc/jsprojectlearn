# Environments, configuration and secrets

The gap between "it runs on my laptop" and "it runs in production" is mostly
configuration. This is a short guide because the rules are short — but getting
them wrong causes a disproportionate share of real incidents.

## The principle

**Build once, deploy everywhere.** The artefact — the container image, the
compiled bundle — is identical in staging and production. Only the configuration
injected at deploy time differs.

If you rebuild per environment, the thing you tested is not the thing you
shipped, and "it worked in staging" stops meaning anything.

## Config comes from the environment

```
DATABASE_URL=postgres://...
REDIS_URL=redis://...
JWT_SECRET=...
LOG_LEVEL=info
FEATURE_NEW_CHECKOUT=true
```

Environment variables are the lowest common denominator: containers, CI systems,
platform-as-a-service and orchestrators all speak them.

**In ASP.NET Core**, config comes from a chain of providers, later overriding
earlier:

```
appsettings.json
  -> appsettings.{Environment}.json
    -> user secrets (development only)
      -> environment variables
        -> command-line arguments
```

Nested keys use a double underscore: `ConnectionStrings__Default`. Bind sections
to typed options classes rather than reading strings everywhere:

```csharp
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
```

`IOptions<T>` is a singleton, bound lazily on first use and never reloaded;
`IOptionsSnapshot<T>` re-reads per
request; `IOptionsMonitor<T>` notifies on change. If a config change must take
effect without a restart, `IOptions` will not do it.

## Validate at startup, crash loudly

```js
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
};
```

Discovering a missing variable during the deploy — when the health check never
goes green and the rollout halts — is enormously better than discovering it at
3am on the first request that happens to need it.

.NET has `ValidateOnStart()` for the same purpose.

## Secrets

**Never in the repository.** Git history is permanent; deleting a committed
secret does not remove it from every clone and every fork. If one leaks, the
only real remediation is **rotation**.

Where they should live:

| Environment | Where |
|-------------|-------|
| Local development | .NET user secrets, or an uncommitted `.env` |
| CI | The CI system's encrypted secret store |
| Production | A secret manager — Key Vault, Secrets Manager, Doppler — or platform-injected env vars |

Commit a `.env.example` with the *keys* and dummy values so a new developer
knows what to fill in:

```
DATABASE_URL=postgres://localhost:5432/devpath
JWT_SECRET=change-me
STRIPE_KEY=sk_test_xxx
```

And add a secret scanner to CI. It catches the accidental commit before it
merges, which is the only time it is cheap to fix.

## Frontend "secrets" are not secrets

Anything reaching a browser bundle is public. Vite requires the `VITE_` prefix
specifically to make that opt-in visible:

```
VITE_API_URL=https://api.example.com     # fine — public
VITE_STRIPE_SECRET=sk_live_...           # a published secret
```

Publishable keys (Stripe publishable, a Google Maps key with domain
restrictions) are designed for this. Anything named "secret" or "private" is
not.

Remember these are **inlined at build time**, so a built SPA cannot be
reconfigured by an environment variable at deploy without extra machinery — a
runtime `config.json` the app fetches, or placeholder substitution at container
start.

## The environments

**Local** — your machine. Should be startable with one command
(`docker compose up`), with seeded data, and no dependency on shared
infrastructure.

**CI** — ephemeral, built from scratch, containerised dependencies.

**Staging** — as close to production as you can afford: same infrastructure
shape, same configuration mechanism, **anonymised or synthetic data**. Real
customer data in staging is a breach waiting for a wider access list.

**Production** — the only one that matters.

Staging that differs structurally from production gives false confidence. The
common gaps that catch people: one instance instead of three (hiding
concurrency bugs), a tiny dataset (hiding query problems), and no TLS (hiding
cookie and CORS issues).

## Feature flags

```js
if (flags.newCheckout) { ... }
```

Flags separate **deploy** from **release**: code ships dark and is turned on
independently, per environment, per user segment, or gradually.

That is what makes trunk-based development work — you merge small increments of
an unfinished feature without exposing it.

The cost is **flag debt**. Every flag is a branch in the code and a combination
to test. Give each one an owner and a removal date, and actually remove them.

## Configuration that is not configuration

Not everything belongs in config. A useful test: **does this legitimately differ
between environments?**

- Database URL — yes.
- Log level — yes.
- The VAT rate — no, that is business data. It belongs in the database, where it
  can have an effective date and an audit trail.
- Retry counts and timeouts — usually yes, and you will want to tune them
  without a deploy.

## The checklist

- [ ] One build artefact promoted across environments
- [ ] All config from environment variables or a config provider
- [ ] Required config validated at startup, with a clear crash message
- [ ] Secrets from a manager, never in the repo
- [ ] `.env.example` committed, `.env` ignored
- [ ] Secret scanning in CI
- [ ] Nothing sensitive in a frontend bundle
- [ ] Staging shaped like production, with non-real data
- [ ] Feature flags have owners and removal dates
