# Decisions

Your decision records, postmortems and design docs about this repo live
here. The folder is committed and each file arrives through a PR. Senior
engineers make decisions in public so that the next person can find the
reasoning without asking.

## Naming

| Kind | Filename | Template |
|---|---|---|
| Decision record | `NNNN-kebab-title.md`, numbered from `0001`, never reused | [decision-record.md](../templates/decision-record.md) |
| Postmortem | `postmortem-YYYY-MM-DD-kebab-title.md` | [postmortem.md](../templates/postmortem.md) |
| Design doc | `design-kebab-title.md` | [design-doc.md](../templates/design-doc.md) |

Worked examples of each are in [../examples/](../examples/). The
[step-key decision record](../examples/decision-record-step-keys.md) is the
one to read first.

## When to write a decision record

Write one when any of these is true:

- the choice is expensive to reverse: storage keys, URL shapes, content
  schemas, anything already persisted in users' browsers;
- it affects someone other than you;
- you had to argue for it, or you spent more than 30 minutes choosing.

Write it *before* the code. A record written after the merge describes what
you did. A record written before shows what you considered, which is the
part a reviewer can still influence.

## Statuses

- **Proposed**: written, under discussion.
- **Accepted**: decided. The date is the day it was accepted.
- **Rejected**: considered and declined. Keep it, since the reasons are the
  value. Arc 3's decline memo lands here with this status.
- **Superseded by NNNN**: replaced by a later record. Edit only the status
  line and link forward; never rewrite the body.

## Rules

- Every fact cites a file and symbol, or a number with its command and date.
- The Options section includes "do nothing" and at least two other options
  that are real in this codebase.
- The "Revisit when" line is a trigger someone could observe, not "later".
- No code files here. See the [folder rules](../README.md#folder-rules).
