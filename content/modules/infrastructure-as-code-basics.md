# Infrastructure as code basics

Most teams no longer click databases and load balancers together in a cloud
console; they describe them in code, review them in pull requests and apply
them from a pipeline. As an application developer you will read these files,
add a bucket or a queue for your feature, and occasionally review a plan that
wants to destroy the production database. Interviewers ask about state, drift,
plan-and-apply and environments, because those are where IaC goes wrong.

## Why code instead of clicks

| Clicked in a console | Defined as code |
| --- | --- |
| staging and production drift apart silently | both come from one definition, differences are explicit |
| "who changed the firewall?" has no answer | every change is a reviewed, attributable commit |
| rebuilding after a disaster means remembering | rebuilding means running the same code |
| a new environment takes a week | a new environment is a variables file |

IaC is also documentation that cannot go stale: the code is what exists,
provided nobody changes things by hand (see drift, below).

## Declarative, idempotent, diff-based

Mainstream IaC tools are **declarative**: you describe the desired end state,
not the steps. The tool compares desired state with reality and performs only
the difference. Running it twice changes nothing the second time; that property
is **idempotence**, and it is what a bash script of `create` commands lacks.

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = "acme-uploads-prod"
  tags   = { env = "prod", owner = "orders-team" }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}
```

The reference `aws_s3_bucket.uploads.id` tells the tool about a dependency, so
it creates the bucket before configuring versioning. You do not order
operations yourself.

## The tool landscape

| Tool | Language | Scope | Notes |
| --- | --- | --- | --- |
| Terraform / OpenTofu | HCL | any provider | the most common; OpenTofu is the open-source fork after Terraform's licence change |
| Bicep | Bicep DSL | Azure | compiles to ARM templates; state lives in Azure itself |
| CloudFormation | YAML / JSON | AWS | AWS-managed state and rollbacks |
| AWS CDK | TypeScript, C#, Python... | AWS | real code that synthesises CloudFormation |
| Pulumi | TypeScript, C#, Python, Go | any provider | real code, Terraform-like state |

"Real code" tools let you use loops, functions and types, and let a TypeScript
or C# team stay in one language. They are still declarative underneath: the
program builds a description, and the engine diffs it. The risk is cleverness:
infrastructure code should be boring and obvious.

## State: the tool's memory

Terraform, OpenTofu and Pulumi keep a **state file** that maps each resource in
your code to the real resource it manages (`aws_s3_bucket.uploads` is bucket
`acme-uploads-prod`, with these attributes). Without it, the tool cannot tell
"create a new bucket" from "this bucket already exists".

Rules for state:

- **Store it remotely** (an S3 bucket, Azure Storage, Terraform Cloud), never on
  a laptop and never in git. It often contains secrets in plain text.
- **Lock it** so two applies cannot run at once and corrupt it. Remote backends
  provide locking.
- **Restrict access** like you would to production credentials.

Bicep and CloudFormation avoid a separate state file because the cloud provider
tracks deployments itself.

## Plan, review, apply

The workflow that makes IaC safe:

```sh
terraform fmt -check
terraform validate
terraform plan -out=tfplan      # in the pull request
terraform apply tfplan          # after merge, from CI
```

The plan is a readable diff of real changes:

```txt
  # aws_db_instance.main must be replaced
-/+ resource "aws_db_instance" "main" {
      ~ identifier = "orders-db" -> "orders-db-prod" # forces replacement
        ...
    }
Plan: 1 to add, 0 to change, 1 to destroy.
```

That `forces replacement` line is the one to catch in review: renaming some
attributes means **destroy and recreate**, and for a database that means data
loss. Post the plan as a PR comment, require review from someone who reads it,
and apply only from the main branch through CI, using OIDC credentials rather
than stored keys.

Guard the resources you can never lose:

```hcl
resource "aws_db_instance" "main" {
  # ...
  deletion_protection = true
  lifecycle {
    prevent_destroy = true
  }
}
```

`prevent_destroy` makes any plan that would destroy the resource fail, and the
provider's deletion protection stops deletion even outside Terraform.

## Modules and environments

A **module** is a reusable group of resources with inputs and outputs, such as
"an API service with its load balancer, security groups and alarms". Environments
then become small files that call the same modules with different values:

```txt
infra/
  modules/
    api-service/        # main.tf, variables.tf, outputs.tf
    postgres/
  envs/
    staging/            # main.tf calls modules; staging.tfvars
    prod/               # same modules; prod.tfvars
```

```hcl
module "orders_api" {
  source        = "../../modules/api-service"
  name          = "orders-api"
  instance_size = var.api_size        # small in staging, larger in prod
  min_instances = var.api_min
}
```

Keep environment differences to sizes, counts and names. If staging and
production diverge structurally, staging stops predicting production. Separate
state per environment (and ideally separate cloud accounts) so a mistake in
staging cannot touch production.

## Drift and import

**Drift** is when reality differs from the code, usually because someone fixed
something by hand in the console during an incident. The next plan will try to
revert it. Either codify the change or let the apply revert it, and restrict
console write access in production so drift stops happening. Scheduled
`terraform plan -detailed-exitcode` runs in CI can detect drift early.

**Import** brings an existing, hand-made resource under management without
recreating it. Write the matching resource block, then:

```hcl
import {
  to = aws_s3_bucket.legacy_reports
  id = "acme-legacy-reports"
}
```

Run a plan; once the code matches reality, it shows no changes. Nearly every
team adopting IaC has to import their existing production resources this way.

## Secrets and IaC

Do not write secret values into IaC code or variables files in git. Two safer
patterns:

- IaC creates the **secret container** (a Key Vault, a Secrets Manager entry)
  and grants the app's identity access; the value is set separately or
  generated by the platform.
- IaC generates a random password and writes it straight into the secret
  store, accepting that it will also appear in state, which is why state
  access is restricted.

The app then reads the secret at runtime (see
[env-config-secrets](env-config-secrets.md)).

## Boundaries and guardrails

| In IaC | Usually elsewhere |
| --- | --- |
| networks, databases, buckets, queues, DNS records | application code and its build |
| IAM roles and policies, secret containers | secret values |
| alarms, dashboards, budgets | per-request feature flags |
| container services and their scaling rules | the image version, set by the deploy pipeline |

The line between "infrastructure" and "deployment" varies. A common split is
that IaC defines the service and the pipeline updates only the image tag, so a
code deploy does not need an infrastructure plan.

### Checking IaC before it runs

Treat infrastructure code like application code: format and validate in CI,
lint with `tflint`, and scan with policy tools such as Checkov or Trivy, which
flag public buckets, unencrypted databases and `0.0.0.0/0` rules before they
exist. Pin provider versions with a lock file so a provider upgrade does not
change behaviour silently.

## What you should be able to answer

- What problem does infrastructure as code solve that a runbook of console
  steps does not?
- What is Terraform state, where should it live, and why does it need locking?
- Why run `plan` in the pull request and `apply` after merge? What do you look
  for in a plan?
- What is drift, how does it happen, and how do you prevent it?
- How would you structure code for staging and production without copy-paste?
- How do you bring a database created by hand under IaC without downtime?
