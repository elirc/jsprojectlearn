# Docker, enough to be useful

You do not need to be a platform engineer. You do need to know what a container
is, read and write a reasonable Dockerfile, and run your app's dependencies
locally without installing Postgres on your laptop.

## What a container actually is

**An isolated process on the host kernel** — with its own filesystem, network
namespace and process tree, but sharing the kernel with everything else.

It is **not a virtual machine.** A VM boots its own kernel and takes seconds and
gigabytes. A container starts in milliseconds and is the size of your app plus
its runtime. That distinction is the interview question.

The consequence: a Linux container cannot run on a Windows kernel without a
lightweight VM underneath — which is exactly what Docker Desktop provides.

**Image vs container:** the image is the immutable template; the container is a
running instance of it. Same relationship as a class and an object.

## A Dockerfile you would not be embarrassed by

Node:

```dockerfile
# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app

# Dependency layer first, so a source change does not reinstall everything
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

.NET:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .
USER $APP_UID
ENTRYPOINT ["dotnet", "MyApi.dll"]
```

Four things in there matter, and each is an interview answer:

**1. Layer caching.** Every instruction creates a layer, cached until its inputs
change. Copying `package.json` and installing *before* copying source means a
one-line code change reuses the dependency layer. Get it backwards and every
build reinstalls everything — a 10-second build becomes three minutes.

**2. Multi-stage builds.** The .NET SDK image is around 800MB; the ASP.NET
runtime image is a fraction of that. Build in the big one, copy only the
artefacts into the small one. Smaller images pull faster, cost less, and contain
fewer things a vulnerability scanner can flag.

**3. Non-root user.** Containers run as root by default. A container escape from
a root process is much worse than from an unprivileged one. One line.

**4. `npm ci --omit=dev`.** Production dependencies only.

## .dockerignore

```
node_modules
dist
.git
.env
**/bin
**/obj
```

Without it you copy your local `node_modules` (wrong platform, possibly with
native binaries), your whole git history, and your `.env` file **into the
image**. That last one ships your secrets to anyone who can pull it.

## Running things

```bash
docker build -t myapi:local .
docker run -p 3000:3000 --env-file .env myapi:local

docker ps                      # what is running
docker logs -f <container>     # follow the logs
docker exec -it <container> sh # a shell inside it
docker image ls                # what is taking up disk
```

`-p 3000:3000` maps host port to container port. If your app binds to
`127.0.0.1` inside the container, nothing outside can reach it — **bind to
`0.0.0.0`**. That is a classic first-container bug and a plausible cause of a
502 from a load balancer.

## Docker Compose for local development

This is where Docker pays for itself day to day:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: devpath
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://postgres:dev@db:5432/devpath
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

`docker compose up` and a new developer has the whole stack, matching versions,
without installing anything. Notice the host in `DATABASE_URL` is `db` — the
service name — because Compose gives each service a DNS entry on a shared
network.

`depends_on` with a healthcheck waits for readiness, not just for the container
to exist. Without the healthcheck, your API starts before Postgres accepts
connections and crashes on boot.

## State and volumes

**A container's filesystem is ephemeral.** Delete it and anything written inside
is gone. That is a feature — it forces you to keep state outside the app, which
is what makes horizontal scaling possible.

Volumes are the escape hatch for genuinely stateful containers (your local
database). In production, real state lives in a managed database or object
store, not in a volume you have to back up yourself.

The corollary: **do not write uploads or logs to the container filesystem.** Use
object storage for files and stdout for logs.

## Images and tags

`node:22-alpine` is a repository, a version and a variant. `alpine` is small
but uses musl instead of glibc, which occasionally breaks native modules — the
`-slim` Debian variants are a safer default when that bites.

**Do not use `latest`** in a Dockerfile or a pipeline. It is a moving target,
and it is the answer to "I changed nothing and the build broke."

## Health checks and signals

Your container should respond to `SIGTERM` by shutting down gracefully — stop
accepting connections, finish in-flight requests, close the database pool, exit.
The orchestrator sends SIGTERM and waits before killing.

Skip this and every rolling deploy drops requests, which teams often mistake for
normal.

Also make sure signals actually reach your process: `CMD ["node", "server.js"]`
(exec form) runs node as PID 1 and gets the signal. `CMD npm start` wraps it in
a shell that may not forward it.

## Kubernetes, in one paragraph

You will hear about it. It runs containers across many machines, restarting them
when they fail, scaling them, and routing traffic. As an application developer,
what you touch is: a **Deployment** (how many replicas of which image), a
**Service** (a stable address), **ConfigMaps** and **Secrets** (your config),
and **liveness/readiness probes** (the health endpoints you wrote).

Knowing that much is enough for a CRUD role. "I have worked with it, I am not an
operator" is a perfectly good answer.

## What to be able to answer

- What is the difference between a container and a VM?
- Why order Dockerfile instructions the way you do?
- What does a multi-stage build buy you?
- Why is the container filesystem ephemeral, and what follows from that?
- Your container starts and immediately exits — what do you check?
  (Logs first; then whether the process is backgrounding itself, whether the
  entrypoint is right, and whether a required env var is missing.)
