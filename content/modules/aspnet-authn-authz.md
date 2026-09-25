# Authentication and authorization in ASP.NET Core

The generic ideas — sessions versus tokens, password hashing, CSRF — are in
[auth-sessions-jwt.md](auth-sessions-jwt.md). .NET interviews then ask how the
framework actually implements them: what a scheme is, why a valid JWT still
gives you a 401, how a policy differs from a role check, and how you stop user
A editing user B's order. This guide is that layer.

## Two middlewares, two questions

**Authentication** answers *who are you?* The authentication middleware asks
the default scheme's handler to read the request (a cookie, a bearer token) and
produce a `ClaimsPrincipal`, which it stores in `HttpContext.User`. It never
rejects a request by itself; an anonymous request just gets an empty principal.

**Authorization** answers *may you do this?* The authorization middleware reads
the matched endpoint's metadata (`[Authorize]`, `.RequireAuthorization()`),
evaluates the policies against `HttpContext.User`, and either lets the request
through, **challenges** it or **forbids** it.

```cs
app.UseRouting();
app.UseAuthentication();   // populates HttpContext.User
app.UseAuthorization();    // enforces endpoint metadata
```

Order matters for the reasons in
[aspnet-middleware-pipeline.md](aspnet-middleware-pipeline.md): authorization
needs both the endpoint (from routing) and the user (from authentication).

## Claims and ClaimsPrincipal

A `ClaimsPrincipal` holds one or more `ClaimsIdentity` objects, each a bag of
`Claim`s (type/value pairs) plus the name of the scheme that produced it.

```cs
app.MapGet("/me", (ClaimsPrincipal user) => new
{
    Id = user.FindFirstValue(ClaimTypes.NameIdentifier),
    Name = user.Identity?.Name,
    IsAdmin = user.IsInRole("Admin")
}).RequireAuthorization();
```

`Identity.IsAuthenticated` is true only when the identity has an
authentication type — a `new ClaimsIdentity(claims)` with no type is anonymous,
a classic test-setup bug.

## Schemes, cookies and JwtBearer

A **scheme** is a named registration of a handler plus its options. You can
have several (cookies for the web UI, JWT for the mobile API) and choose per
endpoint. Since .NET 7, if exactly one scheme is registered it becomes the
default automatically; otherwise pass it to `AddAuthentication`.

**Cookie authentication** suits a browser app served from the same site:

```cs
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.SlidingExpiration = true;
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    });

// at login, after verifying the password:
await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
    new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
```

The principal is serialised into an encrypted cookie via Data Protection. By
default an unauthenticated request is redirected (302) to `LoginPath`; for an
API, override `OnRedirectToLogin` (and `OnRedirectToAccessDenied`) so fetch
calls get 401/403 rather than an HTML login page.

**JwtBearer** suits APIs called with `Authorization: Bearer <token>` issued by
an identity provider (Entra ID, Auth0, Keycloak):

```cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = "https://login.example.com/";  // discovers issuer and signing keys
        o.Audience = "orders-api";
        o.MapInboundClaims = false;                  // keep "sub", "role" as-is
        o.TokenValidationParameters = new TokenValidationParameters
        {
            NameClaimType = "name",
            RoleClaimType = "role",
            ClockSkew = TimeSpan.FromMinutes(1)       // default is 5 minutes
        };
    });
```

With `Authority` set, the handler downloads the OpenID Connect discovery
document and validates signature, issuer, audience and lifetime. The most
common "valid token, still 401" causes: wrong `Audience`, clock skew on
expiry, or a token for a different issuer. Turn on debug logging for
`Microsoft.AspNetCore.Authentication` to see which check failed.

**Claim-type mapping** is the other trap. By default (`MapInboundClaims =
true`) the handler renames short JWT claims to long legacy URIs: `sub` becomes
`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, `role`
becomes `ClaimTypes.Role`. Code that calls `FindFirst("sub")` then finds
nothing. Either keep the mapping and use `ClaimTypes.*`, or disable it and set
`NameClaimType`/`RoleClaimType` so `Identity.Name` and `IsInRole` still work.
Pick one consistently.

## Requiring authorization

```cs
[Authorize]                          // any authenticated user
[Authorize(Roles = "Admin")]         // role check
[Authorize(Policy = "CanPublish")]   // named policy
[AllowAnonymous]                     // opt back out
```

Minimal APIs use the same metadata through methods, usually on a route group:

```cs
var admin = app.MapGroup("/admin").RequireAuthorization("AdminOnly");
app.MapGet("/public/status", () => "ok").AllowAnonymous();
```

## Policies and custom requirements

A **policy** is a named list of requirements, all of which must succeed.
Register them with the builder API:

```cs
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("AdminOnly", p => p.RequireRole("Admin"))
    .AddPolicy("CanPublish", p => p.RequireClaim("permission", "posts:publish"))
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
```

Policies beat scattered role strings: the endpoint states *what it needs*
(`CanPublish`), and the mapping from roles or claims to that capability lives
in one place.

When a rule needs logic, write a requirement and a handler:

```cs
public sealed record MinimumAccountAgeRequirement(int Days) : IAuthorizationRequirement;

public sealed class MinimumAccountAgeHandler(TimeProvider clock)
    : AuthorizationHandler<MinimumAccountAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, MinimumAccountAgeRequirement req)
    {
        var created = context.User.FindFirstValue("created_at");
        if (DateTimeOffset.TryParse(created, out var at) &&
            clock.GetUtcNow() - at >= TimeSpan.FromDays(req.Days))
        {
            context.Succeed(req);
        }
        return Task.CompletedTask;   // not calling Succeed means "not satisfied"
    }
}

builder.Services.AddSingleton<IAuthorizationHandler, MinimumAccountAgeHandler>();
```

A handler usually does nothing rather than calling `context.Fail()`, so that
another handler for the same requirement can still succeed; `Fail()` is a veto.

## Resource-based authorization

"Only the author may edit this post" cannot be an attribute, because the
attribute runs before you have loaded the post. Load the resource, then ask
`IAuthorizationService`:

```cs
public sealed class SameAuthorRequirement : IAuthorizationRequirement;

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("EditPost", p => p.AddRequirements(new SameAuthorRequirement()));
builder.Services.AddSingleton<IAuthorizationHandler, PostAuthorHandler>();

public sealed class PostAuthorHandler : AuthorizationHandler<SameAuthorRequirement, Post>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, SameAuthorRequirement req, Post post)
    {
        if (post.AuthorId == context.User.FindFirstValue("sub")) context.Succeed(req);
        return Task.CompletedTask;
    }
}

app.MapPut("/posts/{id:int}", async (int id, UpdatePost dto, AppDbContext db,
    IAuthorizationService auth, ClaimsPrincipal user) =>
{
    var post = await db.Posts.FindAsync(id);
    if (post is null) return Results.NotFound();

    var result = await auth.AuthorizeAsync(user, post, "EditPost");
    if (!result.Succeeded) return Results.Forbid();

    post.Title = dto.Title;
    await db.SaveChangesAsync();
    return Results.NoContent();
});
```

This is the defence against insecure direct object references (IDOR). An
alternative for simple ownership is to filter the query itself
(`db.Posts.Where(p => p.Id == id && p.AuthorId == userId)`), returning 404 so
you do not confirm the post exists.

## 401 vs 403: challenge vs forbid

| Situation | Action | JwtBearer | Cookies (default) |
|-----------|--------|-----------|-------------------|
| No or invalid credentials | **Challenge** | 401 with `WWW-Authenticate: Bearer` | 302 to `LoginPath` |
| Authenticated, policy fails | **Forbid** | 403 | 302 to `AccessDeniedPath` |

`Results.Challenge()`/`Results.Forbid()` (or `Challenge()`/`Forbid()` in a
controller) trigger these explicitly. Returning 403 to an anonymous user, or 401
to a logged-in user lacking a role, are both wrong and both common.

## The fallback policy

The fallback policy applies to every endpoint **with no authorization metadata
at all**. Setting it to "authenticated user" (as above) makes the app secure by
default: a forgotten `[Authorize]` on a new endpoint fails closed. You then
mark the genuinely public endpoints with `[AllowAnonymous]`. It does not cover
files served by `UseStaticFiles` placed before `UseAuthorization`. Do not
confuse it with the *default* policy, which is what a bare `[Authorize]` means.

## Identity API endpoints and antiforgery

For first-party apps that store users themselves, .NET 8 added ready-made
endpoints on top of ASP.NET Core Identity:

```cs
builder.Services.AddIdentityApiEndpoints<IdentityUser>()
    .AddEntityFrameworkStores<AppDbContext>();

app.MapGroup("/account").MapIdentityApi<IdentityUser>();
```

You get `/register`, `/login`, `/refresh`, email confirmation, password reset
and 2FA management. `/login?useCookies=true` issues a cookie; otherwise it
returns a bearer token that is **not a JWT** but an opaque, Data
Protection-encrypted token only this app can read. That is fine for your own
SPA, not for third-party clients or other services — use a real identity
provider there. Password storage and hashing are covered in the
[password hashing project](../../csharp/23-auth-password-hashing/).

**Antiforgery** matters whenever the browser sends credentials automatically,
i.e. cookie authentication. Register `builder.Services.AddAntiforgery()` and
`app.UseAntiforgery()` (after authentication and authorization); in .NET 8+
minimal API endpoints that bind `[FromForm]` then require a valid token, and
MVC uses `[ValidateAntiForgeryToken]`. APIs authenticated only by a bearer
header are not exposed to CSRF, because the browser never attaches that header
on its own. The [fullstack auth project](../../csharp/36-fullstack-auth-notes/)
puts cookie auth, policies and ownership checks together.

## What you should be able to answer

- What does the authentication middleware do, and why does it never return 401 on its own?
- Your API accepts a valid JWT but `User.FindFirst("sub")` returns null and `IsInRole` fails. What is going on?
- Why prefer named policies over `[Authorize(Roles = "...")]`, and how do you write a custom requirement?
- How do you enforce "only the owner can edit this order", and why can an attribute not do it?
- What is the difference between challenge and forbid, and what does each return for cookies versus JWT?
- What does a fallback policy protect you from, and how does it differ from the default policy?
