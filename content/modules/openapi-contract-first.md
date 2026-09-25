# OpenAPI and contract-first APIs

"How do the frontend and backend agree on the API?" is a mid-level question in
disguise. A strong answer names a machine-readable contract, says who owns it,
explains how types flow from it into both codebases, and shows how CI stops the
contract and the code drifting apart.

## Anatomy of an OpenAPI 3.1 document

OpenAPI describes an HTTP API in YAML or JSON. Version 3.1 (3.2 followed in
2025 with few changes most teams will notice) aligned its schemas with JSON
Schema 2020-12, so `nullable: true` became `type: [string, 'null']`.

```yaml
openapi: 3.1.0
info: { title: Orders API, version: 1.4.0 }
servers: [{ url: https://api.example.com }]
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      tags: [orders]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: The order
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
        '404': { $ref: '#/components/responses/NotFound' }
      security: [{ bearer: [] }]
components:
  schemas:
    Order:
      type: object
      required: [id, status, totalPence]
      properties:
        id: { type: string, format: uuid }
        status: { type: string, enum: [pending, paid, shipped] }
        totalPence: { type: integer, minimum: 0 }
        note: { type: [string, 'null'] }
  responses:
    NotFound:
      description: No such resource
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
  securitySchemes:
    bearer: { type: http, scheme: bearer, bearerFormat: JWT }
```

| Part | What it holds | What goes wrong when it is sloppy |
|---|---|---|
| `paths` | Every route, method, parameter and response | Undocumented error responses; clients cannot type them |
| `operationId` | Unique name per operation | Generators invent names like `getApiOrdersId` |
| `components/schemas` | Reusable data shapes | Inline copies drift; generated types duplicate |
| `components/responses` | Reusable responses (errors) | Every endpoint describes 404 differently |
| `securitySchemes` | Bearer, API key, OAuth 2.0, cookie | Generated clients do not attach credentials |
| `required` | Which properties are always present | Every generated field becomes optional (`?`) |

That last row matters more than it looks. If `required` is missing, the
TypeScript types say every field may be `undefined`, and your frontend fills up
with needless `?.`. Document your error bodies too: they are part of the
contract. See [API error design](api-error-design.md) for the problem details
schema to reference.

## Contract-first versus code-first

**Code-first**: you write the endpoints; a tool generates the spec from routes,
attributes and types. **Contract-first** (design-first): you write the spec,
review it, then implement the server against it and generate clients from it.

| | Code-first | Contract-first |
|---|---|---|
| Source of truth | The server code | The YAML document |
| Speed to first endpoint | Fast | Slower; design review first |
| Frontend can start | When the endpoint exists | As soon as the spec is merged (against a mock) |
| Drift risk | Spec is only as good as annotations | Server can diverge unless tested against the spec |
| Review quality | API shape reviewed as C# or TS diffs | API shape reviewed as an API |
| Suits | One team owning both ends, internal APIs | Public or partner APIs, several consuming teams |

Code-first fails as a spec full of missing responses because nobody annotated
anything; contract-first fails as a beautiful spec the server ignores. Both are
fixed by automated checks, covered below.

A pragmatic middle path many teams use: generate the spec from code, commit it
to the repository, and review changes to the generated file in pull requests.
You get code-first speed and contract-first review.

## Generating types and clients

Hand-written fetch wrappers and hand-copied interfaces are how a renamed field
reaches production. Generate instead.

| Tool | Output | Notes |
|---|---|---|
| `openapi-typescript` | `.d.ts` types only | Tiny; pair with `openapi-fetch` for a typed client with no runtime codegen |
| Orval | Typed fetch/axios functions, TanStack Query hooks, Zod schemas, MSW mocks | Heavier; great for React apps |
| NSwag | C# and TypeScript clients | Long-established in .NET shops |
| Kiota | Clients in C#, TS, Go, Java, Python and more | Microsoft's generator; builder-style API |

The lightest option in TypeScript:

```ts
// npx openapi-typescript ./openapi.yaml -o ./src/api/schema.d.ts
import createClient from 'openapi-fetch';
import type { paths } from './schema';

const api = createClient<paths>({ baseUrl: '/api' });

const { data, error } = await api.GET('/orders/{id}', {
  params: { path: { id } },
});
if (error) showProblem(error);   // typed from the 404 response schema
else render(data.totalPence);    // number, not any
```

Rename `totalPence` in the spec, regenerate, and `tsc` fails at every call site.
That is the whole point: the compiler becomes your integration test. Commit the
generator command as an npm script and run it in CI so nobody edits generated
files by hand.

Generated types describe the shape the server *promises*; they do not check
what actually arrives. At trust boundaries you still validate at runtime (see
[runtime validation](typescript-runtime-validation.md)), and Orval can emit Zod
schemas for exactly that.

## ASP.NET Core: the built-in OpenAPI package

Since .NET 9 the web templates use `Microsoft.AspNetCore.OpenApi` and no longer
include Swashbuckle. .NET 10 emits OpenAPI 3.1 by default.

```csharp
builder.Services.AddOpenApi(o =>
{
    o.AddDocumentTransformer((doc, ctx, ct) =>
    {
        doc.Info.Title = "Orders API";
        return Task.CompletedTask;
    });
});

var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();                    // /openapi/v1.json
    app.MapScalarApiReference();         // Scalar.AspNetCore: UI at /scalar
}

app.MapGet("/orders/{id:guid}", GetOrder)
   .WithName("getOrder")                 // becomes operationId
   .WithTags("orders")
   .Produces<OrderDto>()
   .ProducesProblem(StatusCodes.Status404NotFound);
```

Points worth knowing:

- Returning `Results<Ok<OrderDto>, NotFound>` from a minimal API handler lets
  the generator infer both responses without `.Produces` calls. Controllers use
  `[ProducesResponseType]`.
- `required` comes from C# nullability and the `required` keyword, so turn on
  nullable reference types or the spec lies.
- **Document, operation and schema transformers** replace Swashbuckle's filters
  for adding security schemes, examples or descriptions.
- Add `Microsoft.Extensions.ApiDescription.Server` and the document is written
  to disk **at build time**, which is what you commit and diff in CI.
- Swagger UI is optional; Scalar is the common modern pairing. Whether to expose
  either in production is a security decision, not a default.

See [minimal APIs vs controllers](minimal-apis-vs-controllers.md) for how the
endpoint styles differ.

## Mock servers: let the frontend start first

With a contract, the frontend does not have to wait for the backend. Prism turns
a spec into a working HTTP server that returns examples (or generated data) and
validates requests against the schemas:

```sh
npx @stoplight/prism-cli mock openapi.yaml --port 4010
curl -i http://localhost:4010/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6
# Prefer: code=404 asks Prism for the documented 404 instead
```

Send a request missing a required field and Prism returns a 422 describing the
violation, which is often the first time anyone notices the spec is too strict
or too loose. For component tests, Orval's MSW output or hand-written MSW
handlers typed from the generated `paths` do the same job inside the test
runner.

## Breaking-change detection in CI

A breaking change is anything that makes an existing, correct client fail:

| Breaking | Not breaking |
|---|---|
| Removing or renaming a path, field or enum value in a response | Adding an optional request field |
| Making an optional request field required | Adding a response field (for tolerant clients) |
| Narrowing a type (`string` to `uuid`), tightening `maxLength` | Adding a new endpoint |
| Adding a new enum value to a response, for strict clients | Relaxing a validation rule |
| Changing a status code or success content type | Adding a new error response code |

`oasdiff` compares two versions of a spec and classifies every change:

```sh
# in CI, compare the PR's spec with main's
git show origin/main:openapi.yaml > base.yaml
oasdiff breaking base.yaml openapi.yaml --fail-on ERR
```

The build fails on a breaking change, forcing a conversation: is this really
necessary, does it need a new version, who consumes it? That links directly to
[API versioning strategies](api-versioning-strategies.md). Add Spectral for
style rules too (every operation has an `operationId`, every 4xx has a problem
schema, paths are kebab-case).

## Keeping spec and code honest

A spec is only useful while it is true. The checks, from cheapest up:

1. **Generated spec committed and diffed.** CI regenerates it and fails if the
   committed file differs; any API change shows up in review.
2. **Generated clients compiled in CI.** A server change that breaks the
   frontend's types fails the pipeline, not a user.
3. **Response validation in integration tests.** Validate real responses from
   your test server against the spec (for example with an OpenAPI validator in
   Vitest, or Prism in `proxy` mode in front of a staging server).
4. **Contract tests** for many consumers: each consumer records what it relies
   on, and the provider verifies against all of them (Pact is the usual tool).

If you only do one, do the first. The project
[../../65-rest-api/](../../65-rest-api/) is a good place to try generating a
spec for an existing API and seeing how much it initially gets wrong.

## What you should be able to answer

- What lives under `paths` and `components`, and why do `operationId` and `required` matter to generated clients?
- Compare contract-first and code-first; when would you choose each?
- How do you get typed API calls in a React app from an OpenAPI document?
- What replaced Swashbuckle in .NET 9 templates, and how do you commit the spec at build time?
- Give three changes that break clients and how CI would catch them.
- How does a mock server let the frontend and backend work in parallel?
