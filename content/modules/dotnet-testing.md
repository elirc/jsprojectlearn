# Testing .NET APIs: xUnit, WebApplicationFactory and Testcontainers

"How would you integration-test this endpoint?" comes up in nearly every .NET
interview, and the good answer is specific: a real HTTP pipeline in memory, a
real database in a container, and fakes only at the edges you don't own. This
guide is that answer, with the 2025 licence changes interviewers like to ask
about. [csharp/35](../../csharp/35-integration-testing/) is the project to
build alongside it.

## Frameworks and lifecycle

xUnit is the default for new projects, and **xUnit v3** is the current major.
NUnit and MSTest are both alive and fine; you'll meet them in older codebases.

```cs
public class PriceCalculatorTests
{
    [Fact]
    public void Applies_ten_percent_over_100()
        => new PriceCalculator().Total(120m).ShouldBe(108m);

    [Theory]
    [InlineData(0, 0)]
    [InlineData(99.99, 99.99)]
    [InlineData(100, 90)]
    public void Discount_boundaries(decimal input, decimal expected)
        => new PriceCalculator().Total(input).ShouldBe(expected);
}
```

xUnit creates a **new instance of the class for every test**, so fields are
never shared between tests. Setup goes in the constructor, teardown in
`Dispose`/`DisposeAsync`. Expensive shared things (a container, a
`WebApplicationFactory`) go in a fixture: `IClassFixture<T>` for one class,
`ICollectionFixture<T>` for a named group, and in v3 an assembly fixture for the
whole run. Async setup uses `IAsyncLifetime`, whose methods return `ValueTask`
in v3. Other v3 changes: test projects are executables, and
`TestContext.Current.CancellationToken` gives you a token that fires when a run
is cancelled or times out.

## Assertions: built-in, Shouldly, and the licence question

xUnit's `Assert.Equal(expected, actual)` works, but argument order is easy to
swap and failure messages are terse. This guide uses **Shouldly**:
`total.ShouldBe(108m)` and `await Should.ThrowAsync<ValidationException>(act)`,
with messages that print the expression that failed.

In January 2025 **FluentAssertions v8** moved to a paid commercial licence for
commercial use. v7 remains Apache 2.0. Teams pinned v7, moved to Shouldly, or
switched to the community fork AwesomeAssertions. Knowing this, and that a
dependency's licence can change under you, reads as real-world experience.

## Test doubles: prefer fakes

A **fake** is a working, simple implementation: an in-memory repository, an
email sender that appends to a list. A **mock** is configured per test to
return values and verify calls. Fakes survive refactoring; mocks that verify
every call break whenever the implementation changes, even if behaviour didn't.

When you do need a mock, **NSubstitute** reads well:

```cs
var email = Substitute.For<IEmailSender>();
var service = new OrderService(new InMemoryOrders(), email, TimeProvider.System);

await service.PlaceAsync(order, CancellationToken.None);

await email.Received(1).SendConfirmationAsync(order, Arg.Any<CancellationToken>());
```

Moq is still common, but in August 2023 version 4.20.0 shipped SponsorLink,
which read developers' git email addresses during builds and sent hashes of
them to a remote service. It was pulled within days. The lesson interviewers
want is supply-chain hygiene: lock files, reviewing dependency updates, and
noticing when a minor version adds a new dependency.

## Time and randomness

Code that calls `DateTime.UtcNow` cannot be tested at 23:59 on the last day of
the month. Inject `TimeProvider` (.NET 8+) and use `FakeTimeProvider` from
`Microsoft.Extensions.TimeProvider.Testing` in tests:

```cs
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 1, 31, 23, 59, 0, TimeSpan.Zero));
var tokens = new ResetTokenService(clock);
var token = tokens.Issue(userId);

clock.Advance(TimeSpan.FromMinutes(61));
tokens.IsValid(token).ShouldBeFalse();
```

Randomness works the same way: inject a seeded `Random` or an interface over it.

## Integration tests with WebApplicationFactory

`WebApplicationFactory<Program>` (package `Microsoft.AspNetCore.Mvc.Testing`)
boots your real `Program.cs` against an in-memory server. You get the real
routing, model binding, validation, filters and serialisation, and an
`HttpClient` that talks to it without a network.

```cs
public class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender, FakeEmailSender>();
        });
    }
}

public class OrdersApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Post_with_no_items_returns_400()
    {
        var res = await factory.CreateClient().PostAsJsonAsync("/orders", new { items = Array.Empty<object>() },
            TestContext.Current.CancellationToken);
        res.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
```

`ConfigureTestServices` runs after your own registrations, so it can replace
them. The [DI guide](dependency-injection-explained.md) explains why that works.

**About `Program`:** top-level statements generate an `internal` `Program`
class, which a separate test project can't reference. Up to .NET 9 you add
`public partial class Program { }` at the bottom of `Program.cs` (or grant
`InternalsVisibleTo` to the test project). .NET 10's web SDK generates that
public declaration for you, and analyzer ASP0027 marks the hand-written line
as redundant. You will still see it in almost every codebase, and it does no
harm.

## A real database with Testcontainers

The EF Core InMemory provider is not a database. It ignores constraints and
transactions, doesn't translate your LINQ to SQL, and accepts queries Postgres
would reject. The [ORM guide](orm-and-ef-core.md) covers why that makes tests
pass that should fail. Run the real engine in Docker instead, by growing the
factory from the previous section:

```cs
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder()
        .WithImage("postgres:17-alpine").Build();

    public async ValueTask InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDb>().Database.MigrateAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseSetting("ConnectionStrings:Default", _db.GetConnectionString());

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _db.DisposeAsync();
    }
}
```

Apply your real migrations in setup, so the tests also prove the migrations
work. Reset data between tests with **Respawn**, which deletes rows from every
table in dependency order and is far faster than recreating the database. The
alternative is wrapping each test in a transaction you roll back, which breaks
as soon as the code under test opens its own.

## Auth in tests

Don't mint real JWTs. Register a test authentication scheme whose handler
signs in whoever the test asks for:

```cs
services.AddAuthentication("Test")
    .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
```

`TestAuthHandler` reads a header such as `X-Test-User` and builds a
`ClaimsPrincipal` with the claims and roles you pass, or returns
`AuthenticateResult.NoResult()` if the header is missing. Now you can test the
three cases that matter: no user gets **401**, the wrong user or role gets
**403**, and the right user gets **200**. Getting 401 and 403 the wrong way round
is a common bug and a common question.

## Snapshots and contract drift

For large responses, asserting 40 properties by hand is noise. **Verify**
serialises the result to a `.verified.txt` file committed next to the test;
the next run fails if the output changes, and you approve or reject the diff.
It doubles as a contract check: an accidental rename of a JSON property shows up
in review as a changed snapshot rather than as a broken client in production.

## Running in CI

`dotnet test` runs everything. xUnit v3 supports **Microsoft.Testing.Platform**,
the newer runner that .NET 10's `dotnet test` can use natively. Coverage comes
from coverlet (`--collect:"XPlat Code Coverage"`) or the Microsoft code
coverage extension. Test classes run in parallel by default and tests within a
class run sequentially. Share one database container per collection or per
assembly rather than one per class, or CI spends most of its time starting
Postgres. CI runners need Docker for Testcontainers; GitHub's Linux runners have
it. The [testing strategy guide](testing-strategy.md) covers how many of each
kind of test to write.

## What you should be able to answer

- How would you integration-test a minimal API endpoint that writes to a database?
- Why not use the EF Core InMemory provider for those tests?
- How do you test code that depends on the current time?
- Mock or fake: which do you prefer, and when do you use the other?
- How do you test that an endpoint returns 401 to anonymous users and 403 to the wrong role?
- Why do some `Program.cs` files end with `public partial class Program { }`?
