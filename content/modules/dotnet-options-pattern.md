# Configuration and the options pattern in .NET

"How does configuration work in ASP.NET Core?" sounds like a warm-up, but the
follow-ups — which source wins, `IOptions` vs `IOptionsSnapshot` vs
`IOptionsMonitor`, how you fail fast on a missing setting — separate people who
have shipped .NET services from people who have copied `Program.cs`. The
language-agnostic principles (twelve-factor config, secret hygiene) are in
[env-config-secrets.md](env-config-secrets.md); this guide is the .NET
machinery.

## Providers and precedence

`WebApplication.CreateBuilder` assembles one `IConfiguration` from several
providers. Each later provider overrides keys from earlier ones:

| Order | Provider | Notes |
|-------|----------|-------|
| 1 | `appsettings.json` | Committed defaults, no secrets |
| 2 | `appsettings.{Environment}.json` | e.g. `appsettings.Development.json` |
| 3 | User secrets | Development only, when the project has a `UserSecretsId` |
| 4 | Environment variables | `__` (double underscore) stands in for `:` |
| 5 | Command-line arguments | `--Smtp:Port=2525` |

The environment name comes from `ASPNETCORE_ENVIRONMENT` (or
`DOTNET_ENVIRONMENT`) and defaults to **Production** if unset. Locally,
`Properties/launchSettings.json` sets it to Development; that file is not used
when you deploy, which is why a forgotten variable on a server silently gives
you Production settings.

Everything flattens to colon-separated keys, case-insensitively:

```json
{
  "ConnectionStrings": { "Default": "Host=localhost;Database=app" },
  "Smtp": { "Host": "localhost", "Port": 1025, "Recipients": ["ops@example.com"] }
}
```

```cs
var cs   = builder.Configuration.GetConnectionString("Default"); // ConnectionStrings:Default
var port = builder.Configuration.GetValue<int>("Smtp:Port");
var first = builder.Configuration["Smtp:Recipients:0"];           // arrays are indexed keys
```

To override `Smtp:Port` in a container, set `Smtp__Port=2525`. Colons are not
valid in environment variable names on every platform, which is why the double
underscore exists.

## From loose strings to typed options

Reading `Configuration["Smtp:Host"]` all over the codebase spreads magic
strings and defers typos to runtime. The options pattern binds a section to a
class once:

```cs
public sealed class SmtpOptions
{
    public const string Section = "Smtp";

    [Required] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; } = 25;
    [Required] public string FromAddress { get; set; } = "";
    public string? Password { get; set; }
}

builder.Services.AddOptions<SmtpOptions>()
    .BindConfiguration(SmtpOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

`BindConfiguration("Smtp")` binds from the app's `IConfiguration` without you
passing it in; `.Bind(builder.Configuration.GetSection("Smtp"))` is the
explicit equivalent, and `services.Configure<SmtpOptions>(section)` is the
older shorthand without the validation chain. The binder matches property
names case-insensitively and needs public settable properties (or `init`).
Unknown keys are ignored, so a typo in JSON simply leaves the default in place
— another reason to validate.

Consumers take `IOptions<SmtpOptions>` (or one of its siblings) rather than
`IConfiguration`, which keeps them testable with `Options.Create(new SmtpOptions { ... })`.

## Validation, and failing at startup

Without `ValidateOnStart()`, validation runs lazily the first time something
reads `.Value` — which might be the first password-reset email in production,
hours after deploy. With it, the host throws `OptionsValidationException`
during startup and the deployment fails its health check instead.

You have three ways to express rules:

```cs
// 1. Attributes, as above: .ValidateDataAnnotations()

// 2. A delegate for cross-property rules
.Validate(o => o.Port != 25 || o.Host == "localhost", "Port 25 is only allowed for a local relay.")

// 3. A class, when rules need services or grow large
public sealed class SmtpOptionsValidator : IValidateOptions<SmtpOptions>
{
    public ValidateOptionsResult Validate(string? name, SmtpOptions o) =>
        o.FromAddress.EndsWith("@example.com")
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail("FromAddress must be on example.com.");
}
builder.Services.AddSingleton<IValidateOptions<SmtpOptions>, SmtpOptionsValidator>();
```

`ValidateDataAnnotations()` uses reflection and does **not** recurse into
nested objects. Since .NET 8 there is a source-generated alternative:

```cs
[OptionsValidator]
public partial class SmtpOptionsGeneratedValidator : IValidateOptions<SmtpOptions> { }
```

The generator writes the `Validate` method from the DataAnnotations on
`SmtpOptions` at compile time — trimming- and Native-AOT-safe — and nested
objects or collections are validated when you mark them with
`[ValidateObjectMembers]` or `[ValidateEnumeratedItems]`. Register it as an
`IValidateOptions<SmtpOptions>` singleton like the hand-written one.

## IOptions vs IOptionsSnapshot vs IOptionsMonitor

| Interface | Lifetime | Reload? | Named options? | Use when |
|-----------|----------|---------|----------------|----------|
| `IOptions<T>` | Singleton | No — bound once, on first `.Value` | No | Settings that never change at runtime (most of them) |
| `IOptionsSnapshot<T>` | Scoped | Yes — recomputed per request | `Get(name)` | Per-request consumers that should see edits |
| `IOptionsMonitor<T>` | Singleton | Yes — `CurrentValue` is always current | `Get(name)` | Singletons and background services; change notifications |

```cs
public sealed class FeatureGate(IOptionsMonitor<FeatureOptions> monitor, ILogger<FeatureGate> log)
{
    private readonly IDisposable? _sub = monitor.OnChange(o =>
        log.LogInformation("Features reloaded: beta={Beta}", o.BetaEnabled));

    public bool BetaEnabled => monitor.CurrentValue.BetaEnabled;
}
```

The classic bug: injecting `IOptionsSnapshot<T>` into a singleton. It is
scoped, so the container refuses in Development (scope validation), and in any
case the singleton would hold one stale snapshot forever. Use
`IOptionsMonitor<T>` there. The lifetime reasoning is the same as in
[dependency-injection-explained.md](dependency-injection-explained.md).

## Reload on change

The web builder adds the JSON files with `reloadOnChange: true`, so editing
`appsettings.json` on a running server updates `IConfiguration` without a
restart — but only consumers using `IOptionsSnapshot`/`IOptionsMonitor` or
reading `IConfiguration` directly will notice. `IOptions<T>` keeps its first
value. Environment variables and command-line arguments never reload: they are
read once at process start.

In containers, config mounted from a Kubernetes ConfigMap is swapped via
symlinks that the default file watcher can miss; setting
`DOTNET_USE_POLLING_FILE_WATCHER=true` switches to polling. In practice most
teams treat config as immutable per deployment and restart to change it, which
is simpler to reason about.

## Named options

When you have several instances of the same shape — two outbound HTTP APIs, two
storage accounts — register them by name:

```cs
builder.Services.AddOptions<ApiClientOptions>("github").BindConfiguration("Apis:GitHub");
builder.Services.AddOptions<ApiClientOptions>("stripe").BindConfiguration("Apis:Stripe");

public sealed class Clients(IOptionsMonitor<ApiClientOptions> options)
{
    public ApiClientOptions GitHub => options.Get("github");
}
```

`IOptions<T>.Value` always returns the default (unnamed) instance, so named
options need `IOptionsSnapshot` or `IOptionsMonitor`. Validation delegates and
`IValidateOptions<T>` receive the name, so rules can differ per instance.

## Secrets in .NET

In development, use user secrets rather than `appsettings.Development.json`:

```sh
dotnet user-secrets init
dotnet user-secrets set "Smtp:Password" "local-dev-password"
```

They live in your user profile (`%APPDATA%\Microsoft\UserSecrets\<id>\secrets.json`
on Windows, `~/.microsoft/usersecrets/<id>/secrets.json` elsewhere), outside
the repo — but they are plain text, not encrypted. They are loaded only in the
Development environment.

In production, inject secrets as environment variables from your platform, or
read them from a vault provider. With Azure Key Vault
(`Azure.Extensions.AspNetCore.Configuration.Secrets`):

```cs
builder.Configuration.AddAzureKeyVault(
    new Uri("https://my-vault.vault.azure.net/"), new DefaultAzureCredential());
```

A secret named `Smtp--Password` surfaces as `Smtp:Password`, and because the
provider is added last it overrides the JSON files. `DefaultAzureCredential`
uses managed identity in Azure and your developer login locally, so no
credential is committed anywhere. Never commit a real connection string to
`appsettings.json`, even "temporarily": it lives in git history.

Configuration can also leak through logs; avoid logging bound options objects
wholesale. The [config and options project](../../csharp/22-config-and-options/)
wires all of this up.

## What you should be able to answer

- List the default configuration providers in precedence order. How would you override `Smtp:Port` in a container?
- What does `ValidateOnStart()` change, and why does it matter for deployments?
- Compare `IOptions<T>`, `IOptionsSnapshot<T>` and `IOptionsMonitor<T>` by lifetime and reload behaviour. Which do you inject into a singleton?
- Why does `ValidateDataAnnotations()` miss errors in nested objects, and what does the `[OptionsValidator]` source generator fix?
- When do you need named options, and how do you read them?
- Where do secrets live in development and in production for a .NET app, and why are user secrets not a production mechanism?
