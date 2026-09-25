# Authorisation models: roles, permissions, attributes and ownership

Broken access control has topped the OWASP Top 10 since 2021, and it is almost
always an application bug rather than a framework one. Interviewers ask "how
would you model permissions for this app?" to see whether you reach for a
sensible model, enforce it in one place, and remember that one customer must
never see another's data.

Authentication (who are you?) is covered in [Auth: sessions, tokens and
cookies](auth-sessions-jwt.md). This guide is about the next question: what are
you allowed to do *to this particular thing*?

## Three questions every request must answer

1. **Is the caller authenticated?** If not: `401 Unauthorized`.
2. **May this kind of user perform this action at all?** Can a viewer delete
   invoices? That is a function of the user's role or permissions.
3. **May this user perform it on this record?** Is invoice 42 in their
   organisation, owned by them, still a draft? That needs the record.

Most real breaches skip the third question. OWASP calls it broken object-level
authorisation (BOLA, formerly IDOR): `GET /api/invoices/43` returns someone
else's invoice because the code checked "signed in" and "has invoice:read" but
never "is this invoice theirs".

## The models, compared

| Model | Rule looks like | Good for | Starts to hurt when |
|---|---|---|---|
| Ownership | `invoice.ownerId === user.id` | Personal data, simple apps | Sharing and teams arrive |
| RBAC (roles) | `admin` may delete invoices | Most business apps | Roles multiply: `editor-uk-no-delete` |
| Permissions behind roles | Role `accountant` grants `invoice:approve` | Growing apps; checks stay stable as roles change | Rarely; this is the usual end state |
| ABAC (attributes) | Approve if `amount < user.approvalLimit` and same department | Rules based on data and context | Rules scatter unless centralised |
| ReBAC (relationships) | Viewer of a folder is viewer of its documents | Sharing, nested workspaces, Google Docs-style | You build it yourself instead of using a service |

In practice you combine them. The pattern most CRUD apps settle on is: **roles
grant permissions, code checks permissions, and a policy function adds the
record-level rules** (tenant, ownership, status, amount).

Check permissions, not roles. `if (user.role === 'admin')` scattered through 40
handlers makes every new role a code search. `requirePermission('invoice:delete')`
lets you add a `finance-lead` role by editing data.

## One policy function, used everywhere

Put the decision in one place, with a signature that takes the user, the action
and the resource:

```ts
type Role = 'viewer' | 'editor' | 'admin';
type User = { id: string; tenantId: string; role: Role };
type Invoice = { id: string; tenantId: string; ownerId: string; status: 'draft' | 'sent' | 'paid' };
type Action = 'invoice:read' | 'invoice:edit' | 'invoice:delete';

export function can(user: User, action: Action, invoice: Invoice): boolean {
  if (user.tenantId !== invoice.tenantId) return false; // tenancy first, always
  switch (action) {
    case 'invoice:read':   return true;
    case 'invoice:edit':   return user.role !== 'viewer' && invoice.status === 'draft';
    case 'invoice:delete': return user.role === 'admin' || (user.id === invoice.ownerId && invoice.status === 'draft');
  }
}
```

Because `Action` is a union and the `switch` is exhaustive, TypeScript's
`--strict` checks catch a new action that nobody wrote a rule for. The function
is pure, so it gets a table of unit tests; see [Test doubles in
practice](test-doubles-in-practice.md) for why that is the cheapest test you
will ever write. The same shape in ASP.NET Core is resource-based authorisation
with `IAuthorizationService`, covered in [Authentication and authorisation in
ASP.NET Core](aspnet-authn-authz.md).

## Enforce it in the query, not after it

A policy function needs the record, but for lists and lookups the safest check
is the one that is part of the database query:

```sql
-- Lookup: another tenant's id simply finds nothing
SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2;

-- List: never fetch everything and filter in JavaScript
SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50;
```

Build this into the data layer (a repository that always takes the tenant id,
or an EF Core global query filter) so a new endpoint cannot forget it. For
defence in depth, Postgres **row-level security** can enforce tenancy in the
database itself:

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

The app sets `app.tenant_id` per transaction. Table owners and superusers bypass
row-level security unless you `FORCE` it, so connect as a less privileged role.

## 403 or 404?

When a user asks for a record they may not see, a `403 Forbidden` confirms the
record exists. For records in another tenant or private to another user, return
`404 Not Found`, exactly as if the id did not exist. Use `403` when the user
can legitimately know the record exists but may not perform this action (a
viewer trying to edit a shared invoice). Whichever you choose, be consistent,
and never leak details in the error body.

## Where the permissions come from

- **Roles in the database**, loaded per request or cached briefly. Changes take
  effect quickly and revocation works.
- **Roles as claims in a JWT or session.** Cheap to check, but stale until the
  token expires: a fired administrator keeps admin rights for the token's
  lifetime. Keep access tokens short, or look up permissions server-side for
  sensitive actions.
- **Group claims from an identity provider** (Entra ID groups). Map them to your
  own permissions in one place rather than checking group names in handlers.

The front end may hide buttons the user cannot use, but that is for usability.
Every check that matters runs on the server, because anyone can call your API
with `curl`.

## Relationship-based access, briefly

When access follows relationships (member of a team, which owns a project, which
contains a document), rules become graph questions: "is Ada a viewer of document
9 through any path?". Google's Zanzibar paper describes the model; OpenFGA,
SpiceDB and Permify are open-source services that implement it. For a
mid-level role, the useful answer is recognising when you have outgrown
roles-plus-ownership, and that a relationship store beats ad-hoc recursive SQL
once sharing becomes a core feature.

## Testing authorisation

Authorisation bugs are silent: the happy path works for everyone. Test the
refusals deliberately:

- A table of unit tests for the policy function: every role against every
  action, plus the status and ownership edges.
- Integration tests with **two real users in two tenants**: user B asks for
  user A's record by id and gets a 404; a viewer's `DELETE` gets a 403;
  an anonymous request gets a 401.
- A test that lists every route and fails if one has no authorisation metadata,
  so a new endpoint cannot ship open by accident. In ASP.NET Core a fallback
  policy does the same job at runtime.

The REST API in [the REST API project](../../65-rest-api/) is a good place to
practise adding tenant scoping and these tests.

## What you should be able to answer

- What is broken object-level authorisation, and how would you prevent it
  across a whole codebase rather than endpoint by endpoint?
- Why check permissions rather than role names in application code?
- When would you choose ABAC or relationship-based access over plain roles?
- Would you return 403 or 404 for another tenant's record, and why?
- What goes wrong when roles live only inside a long-lived JWT?
- Which tests would convince you that one tenant cannot read another's data?
