# EF Core migrations in a team

`dotnet ef migrations add` is easy on your own. The interview questions come
from the team version: two branches that both touch the schema, a rename that
silently drops a column, a deploy with four replicas, a column you need to
remove without downtime. This guide covers those; the command basics are in
[orm-and-ef-core.md](orm-and-ef-core.md).

## What a migration actually is

Each `migrations add` produces three things in the `Migrations` folder:

| File | Contents | Edited by hand? |
|---|---|---|
| `20260924101500_AddShippedAt.cs` | `Up` and `Down` methods | Yes, when reviewing |
| `20260924101500_AddShippedAt.Designer.cs` | The migration id and the model as of this migration | No |
| `AppDbModelSnapshot.cs` | The **current** model, in full | No |

When you add a migration, EF compares your current model with the
**snapshot**, not with the database. The difference becomes `Up`; the
snapshot is rewritten to match the new model. The database records which
migrations have run in the `__EFMigrationsHistory` table, keyed by the
timestamped id.

```sh
dotnet ef migrations add AddShippedAt
dotnet ef migrations list                  # marks those not yet applied as pending
dotnet ef migrations remove                # deletes the last migration, restores the snapshot
dotnet ef migrations has-pending-model-changes   # EF 8+: non-zero exit if you forgot one
```

`has-pending-model-changes` belongs in CI: it fails the build when someone
changed an entity without adding a migration.

## Why the snapshot conflicts

There is one snapshot file per context, and every migration rewrites it. Two
developers who each add a migration on their own branch both modify it, so the
second merge conflicts in `AppDbModelSnapshot.cs` — even when their changes
are unrelated.

**Independent changes** (you add `Orders.ShippedAt`, a colleague adds a
`Coupons` table): resolve the conflict by keeping **both** sides of the
snapshot. The two migrations have different timestamps, both get applied in id
order, and the result is correct.

**Overlapping changes** (both of you touch the same entity or index), or a
snapshot you are not confident you merged correctly: rebuild yours.

```sh
# on your branch, after merging main
dotnet ef database update LastMigrationFromMain   # un-apply yours locally if applied
dotnet ef migrations remove                       # drop your migration + snapshot change
dotnet ef migrations add AddShippedAt             # re-scaffold on top of main's snapshot
```

Then run `has-pending-model-changes` to confirm the snapshot matches the model.
The rule underneath: **never edit or remove a migration that has been applied
to a shared environment.** Once it has run on staging, fix forward with a new
migration.

## Review the generated migration

Treat a migration like any other code in review, because EF only sees the
before and after model — not your intent. The classic trap is a rename:

```cs
// What EF scaffolds when you rename Customer.Name to Customer.FullName
migrationBuilder.DropColumn(name: "Name", table: "Customers");
migrationBuilder.AddColumn<string>(name: "FullName", table: "Customers", nullable: false, defaultValue: "");

// What you meant: keeps the data
migrationBuilder.RenameColumn(name: "Name", table: "Customers", newName: "FullName");
```

What else to look for in review:

- **Destructive operations** — `DropColumn`, `DropTable`, and type changes
  that narrow a column (`nvarchar(max)` to `nvarchar(100)`).
- **New non-nullable columns** on a large table with a `defaultValue` of `""`
  or `0`, which may not be what the business wants.
- **Index creation** on a big table, which can lock it; SQL Server and
  Postgres both have online or concurrent options you may need.
- **The `Down` method** — make sure it would actually work, or accept
  explicitly that you only roll forward.

## Data migrations

Schema and data often change together. `migrationBuilder.Sql` runs arbitrary
SQL inside the migration:

```cs
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.AddColumn<string>(name: "Status", table: "Orders", nullable: true);

    migrationBuilder.Sql("""
        UPDATE Orders SET Status = CASE WHEN ShippedAt IS NULL THEN 'Open' ELSE 'Shipped' END
        """);

    migrationBuilder.AlterColumn<string>(name: "Status", table: "Orders", nullable: false,
        oldClrType: typeof(string), oldNullable: true);
}
```

Use SQL, not your `DbContext` or entity classes: a migration must produce the
same result in a year, when those classes have changed. For millions of rows,
do the backfill as a batched job outside the migration, or one long
transaction will lock the table.

## Applying migrations: the options

| Option | How | Good | Watch out |
|---|---|---|---|
| Idempotent SQL script | `dotnet ef migrations script --idempotent -o migrate.sql` | Reviewable by a DBA; runs in any SQL tool | You still need a step that runs it |
| Migration bundle | `dotnet ef migrations bundle --self-contained -r linux-x64` | One executable, no SDK or source on the target | Built per runtime |
| `Database.Migrate()` at startup | Called in `Program.cs` | Zero extra infrastructure | Races, permissions, slow starts |
| `dotnet ef database update` | From a developer machine | Fine locally | Never for production |

An **idempotent script** checks `__EFMigrationsHistory` before each migration,
so it is safe whatever state the target database is in:

```sql
IF NOT EXISTS (SELECT * FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'20260924101500_AddShippedAt')
BEGIN
    ALTER TABLE [Orders] ADD [ShippedAt] datetime2 NULL;
END;
```

A **bundle** is a small executable that applies pending migrations:

```sh
dotnet ef migrations bundle --self-contained -r linux-x64 -o efbundle
./efbundle --connection "$DB_CONNECTION"
```

Either runs as a dedicated pipeline step or an init container, **once**, before
the new version takes traffic. That is the arrangement described in
[ci-cd-pipelines.md](ci-cd-pipelines.md).

## Why not Migrate() at startup

It is tempting and it works on one instance. With several replicas:

- They all start together and all try to migrate. EF 9 takes a database-wide
  lock during `Migrate()`, so they no longer corrupt each other, but they
  still queue and delay startup.
- The app's runtime identity needs DDL rights (`ALTER`, `CREATE`), which
  violates least privilege for every request it ever serves.
- A failed or slow migration becomes a crashing or unhealthy app, and the
  orchestrator keeps restarting it.
- There is no review point: whatever was scaffolded runs.

Microsoft's own guidance is to avoid it in production. It is fine for local
development, integration tests and single-instance hobby apps.

## Zero downtime: expand and contract

During a rolling deploy, old and new code run against the same database at
the same time. So every migration must work with **both** versions. Split
breaking changes into steps across several releases:

| Release | Schema | Code |
|---|---|---|
| 1 — expand | Add `FullName`, nullable | Write both `Name` and `FullName`; read `Name` |
| 2 — migrate | Backfill `FullName` in batches | Read `FullName` |
| 3 — contract | Make `FullName` required, drop `Name` | Stop touching `Name` |

This is also the answer to "rename a column with zero downtime" — the
`RenameColumn` above is only safe if you can stop the old code first.

## EF 9's pending-model-changes error

EF 9 made a common silent mistake loud. If the model differs from the latest
migration's snapshot, `Migrate()` throws with `PendingModelChangesWarning`
("the model has pending changes"). It also fires when the model is
non-deterministic — for example `HasData` using `DateTime.Now` or
`Guid.NewGuid()`, which changes the model on every build.

The right fix is almost always to add the missing migration or make the seed
data constant. You can downgrade it, but that hides the bug:

```cs
options.ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning));
```

## Design-time factories and separate assemblies

The `dotnet ef` tools build your startup project and try to get a `DbContext`
from its host. When that fails — no web host, configuration that needs secrets
you do not have, a class library — give the tools a factory:

```cs
public sealed class AppDbFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDb>()
            .UseSqlServer("Server=localhost;Database=App;Trusted_Connection=True;TrustServerCertificate=True")
            .Options;
        return new AppDb(options);
    }
}
```

It is only used at design time, so a local connection string is acceptable.

To keep migrations out of your data project — common when you support two
providers, each with its own migrations — point EF at another assembly:

```cs
options.UseSqlServer(cs, sql => sql.MigrationsAssembly("MyShop.Migrations"));
```

```sh
dotnet ef migrations add AddShippedAt --project src/MyShop.Migrations --startup-project src/MyShop.Api
```

`--project` is where the migration files go; `--startup-project` is what gets
built and run to find the configuration. Confusing the two is the most common
reason the tools report that they cannot create a `DbContext`.

## What you should be able to answer

- Why do merge conflicts appear in the model snapshot, and how do you resolve them when two developers each added a migration?
- What would EF scaffold for a renamed property, and how do you fix it before merging?
- Compare idempotent scripts, migration bundles and `Database.Migrate()` for deploying to production.
- Why is migrating at startup risky with several replicas, even with EF 9's migration lock?
- Walk through removing or renaming a column with zero downtime.
- What does EF 9's `PendingModelChangesWarning` catch, and why should you not simply suppress it?
