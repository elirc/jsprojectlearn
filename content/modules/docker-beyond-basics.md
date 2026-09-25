# Docker beyond the basics

Once you can write a multi-stage Dockerfile (see [docker-basics](docker-basics.md)),
the interview moves on: why is the image 1.2 GB, why does the build reinstall
everything on every commit, why was the container killed with exit code 137,
and how do you get a secret into a build without baking it into a layer? This
guide covers the build, size, security, runtime and debugging questions that
separate "I have used Docker" from "I run things in Docker".

## How BuildKit caches, and how to keep the cache warm

Every Dockerfile instruction produces a layer, cached by its instruction text
and its inputs. When one layer's inputs change, that layer and **every layer
after it** rebuild. So order instructions from least to most frequently
changing: base image, system packages, dependency manifests, dependency
install, source code, build.

BuildKit (the default builder) adds two tools that matter in practice.

**Cache mounts** keep a package manager's download cache between builds without
putting it in the image:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build
```

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages dotnet restore
```

**Remote cache** matters in CI, where each runner starts empty. Export the
cache to the registry or the CI cache backend:

```sh
docker buildx build \
  --cache-from type=gha --cache-to type=gha,mode=max \
  -t ghcr.io/acme/api:"$GITHUB_SHA" --push .
```

A quick sanity check: change one source file and rebuild. If `npm ci` or
`dotnet restore` runs again, your `COPY` order is wrong or `.dockerignore` is
letting something volatile (a `.git` folder, local `node_modules`, `bin/obj`)
into the dependency layer's context.

## Choosing a base image

| Base | Size (roughly) | Shell and package manager | Notes |
| --- | --- | --- | --- |
| `node:24` / `dotnet/sdk` | large | yes | build stages only |
| `node:24-slim` (Debian) | medium | yes | safe default for Node runtime |
| `node:24-alpine` | small | yes (apk) | musl libc; some native modules misbehave |
| `dotnet/aspnet:10.0-noble-chiseled` | small | no | Ubuntu Chiseled, non-root by default |
| distroless (`gcr.io/distroless/nodejs24-debian12`) | small | no | minimal attack surface |

Smaller images pull faster, start faster and carry fewer vulnerable packages.
The cost of shell-less images is debugging: you cannot `exec` into them and run
`curl`, which is why tools like `docker debug` and Kubernetes ephemeral
containers exist. Pin the base to a specific version (`node:24.9-slim`) or, for
full reproducibility, a digest, and let Dependabot or Renovate propose updates.

## Secrets at build time

Build arguments and `ENV` values are recorded in the image history, and any
file you `COPY` in and later delete is still present in the earlier layer.
Anyone who can pull the image can read them.

When a build genuinely needs a secret (a private npm registry token, a private
NuGet feed), mount it for one instruction only:

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```sh
docker build --secret id=npmrc,src=$HOME/.npmrc .
```

The secret exists only while that `RUN` executes and never lands in a layer.
Runtime secrets (database passwords, API keys) do not belong in the image at
all; inject them as environment variables or mounted files from the platform's
secret store (see [env-config-secrets](env-config-secrets.md)).

## Hardening the running container

- **Run as non-root.** Official Node images ship a `node` user; .NET images set
  `APP_UID`. Files copied earlier are owned by root, so use
  `COPY --chown=node:node` for anything the app must write.
- **Read-only root filesystem** where the platform allows it, with a writable
  `tmpfs` for `/tmp`. An attacker who gets code execution cannot drop files.
- **Drop Linux capabilities** you do not need (`--cap-drop=ALL`), and never run
  `--privileged` for an application container.
- **Scan images** in CI (`docker scout`, Trivy, Grype) and fail on critical
  vulnerabilities with a fix available. Most findings come from the base image,
  so rebuilding regularly on a patched base fixes most of them.
- **Generate an SBOM and provenance** (`docker buildx build --sbom=true
  --provenance=true`) so you can answer "are we affected by this CVE?" quickly.

## Multi-architecture images

Apple Silicon laptops build `arm64` images; many servers are `amd64`. An image
for the wrong architecture fails with `exec format error`. Build for the target
explicitly, or publish a multi-platform image in CI:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/acme/api:1.4.0 --push .
```

The registry stores a manifest list, and each host pulls the matching variant.
ARM servers (Graviton, Ampere) are often cheaper, so multi-arch is increasingly
worth the build time.

## Memory and CPU limits meet your runtime

Containers are limited through cgroups. The runtime inside must respect those
limits, or the kernel's OOM killer ends the process with `SIGKILL` (exit code
137) and no application log.

- **Node** sizes its default heap from the memory it can see. Set it explicitly
  when you need headroom for buffers and native memory, for example
  `NODE_OPTIONS=--max-old-space-size=384` in a 512 MB container. The heap is
  not the whole process: streams, buffers and native modules live outside it.
- **.NET** is container-aware: the GC heap limit defaults to 75% of the memory
  limit, and `Environment.ProcessorCount` reflects the CPU limit. Tune with
  `DOTNET_GCHeapHardLimitPercent` if needed; .NET 9's DATAS mode keeps Server GC
  heaps smaller under light load.

CPU limits are enforced as a time quota per scheduling period. A
multi-threaded runtime can exhaust the quota in a burst and then be throttled,
which shows up as latency spikes while average CPU looks low.

### Exit codes you will meet

| Code | Meaning | Usual cause |
| --- | --- | --- |
| 0 | clean exit | a one-off task finished, or the app exited by mistake |
| 1 | application error | unhandled exception, failed start-up validation |
| 126 / 127 | cannot execute / not found | wrong entrypoint path, missing shell in the image |
| 137 | killed by SIGKILL | memory limit exceeded (OOMKilled), or stop timeout |
| 139 | segmentation fault | native module built for the wrong libc or architecture |
| 143 | terminated by SIGTERM | a normal stop, handled or not |

`docker inspect <container> --format '{{.State.OOMKilled}}'` settles the 137
question.

## PID 1 and signals

The process started by `CMD` or `ENTRYPOINT` is PID 1, which the kernel treats
specially: it gets no default signal handlers, and it must reap orphaned child
processes. Use the exec form (`CMD ["node", "dist/server.js"]`), not the shell
form, so your app rather than `/bin/sh` receives `SIGTERM`. If your app spawns
child processes, add a minimal init with `docker run --init` or `tini` so
zombies are reaped and signals are forwarded.

## Compose for realistic local environments

Beyond a single `docker compose up`, a few features make local stacks reliable:

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
  api:
    build: .
    environment:
      DATABASE_URL: postgres://postgres:dev@db:5432/postgres
    depends_on:
      db:
        condition: service_healthy
  mailpit:
    image: axllent/mailpit
    profiles: [mail]
```

- `depends_on` with `condition: service_healthy` waits for the database to
  accept connections, not merely to start.
- Services reach each other by **service name** (`db`), never `localhost`,
  which inside a container means the container itself.
- `profiles` keep optional services off unless requested
  (`docker compose --profile mail up`).
- `docker compose watch` syncs source changes into running containers for a
  fast inner loop.

## Debugging a misbehaving container

```sh
docker ps -a                      # is it running, restarting or exited?
docker logs --tail 100 -f api     # stdout and stderr
docker inspect api                # config, env, mounts, exit code, OOMKilled
docker exec -it api sh            # a shell, if the image has one
docker debug api                  # a toolbox shell, even for shell-less images
docker stats                      # live CPU and memory per container
```

Work from the outside in: did it start, what did it print, what exit code, what
configuration did it actually get? Most "works locally" container bugs are
configuration (a missing variable, `localhost` in a connection string), binding
(`127.0.0.1` instead of `0.0.0.0`) or permissions (non-root user, root-owned
directory).

## What you should be able to answer

- Why does changing one source file make `npm ci` run again, and how do you fix
  the layer order?
- How do you use a private registry token during a build without it ending up
  in the image?
- What trade-offs come with Alpine, slim and distroless or chiseled images?
- A container keeps exiting with code 137. What happened, and how do you
  confirm it?
- Why must the app process receive `SIGTERM` directly, and what does `--init`
  add?
- How do you build one image tag that runs on both ARM and x86 servers?
