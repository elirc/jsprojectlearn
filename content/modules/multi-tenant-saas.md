# Designing a multi-tenant SaaS application

Most B2B products serve many customer organisations from one deployment: every company sees its own projects, users and invoices, and none of anyone else's. "How would you make this multi-tenant?" is a favourite follow-up in design rounds, because a single missing `WHERE tenant_id = ...` is a data breach. This guide covers the isolation models, how to make leaks structurally hard, and the operational questions that follow.

## Tenants, users and memberships

Start with the model, because it answers half the questions. A **tenant** is the customer organisation that pays. A **user** is a person who logs in. They are connected by a **membership** that carries the role:

```sql
CREATE TABLE tenant     (id uuid PRIMARY KEY, name text NOT NULL, plan text NOT NULL);
CREATE TABLE app_user   (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
CREATE TABLE membership (
  tenant_id uuid REFERENCES tenant(id),
  user_id   uuid REFERENCES app_user(id),
  role      text NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (tenant_id, user_id)
);
```

Modelling membership separately lets one person (a consultant, an accountant) belong to several tenants, which almost every product needs eventually. Retrofitting that into a design where `user.tenant_id` is a column is painful, so mention it early.

## Three isolation models

| Model | Isolation | Cost and effort | Typical use |
| --- | --- | --- | --- |
| Shared tables with a `tenant_id` column | Logical, enforced by code or row-level security | Cheapest; one schema to migrate | Most SaaS products, especially early |
| Schema per tenant (same database) | Stronger; queries cannot cross schemas by accident | Migrations run N times; connection routing | Tens to hundreds of larger tenants |
| Database per tenant | Strongest; separate backups, keys, even regions | Highest; fleet management, N migrations | Enterprise or regulated customers who pay for it |

The mid-level answer is: **start with shared tables and a tenant id, enforce it in more than one place, and keep the door open to move a big customer to its own database later.** Many products end up hybrid: shared tables for most tenants, dedicated databases for a few enterprise contracts.

## Where the tenant comes from

Never take the tenant id from the request body or a query string the client controls. Resolve it on the server from something you trust:

- the authenticated user's membership plus a tenant chosen at login (stored as a claim in the session or token), or
- the subdomain (`acme.example.com`), then *checked* against the user's memberships.

In ASP.NET Core this is a small middleware or a scoped `ITenantContext` service populated once per request; in Express it is middleware that sets `req.tenant`. Everything downstream reads it from there, never from input.

```csharp
public sealed class TenantContext
{
    public Guid TenantId { get; set; }
}

// Program.cs
builder.Services.AddScoped<TenantContext>();
app.Use(async (ctx, next) =>
{
    var claim = ctx.User.FindFirst("tenant_id")?.Value;
    if (claim is null) { ctx.Response.StatusCode = 403; return; }
    ctx.RequestServices.GetRequiredService<TenantContext>().TenantId = Guid.Parse(claim);
    await next();
});
```

Put this after authentication in the pipeline (see [the middleware pipeline](aspnet-middleware-pipeline.md)) so `ctx.User` is populated.

## Making leaks structurally hard

Relying on every developer to remember the filter on every query is how leaks happen. Stack defences so a single mistake is not enough:

1. **Global query filters in the ORM.** EF Core's `HasQueryFilter` adds the predicate to every query for that entity:

   ```csharp
   modelBuilder.Entity<Project>()
       .HasQueryFilter(p => p.TenantId == _tenant.TenantId);
   ```

   The filter reads a field on the `DbContext`, which gets the scoped `TenantContext` injected. Beware `IgnoreQueryFilters()` in admin code and raw SQL, which skip it.

2. **Row-level security in Postgres.** The database itself refuses rows from other tenants, even for raw SQL:

   ```sql
   ALTER TABLE project ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON project
     USING (tenant_id = current_setting('app.tenant_id')::uuid);
   ```

   The app runs `SET LOCAL app.tenant_id = '...'` at the start of each transaction. The application role must not own the table or have `BYPASSRLS`, or the policy is skipped. SQL Server has an equivalent in security policies with `SESSION_CONTEXT`.

3. **Composite keys and foreign keys that include `tenant_id`.** If `task` references `(tenant_id, project_id)` rather than just `project_id`, the database cannot link a task to another tenant's project.

4. **Tests that try to cross the line.** An integration test that logs in as tenant A and requests tenant B's resource by id, expecting `404`, catches regressions cheaply. [Testing .NET APIs](dotnet-testing.md) shows the `WebApplicationFactory` set-up.

Return `404`, not `403`, for another tenant's resource: confirming it exists is itself a leak.

## Unique constraints, ids and search

Uniqueness is usually per tenant: two companies can both have a project called "Website". Make the constraint `UNIQUE (tenant_id, name)`, not `UNIQUE (name)`. Use UUIDs (v7 if you want them index-friendly) or scope sequential ids per tenant, so ids do not reveal how many customers you have. Anything built outside the database needs the same care: search indexes, caches and file storage keys must all include the tenant. A cache key of `project:42` in a shared Redis is a leak waiting to happen; `t:{tenantId}:project:42` is not.

## Noisy neighbours and fairness

In shared infrastructure one large tenant can slow everyone down: a huge export, a runaway integration, a report over five years of data. Mitigations, in the order you would reach for them:

- **Per-tenant rate limits** on the API (ASP.NET Core's rate limiter can partition by tenant id).
- **Per-tenant queues or fair scheduling** for background jobs, so one tenant's 50,000 jobs do not block everyone else's single email.
- **Plan limits** enforced in code: seats, projects, storage.
- **Moving the tenant** to a dedicated database or worker pool when they outgrow the shared one.

## Migrations, backups and deleting a tenant

With shared tables, one migration updates everyone at once, which is the main operational advantage. With schema or database per tenant, you need tooling to run migrations across the fleet and to cope with a few failing (see [EF Core migrations in teams](ef-core-migrations-in-teams.md)).

Two questions interviewers like: *"A customer asks for their data to be restored to yesterday."* With shared tables you cannot roll back one tenant's rows from a whole-database backup without an extraction process, which is a real argument for per-tenant databases for customers who demand it. *"A customer leaves and asks for deletion."* You need to delete across every table, file store and search index for that tenant id, and to record that you did; design `tenant_id` into everything from day one and this becomes a job rather than an archaeology project.

## What you should be able to answer

- Compare shared tables, schema per tenant and database per tenant. Which would you start with, and when would you move a customer?
- Where does the current tenant come from on each request, and why never from the request body?
- Name three layers that stop one tenant reading another's data if a developer forgets a filter.
- Why should a request for another tenant's resource return 404 rather than 403?
- How do you stop one large tenant slowing down everyone else?
- How would you handle a request to restore or delete a single tenant's data?
