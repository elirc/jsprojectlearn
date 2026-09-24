# Structuring an application: layers, slices and Clean Architecture

.NET interviews ask about Clean Architecture, CQRS and MediatR nearly every
time, and Node teams ask the NestJS equivalent. The mid-level signal is not
knowing the diagrams; it is having a position and being able to say what it
costs. This guide takes one real project, the kanban API from
[csharp/28](../../csharp/28-capstone-kanban-api/), and lays it out three ways
so the trade-offs are concrete rather than philosophical.

## What architecture is for

One goal: **a change should land in one place.** Adding a rule, swapping the
database or adding an endpoint should not mean a treasure hunt across the
codebase. The price is **indirection**: every interface, project and handler is
one more hop a reader has to follow. A good structure buys more locality than
it costs in hops. A bad one pays for hops you never needed.

The capstone today is flat, and at 400 lines that is correct:

```
refactored/
  Program.cs            four endpoints, DTOs, one Problem() helper
  Board.cs              Card, Column, Board: the rules (remove before insert)
  BoardRepository.cs    IBoardRepository + InMemoryBoardRepository
  Result.cs             Result<T>, Error
  Tests.cs
```

Now imagine it grows to 40 endpoints. Here are the three shapes it could take.

## Classic layers

Organise by technical role: controller → service → repository.

```
KanbanApi/
  Controllers/
    BoardController.cs          GET board, POST columns, POST cards, POST move
  Services/
    IBoardService.cs
    BoardService.cs             AddColumn, AddCard, MoveCard
  Repositories/
    IBoardRepository.cs
    InMemoryBoardRepository.cs
  Models/
    Board.cs  Column.cs  Card.cs
  Dtos/
    AddCardRequest.cs  MoveCardRequest.cs  ColumnCreated.cs
```

Everyone recognises it, which is its main strength. The weaknesses show at
size. One feature ("archive a card") touches five folders. `BoardService`
grows into a 1,500-line class that every feature edits. And there is the
**anaemic domain model** trap: models become bags of properties, every rule moves
into services, and the one thing capstone 28 got right, `Board.MoveCard`
guarding its own invariant, is lost. Wrapping EF Core in a repository for the
sake of the layer is covered in [the ORM guide's repository
section](orm-and-ef-core.md).

## Vertical slices

Organise by feature. Each endpoint owns its request, validation, handler and
response in one file; shared rules stay in the domain.

```
KanbanApi/
  Features/
    GetBoard.cs
    AddColumn.cs
    AddCard.cs
    MoveCard.cs                 request, validation, handler, endpoint
  Domain/
    Board.cs                    Card, Column, Board: rules every slice shares
    Result.cs
  Infrastructure/
    InMemoryBoardRepository.cs
  Program.cs                    app.MapGetBoard(); app.MapMoveCard(); ...
```

One slice, using the capstone's real types:

```csharp
// ProblemFor is the capstone's Problem() helper, moved to a shared file
public static class MoveCard
{
    public record Request(string? ToColumn, int Position);

    public static void MapMoveCard(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/cards/{id:guid}/move", (Guid id, Request req, IBoardRepository repo) =>
        {
            var board = repo.Load();
            var result = board.MoveCard(id, req.ToColumn, req.Position);
            if (!result.Ok) return ProblemFor(result.Error!);
            repo.Save(board);
            return Results.Ok(result.Value);
        });
}
```

"Archive a card" is one new file. Deleting a feature is deleting a file. Slices
can differ: a report slice can use raw SQL while a command slice uses the
domain model. The risk is duplication between slices, which you fix by pushing
real rules down into `Domain/`, exactly where `Board` already lives.

## Clean Architecture

Clean, Onion and Hexagonal (ports and adapters) are one idea: **dependencies
point inwards.** The domain references nothing; the application layer defines
interfaces (ports) it needs; infrastructure implements them (adapters); the
API wires everything together.

```
src/
  Kanban.Domain/            Board, Column, Card, Result: no references at all
  Kanban.Application/       IBoardRepository (a port), AddCardHandler,
                            MoveCardHandler, request and response DTOs
  Kanban.Infrastructure/    InMemoryBoardRepository, later EfBoardRepository
  Kanban.Api/               Program.cs, endpoints, DI wiring
tests/
  Kanban.Domain.Tests/
  Kanban.Application.Tests/
```

What you actually get: the compiler enforces the direction (Domain cannot
reference EF Core because the project reference does not exist), and the core
logic is testable with no database. What it costs: four projects, an interface
for nearly everything, and a feature that still touches three or four projects.
For a kanban board whose whole domain is one `MoveCard` rule, that is a lot of
ceremony guarding very little.

## What each shape costs

| | Layers | Vertical slices | Clean |
|---|---|---|---|
| Projects | 1 | 1 | 4 or more |
| Files touched to add "archive card" | 4–5 across folders | 1 (plus a `Board` method if it is a rule) | 4–6 across projects |
| Where a rule lives | Drifts into services | Domain, shared by slices | Domain, enforced by references |
| Indirection | Medium | Low | High |
| Onboarding | Instant: everyone knows it | Easy: find the feature file | Slow: learn the project map |
| Fits | Small apps, teams used to it | Most CRUD APIs | Rich domains, long-lived systems |

The position to take, and defend:

> "Vertical slices by default. Clean Architecture only when there is a domain
> worth protecting: pricing rules, scheduling, anything with real invariants
> that outlives its framework. MediatR is optional plumbing, not architecture."

## CQRS-lite and MediatR

**CQRS** at this level means separating reads from writes in code, not
databases. Commands go through the domain model with validation and change
tracking; queries skip it and project straight to a DTO, often
`AsNoTracking()` or raw SQL. Vertical slices make this natural, because a query
slice and a command slice are different files anyway.

**MediatR** sends a request object to its handler, with pipeline behaviours
for cross-cutting concerns (logging, validation). It is a tidy way to organise
slices, but a minimal API endpoint calling a handler directly does the same job
with one less hop, and ASP.NET Core filters and middleware cover the
cross-cutting part. MediatR and AutoMapper moved to commercial licences in 2025
(with a free community tier), which is why many teams now ask "do we need it?"
before adding it. Check the current terms before you do.

## DTOs and mapping

Never return entities from an endpoint; map them to DTOs so a new column cannot
leak. Write the mapping by hand:

```csharp
static CardDto ToDto(Card c) => new(c.Id, c.Title);
```

Manual mapping is visible in a diff, found by "go to definition", and fails at
compile time when a property is renamed. A mapper library saves a few lines
and turns those errors into runtime surprises. For EF queries, project with
`Select` so the mapping happens in SQL.

## Monolith, modular monolith, microservices

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deployables | 1 | 1 | Many |
| Boundaries | Folders | Modules with enforced public APIs | Network calls |
| Cross-module call | Method call | Method call through an interface | HTTP or a queue: can fail, time out, retry |
| Transactions | One database transaction | Still one | Gone: sagas and eventual consistency |

Distribution turns method calls into network failures, one transaction into a
saga, and one deploy into a coordination problem. Split when a team or scaling
boundary genuinely forces it: separate teams blocking each other's releases,
or one component with wildly different load. A **modular monolith** gets most
of the benefit of clear boundaries without paying for the network. "Monolith
first, split along the seams that hurt" is the answer.

## Recording the decision: ADRs

An **Architecture Decision Record** is a one-page Markdown file in the repo,
numbered, never edited once accepted (a later ADR supersedes it):

```markdown
# ADR 004: Vertical slices for the kanban API

Status: Accepted, 2026-09-01

**Context.** Endpoints are growing past 20. BoardService is edited by every
feature.

**Decision.** One file per feature under Features/. Rules stay on Board.
No MediatR.

**Consequences.**
Features are added and removed as single files. Some request validation
repeats between slices; shared rules must be pushed into Domain/.
```

Six months later, "why is it like this?" has an answer that does not depend on
who is still on the team.

## What you should be able to answer

- Clean Architecture: what are the benefits and what are the costs?
- Service layer or vertical slices for a new API, and why?
- What is the anaemic domain model, and how do you avoid it?
- Would you use MediatR in a new project?
- What does CQRS mean without separate databases?
- Manual mapping or a mapper library?
- When would you split a monolith, and what does a modular monolith buy you?
- What goes in an ADR?
- How would you structure the kanban API if it grew to 40 endpoints?
