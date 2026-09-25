# Working in a legacy codebase

Most jobs are not green-field. You will join a team with a ten-year-old codebase, patchy tests, three ways of doing the same thing and a module everyone is scared of. Interviewers ask "How would you approach an unfamiliar legacy system?" or "Tell me about changing code you did not understand" because the honest answer separates developers who make things safer from those who make them worse. This guide is a practical method.

## What "legacy" actually means

Michael Feathers' definition is the useful one: **legacy code is code without tests.** Age is not the problem; the problem is that you cannot change it with confidence, so every change is slow and risky. That definition points at the fix. The goal is not to rewrite the system; it is to make the parts you need to change safe to change, one at a time.

## Reading a codebase you did not write

Do not start by reading every file. Start from behaviour:

1. **Run it locally**, and write down every setup step that was missing from the README (then add them; it is your first useful PR).
2. **Follow one real request end to end.** Pick an important endpoint, set a breakpoint or add logging, and trace it from the route to the database and back. One traced path teaches more than a day of reading.
3. **Use history as documentation.** Commit messages and linked tickets often explain the strange line:

   ```bash
   git log --follow -p -- src/Billing/InvoiceCalculator.cs   # the file's full history
   git log -S "legacyRoundingMode" --oneline                 # commits that added or removed a string
   git blame -w -C src/Billing/InvoiceCalculator.cs          # who last changed each line, ignoring moves
   ```

4. **Ask the people**, with specific questions: "Why does the invoice total round twice?" gets a better answer than "How does billing work?"
5. **Look at production data and logs.** Which code paths actually run? The branch for a payment provider you stopped using in 2021 may be dead.

Write what you learn somewhere others will find it: a short module overview, a diagram, or comments where the code surprised you.

## Characterisation tests: pin the behaviour first

Before changing code without tests, write tests that record what it **currently does**, not what you think it should do. These are characterisation tests:

```csharp
[Theory]
[InlineData("100.005", "100.01")]   // recorded from the current code
[InlineData("19.994", "19.99")]
public void Total_matches_current_behaviour(string net, string expected)
{
    var calc = new InvoiceCalculator(new FixedTaxRates(0m));
    var total = calc.Total(decimal.Parse(net, CultureInfo.InvariantCulture));
    Assert.Equal(decimal.Parse(expected, CultureInfo.InvariantCulture), total);
}
```

If a result looks wrong, write the test for the current result anyway and flag it: changing behaviour is a separate decision, possibly with customers depending on the bug. For code with a lot of output (reports, emails, JSON), **snapshot or approval tests** capture the whole output and fail when anything changes. At the API level, integration tests with `WebApplicationFactory` or Supertest pin behaviour without touching the internals; see [testing .NET APIs](dotnet-testing.md) and [the integration testing project](../../csharp/35-integration-testing/).

## Seams: making untestable code testable

Legacy code is often hard to test because it creates its own dependencies: `new SmtpClient()`, `DateTime.Now`, static helpers that hit the database. A **seam** is a place where you can change behaviour without editing the code under test. The safest ways to create one, each a small mechanical step:

| Problem | Seam |
| --- | --- |
| Calls `DateTime.Now` / `new Date()` | Inject `TimeProvider` (.NET 8+) or a clock function |
| Constructs its own dependency with `new` | Extract an interface, pass it in through the constructor |
| Calls a static helper | Wrap the static in an instance class, inject that |
| Giant method doing five things | Extract methods with IDE refactorings, no logic changes |

Use your IDE's automated refactorings (extract method, introduce parameter, rename) rather than editing by hand; they are much less likely to change behaviour. Commit each step separately so a reviewer can see that nothing but structure changed. [Dependency injection explained](dependency-injection-explained.md) covers the injection side.

## Making the change

With the behaviour pinned and a seam in place, the change itself is ordinary work:

- **Keep refactoring and behaviour changes in separate commits, ideally separate PRs.** "Refactor only, all tests unchanged" is quick to review; a mixed PR is not.
- **Leave it better than you found it, locally.** Improve names and structure in the code you touch, not the whole module.
- **Put risky changes behind a feature flag** so you can turn them off without a deploy, and compare old and new behaviour on real traffic if it is critical (run both, log differences, serve the old result).
- **Deploy in small steps.** A week of small, reversible deploys is far safer than one big one.

## Rewrite or refactor?

Rewrites are tempting and usually a mistake. The old system contains years of bug fixes and edge cases nobody remembers; a rewrite rediscovers them one incident at a time, while the business waits for features. Prefer the **strangler fig** approach: put a routing layer in front, build new functionality (or replace one area at a time) in the new code, route that traffic to it, and retire the old parts once nothing uses them. Each step delivers value and can be stopped.

A full rewrite can be justified when the platform itself is dead (unsupported runtime, no security patches) and the system is small enough to replace in weeks, not years. Even then, migrate incrementally where you can: .NET Framework to modern .NET, for example, is usually done project by project behind the same interface. In JavaScript, [migrating to TypeScript](typescript-declarations-and-migration.md) file by file is the same idea.

## Dependencies and upgrades

Legacy systems often sit on old versions: an end-of-life Node release, .NET Core 3.1, a React version two majors behind. Treat upgrades as regular, small work rather than a heroic project every few years:

- Upgrade one major version at a time and read each version's breaking-changes notes.
- Let automated tools (Dependabot, Renovate) open small upgrade PRs continuously, with tests as the safety net.
- Prioritise anything with known security vulnerabilities or an end-of-support date; say that in business terms when asking for time.

## Being effective, and staying positive

Complaining about the old code is easy and wins you nothing; the people who wrote it may still be on the team, and they made reasonable decisions with what they knew. Frame problems as costs ("changes to billing take three days because nothing is tested") and propose bounded improvements. A new joiner who adds the missing setup steps, writes the first tests around a scary module and makes one area safer to change earns more trust than one who proposes a rewrite in week two. The [debugging playbook](debugging-playbook.md) is a good companion for the investigation side.

## What you should be able to answer

- What makes code "legacy", and why does that definition matter?
- You have to change a module you do not understand and it has no tests. What do you do first?
- What is a characterisation test, and what do you do if it records behaviour that looks wrong?
- What is a seam? Give an example of creating one around `DateTime.Now` or a hard-coded dependency.
- When would you rewrite a system rather than refactor it, and what is the strangler fig pattern?
- How do you ask for time to improve legacy code without sounding like you are complaining?
