# Modelling relationships in EF Core

"Model a blog with posts, tags and an author profile" is a common .NET
take-home and whiteboard prompt. Interviewers are checking that you know which
side holds the foreign key, what happens on delete, how many-to-many is stored,
and why returning an entity graph from an API breaks. The loading basics and
N+1 are in [orm-and-ef-core.md](orm-and-ef-core.md); this guide is about
shaping the model.

## The vocabulary

Every relationship has a **principal** (the "one" side, which owns the key) and
a **dependent** (the side holding the **foreign key**). Navigations are the
object references either side uses to reach the other:

```cs
public class Customer                     // principal
{
    public int Id { get; set; }
    public List<Order> Orders { get; } = []; // collection navigation
}

public class Order                        // dependent
{
    public int Id { get; set; }
    public int CustomerId { get; set; }      // foreign key
    public Customer Customer { get; set; } = null!; // reference navigation
}
```

That is a complete one-to-many, configured entirely **by convention**: EF sees
`Customer`, `CustomerId` and the collection and pairs them. You write fluent
configuration only when conventions cannot guess — unusual names, two
relationships between the same types, a non-default delete behaviour.

## Fluent configuration

The fluent API always reads from one entity outward:

```cs
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer)
    .WithMany(c => c.Orders)
    .HasForeignKey(o => o.CustomerId)
    .OnDelete(DeleteBehavior.Restrict);
```

`HasOne`/`HasMany` names the navigation on this entity; `WithOne`/`WithMany`
names the inverse. If a side has no navigation, call `WithMany()` with no
argument. Put configuration in `IEntityTypeConfiguration<T>` classes and load
them with `modelBuilder.ApplyConfigurationsFromAssembly(...)` once the model
grows past a handful of entities.

## One-to-one

With one-to-one, EF cannot infer which side is dependent from the types alone,
so you tell it with the generic `HasForeignKey<T>`:

```cs
modelBuilder.Entity<User>()
    .HasOne(u => u.Profile)
    .WithOne(p => p.User)
    .HasForeignKey<UserProfile>(p => p.UserId);
```

EF puts a **unique index** on `UserProfile.UserId`, which is what makes it
one-to-one in the database rather than one-to-many. The dependent should be
the side that can exist only with the other — a profile needs a user, not the
reverse.

## Many-to-many: skip navigations or a join entity

Since EF Core 5 you can declare collections on both sides and nothing else:

```cs
public class Post { public int Id { get; set; } public List<Tag> Tags { get; } = []; }
public class Tag  { public int Id { get; set; } public List<Post> Posts { get; } = []; }
```

EF creates a `PostTag` join table with a composite primary key, mapped to an
implicit shared-type entity you never see. `post.Tags.Add(tag)` inserts a join
row. These are **skip navigations** — they skip over the join entity.

The moment the link itself has data — when a tag was added, who added it, a
sort order — you need an **explicit join entity**:

```cs
public class PostTag
{
    public int PostId { get; set; }
    public int TagId { get; set; }
    public DateTime TaggedAt { get; set; }
    public Post Post { get; set; } = null!;
    public Tag Tag { get; set; } = null!;
}

modelBuilder.Entity<Post>()
    .HasMany(p => p.Tags)
    .WithMany(t => t.Posts)
    .UsingEntity<PostTag>();
```

`UsingEntity<PostTag>()` keeps the skip navigations working while giving you a
real entity for the payload. The alternative is to drop the skip navigations
and model two one-to-many relationships to `PostTag`; that is simpler to reason
about when the join is a concept in its own right, such as `Enrolment` between
`Student` and `Course`. See [relational-data-modeling.md](relational-data-modeling.md)
for the table design side.

## Required, optional, and nullable reference types

Requiredness comes from the **foreign key's nullability**:

| Foreign key | Relationship | Default delete behaviour |
|---|---|---|
| `int CustomerId` | Required | `Cascade` |
| `int? CustomerId` | Optional | `ClientSetNull` |

With nullable reference types enabled, the navigation should agree: a required
`Customer Customer { get; set; } = null!;` (the `null!` tells the compiler EF
will populate it) and an optional `Customer? Customer { get; set; }`. If you
have no explicit FK property, EF creates a shadow FK and takes requiredness
from the navigation's nullability.

**`Cascade`** deletes dependents with the principal, both for tracked entities
and in the database's `ON DELETE CASCADE`. **`ClientSetNull`** sets the FK to
null on dependents EF is tracking, but creates no cascade in the database; an
untracked dependent row blocks the delete with a constraint error. Choose
explicitly for anything important — cascading an `Invoice` delete to its
`Payments` is rarely what finance wants, so `Restrict` is common. SQL Server
refuses to create two cascade paths to the same table ("may cause cycles or
multiple cascade paths"); you resolve it by making one of them `Restrict` or
`NoAction`.

## Owned types and complex types

Not every class deserves a table. An `Address` on an `Order` is a **value
object**: no identity, stored alongside its owner.

```cs
// Owned type: columns ShippingAddress_Street, ShippingAddress_City on Orders
modelBuilder.Entity<Order>().OwnsOne(o => o.ShippingAddress);

// EF 8+ complex type: same table shape, value semantics
modelBuilder.Entity<Order>().ComplexProperty(o => o.BillingAddress);
```

The difference matters in interviews:

- **Owned types** are still entity types with a hidden key. One instance
  cannot be shared between two owners, and `OwnsMany` stores a collection in
  its own table (or as JSON with `ToJson()`, EF 7+).
- **Complex types** (EF 8+, `ComplexProperty` or `[ComplexType]`) have no key
  and are tracked by value, so assigning the same `Address` to billing and
  shipping just works. They were initially limited to required, non-collection
  properties; EF 10 broadens them, including optional complex types and JSON
  mapping.

For a new value object, a complex type is usually the better fit; owned types
remain for collections and existing models.

## Loading related data

Eager loading brings navigations in with the main query, and since EF 5 you can
filter what comes back:

```cs
var blog = await db.Blogs
    .Include(b => b.Posts.Where(p => p.Published).OrderByDescending(p => p.Date).Take(5))
        .ThenInclude(p => p.Tags)
    .Include(b => b.Owner)
        .ThenInclude(o => o.Profile)
    .AsNoTracking()
    .SingleAsync(b => b.Id == id, ct);
```

**Explicit loading** fetches a navigation later, on demand — and its `Query()`
lets you aggregate without loading:

```cs
var order = await db.Orders.SingleAsync(o => o.Id == id, ct);
if (includeLines)
    await db.Entry(order).Collection(o => o.Lines).LoadAsync(ct);

int lineCount = await db.Entry(order).Collection(o => o.Lines).Query().CountAsync(ct);
```

**Lazy loading** is **off by default**. Turning it on needs the
`Microsoft.EntityFrameworkCore.Proxies` package, `UseLazyLoadingProxies()`, and
`virtual` navigations on non-sealed classes. It hides a query behind every
property access; say you keep it off. For how the query shapes perform, see
[ef-core-query-performance.md](ef-core-query-performance.md).

## Relationship fixup

The change tracker wires up navigations between entities it is tracking,
whichever query loaded them:

```cs
var customer = await db.Customers.SingleAsync(c => c.Id == 7, ct);
await db.Orders.Where(o => o.CustomerId == 7).LoadAsync(ct);
// customer.Orders is now populated, and each order.Customer points at customer
```

It works for writes too: add an `Order` to `customer.Orders` and EF sets
`CustomerId` on `SaveChanges`. Fixup explains two surprises. A filtered
`Include` can appear to return extra children when others were already
tracked. And with `AsNoTracking`, there is no fixup between separate queries.

## JSON cycles: fix it with DTOs

Return a tracked `Customer` whose `Orders` each point back at the `Customer`,
and `System.Text.Json` throws `JsonException` about a possible object cycle.
There are two serialiser switches:

```cs
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles);
```

`IgnoreCycles` writes `null` where the cycle would be; `Preserve` emits
`$id`/`$ref` metadata that most clients cannot read. Both treat the symptom.
The real fix is to **project to DTOs**: the API contract stops depending on the
entity graph, you stop over-posting and over-exposing columns, and the query
fetches only what the response needs. Controllers configure the same option
through `AddControllers().AddJsonOptions(...)`; the minimal API versus
controller split is covered in
[minimal-apis-vs-controllers.md](minimal-apis-vs-controllers.md).

## What you should be able to answer

- In a one-to-many, which side holds the foreign key, and how do conventions discover the relationship?
- How does EF store a many-to-many, and when do you need an explicit join entity?
- What are the default delete behaviours for required and optional relationships, and what does `ClientSetNull` actually do in the database?
- When would you choose a complex type over an owned type for a value object?
- What must you do to enable lazy loading, and why do most teams leave it off?
- Why does serialising an entity with navigations fail, and why are DTOs a better fix than `ReferenceHandler.IgnoreCycles`?
