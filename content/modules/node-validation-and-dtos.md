# Validation and DTOs in a Node API

TypeScript types vanish at runtime, so every byte that arrives over HTTP is
`unknown` until something checks it. Interviewers probe this with "where do you
validate?", "what does your API return for a bad request?" and "how do you stop a
client setting `isAdmin`?" This guide gives you one consistent answer, using Zod 4
in an Express 5 app, and the reasoning behind it.

## Three shapes, not one

A mid-level answer separates three things that beginners use one type for:

| Shape | Where it lives | Example |
|---|---|---|
| Request DTO | What a client may send | `{ customerId, items: [{ sku, qty }] }` |
| Domain / persistence model | What your service and database use | Order row with `status`, `createdAt`, `totalPence` |
| Response DTO | What you promise to return | `{ id, status, total: "12.50", items }` |

A **DTO** (data transfer object) is just a shape at a boundary. Keeping request
and response DTOs separate from the database model is what stops two classic
bugs: **mass assignment**, where a client sends `role: "admin"` and it lands in
the row because you spread `req.body` into an insert, and **over-exposure**, where
`res.json(user)` returns `passwordHash` because the row had it.

## Schemas as the single source of truth

```ts
import { z } from 'zod';

export const CreateOrder = z.object({
  customerId: z.number().int().positive(),
  items: z
    .array(z.object({
      sku: z.string().trim().min(1),
      qty: z.number().int().min(1).max(99),
    }))
    .min(1)
    .max(50),
  note: z.string().max(500).optional(),
});

export type CreateOrder = z.infer<typeof CreateOrder>;
```

One declaration gives you the runtime check and the static type, so they cannot
drift apart. Writing a separate `interface CreateOrder` next to it is how a field
ends up validated as optional but typed as required.

Parsing does more than accept or reject. `trim()` normalises input, and by default
Zod **strips unknown keys**: a body with `isAdmin: true` parses successfully and
the key is simply absent from the result. That is the cheapest defence against mass
assignment. Use `.strict()` when you would rather reject unknown keys with a 400,
which helps clients catch typos such as `quantity` instead of `qty`.

Upper bounds matter as much as types. An array with no `max` or a string with no
length limit lets one request make your service do unbounded work.

## Validating at the edge

Validate once, as the request enters, then pass typed data inward. A small
middleware keeps routes tidy:

```ts
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(new ValidationError(result.error));
    req.body = result.data;          // the parsed, stripped, trimmed value
    next();
  };

router.post('/', validateBody(CreateOrder), async (req, res) => {
  const order = await ordersService.create(req.body as CreateOrder);
  res.status(201).location(`/orders/${order.id}`).json(toOrderDto(order));
});
```

Replace `req.body` with the parsed data, not the original; otherwise the stripping
and trimming are thrown away. You cannot do the same with `req.query` in Express 5,
because it is a getter. Store parsed query values on `res.locals` or call the
schema inside the handler.

Where each rule lives:

| Rule | Where | Why |
|---|---|---|
| Shape, types, lengths, ranges | Schema at the edge | Cheap, no I/O, same for every caller |
| "Customer exists", "SKU is in stock" | Service | Needs the database; is business logic |
| Uniqueness | Database constraint, mapped to 409 | Only the database can check it without a race |

A check like "email is not taken" done in the service with a SELECT is a race: two
requests can both see no row. Keep the SELECT for a friendly message if you like,
but rely on a unique index and turn the violation into a 409.

## Query strings and params are strings

Everything in `req.params` and `req.query` is a string, or an array if the key
repeats (`?tag=a&tag=b`). Coerce deliberately:

```ts
export const ListOrdersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'paid', 'shipped']).optional(),
  includeArchived: z.stringbool().default(false),
});
```

Two traps. `z.coerce.boolean()` uses JavaScript truthiness, so the string
`"false"` becomes `true`; `z.stringbool()` in Zod 4 understands `"true"`,
`"false"`, `"1"`, `"0"` and similar. And `Number('')` is `0`, so an empty `?page=`
coerces to 0, which the `min(1)` then rejects, as it should.

Capping `limit` is not pedantry: without it, `?limit=1000000` asks the database for
a million rows.

## Returning useful 400s

Clients need to know which field failed and why, in a format they can rely on.
RFC 9457 problem details is the standard envelope:

```json
{
  "type": "https://api.example.com/problems/validation",
  "title": "Your request is not valid",
  "status": 400,
  "errors": {
    "customerId": ["Invalid input: expected number, received string"],
    "items": ["Too small: expected array to have >=1 items"]
  }
}
```

In Zod 4, `z.flattenError(error)` gives you `fieldErrors` keyed by top-level field,
which is what a form wants; `z.treeifyError` keeps nesting for deep objects. Map the
`ValidationError` to this shape in the central error handler (see [Express 5 in
depth](express-5-in-depth.md)) so every route answers the same way.

Use 400 for a body that fails the schema. Some teams use 422 for a well-formed body
that breaks a business rule; either is defensible if it is consistent and
documented. What is not defensible is a 500 because an unvalidated `undefined` hit
`.toLowerCase()` three layers down.

## Response DTOs

```ts
export function toOrderDto(row: OrderRow) {
  return {
    id: row.id,
    status: row.status,
    total: (row.totalPence / 100).toFixed(2),
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((i) => ({ sku: i.sku, qty: i.qty })),
  };
}
```

An explicit mapper is an allowlist: a new column added to the table next month is
not published by accident. It is also the place to convert types JSON cannot carry:
a `BigInt` id to a string, pence to a decimal string, a `Date` to ISO 8601. Some
teams also define the response as a Zod schema and parse outgoing data in tests (or
in development), which catches drift between code and the OpenAPI document.

## Updates: PATCH and partial schemas

```ts
export const UpdateOrder = CreateOrder.pick({ note: true }).partial();
```

Derive update schemas from the create schema so rules stay in one place. Watch for
the difference between a field that is absent (leave it alone) and one that is
`null` (clear it). `.optional()` allows absence; `.nullable()` allows `null`; a
field that may be cleared needs both. Never pass the parsed PATCH body straight to
an ORM `update` if the schema allows fields the user should not change; pick the
allowed ones explicitly.

## Sharing schemas with the frontend

In a TypeScript monorepo you can put schemas in a shared package and use the same
`CreateOrder` for the React form and the API. That removes a class of drift, but
it couples deployments: changing a shared rule changes both sides at once. Many
teams share types generated from an OpenAPI document instead. Either way, the
server must still validate. Client-side checks are for the user's convenience, not
your security.

The [runtime validation guide](typescript-runtime-validation.md) covers Zod's type
side in more depth, and [js/31](../../31-validator/) has you write a small validator
yourself, which is the best way to stop finding schema libraries magical.

## What you should be able to answer

- Where do you validate a request body, and why there rather than in the service or the database?
- How do you stop a client setting `isAdmin` or `ownerId` through the request body?
- Why is `z.coerce.boolean()` wrong for `?includeArchived=false`?
- What does a good 400 response contain, and which standard format would you use?
- Why map database rows to response DTOs instead of returning them directly?
- Which rules cannot be enforced in a schema, and how do you handle uniqueness without a race?
