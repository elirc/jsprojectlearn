# Kubernetes for application developers

You will rarely be hired to run a Kubernetes cluster at mid-level, but if the
company uses one, your API will live in it. Interviewers expect you to read a
Deployment manifest, explain probes and resource requests, find out why a pod
is in `CrashLoopBackOff`, and know when Kubernetes is overkill. This guide is
the application developer's slice, not the platform engineer's.

For containers themselves, read [docker-basics](docker-basics.md) and
[docker-beyond-basics](docker-beyond-basics.md) first.

## The objects you actually touch

Kubernetes is a declarative API: you submit the desired state as YAML, and
controllers keep working until reality matches it.

| Object | What it is | You care because |
| --- | --- | --- |
| Pod | one or more containers scheduled together, with one IP | it is the unit that runs, restarts and dies |
| Deployment | desired number of identical pods, plus rollout strategy | this is how you ship a stateless API |
| ReplicaSet | created by a Deployment for each version | you see it during rollouts, rarely edit it |
| Service | a stable name and virtual IP in front of matching pods | other apps call `http://orders-api` |
| Ingress / Gateway | HTTP routing from outside the cluster to Services | hostnames, paths, TLS |
| ConfigMap / Secret | configuration and sensitive values | injected as env vars or files |
| Job / CronJob | run-to-completion work, optionally on a schedule | migrations, nightly exports |
| HorizontalPodAutoscaler | scales a Deployment on metrics | handles load changes |

Pods are cattle: they get new names and IPs whenever they are rescheduled. You
never talk to a pod directly; you talk to a Service, which load-balances across
whichever pods currently match its label selector.

## A Deployment you can read

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
  selector:
    matchLabels: { app: orders-api }
  template:
    metadata:
      labels: { app: orders-api }
    spec:
      containers:
        - name: api
          image: ghcr.io/acme/orders-api:3f2a9c1
          ports: [{ containerPort: 8080 }]
          envFrom:
            - configMapRef: { name: orders-api-config }
            - secretRef: { name: orders-api-secrets }
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { memory: 512Mi }
          readinessProbe:
            httpGet: { path: /health/ready, port: 8080 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /health/live, port: 8080 }
            periodSeconds: 10
          startupProbe:
            httpGet: { path: /health/live, port: 8080 }
            failureThreshold: 30
            periodSeconds: 2
```

The `selector` must match the pod template's labels; the Service uses the same
labels to find pods. The image is tagged with a commit SHA, never `latest`, so
a rollout changes exactly one thing and a rollback is precise.

## Probes: three questions, three probes

| Probe | Question | On failure |
| --- | --- | --- |
| startup | has the app finished starting? | keep waiting, up to `failureThreshold × periodSeconds`, then restart |
| readiness | should this pod receive traffic right now? | removed from Service endpoints, not restarted |
| liveness | is the process stuck beyond recovery? | container restarted |

Common mistakes:

- **Liveness checking dependencies.** If `/health/live` pings the database, a
  database blip restarts every pod at once, turning a partial outage into a
  total one. Liveness should only fail when restarting would help.
- **No startup probe on a slow starter.** Liveness fires before start-up
  finishes and kills the pod in a loop.
- **No readiness probe.** Pods receive traffic the moment the container starts,
  so every rollout produces a burst of errors.

ASP.NET Core's health checks can tag checks and map separate endpoints for
readiness and liveness; in Node a couple of small routes do the same job.

## Requests, limits and why pods get killed

- **Requests** are what the scheduler reserves. A pod is only placed on a node
  with that much unreserved capacity.
- **Limits** are hard ceilings. Exceed the memory limit and the container is
  OOMKilled (exit code 137). Exceed the CPU limit and it is throttled, not
  killed.

Set memory requests near real usage and a memory limit with headroom; make
sure the runtime's heap fits inside it (Node's `--max-old-space-size`, .NET's
container-aware GC). Many teams set CPU requests but no CPU limit, because CPU
throttling causes latency spikes that are hard to diagnose.

## Configuration and secrets

ConfigMaps hold non-sensitive settings; Secrets hold sensitive ones. Note that
Kubernetes Secrets are only base64-encoded by default: access control and
encryption at rest are the cluster's job. Many teams sync secrets from a cloud
secret manager (External Secrets Operator, the Secrets Store CSI driver).

Environment variables are read when the container starts. Changing a ConfigMap
does not change the environment of running pods; you need a rollout
(`kubectl rollout restart deployment/orders-api`), or mount the ConfigMap as a
file and have the app reload it.

## Rollouts and rollbacks

A Deployment's default strategy is `RollingUpdate`: start new pods, wait for
them to become ready, then terminate old ones, controlled by `maxSurge` and
`maxUnavailable`.

```sh
kubectl rollout status deployment/orders-api
kubectl rollout history deployment/orders-api
kubectl rollout undo deployment/orders-api
```

For zero-downtime rollouts you need three things together: a readiness probe,
graceful shutdown on `SIGTERM` (finish in-flight requests within
`terminationGracePeriodSeconds`, 30 seconds by default), and backward-compatible
database migrations, because old and new pods serve traffic side by side.

Run migrations as a separate Job or pipeline step before the rollout, not from
every pod at start-up, where several replicas race to apply them.

## Scaling

A HorizontalPodAutoscaler adjusts `replicas` from metrics:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: orders-api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: orders-api }
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
```

CPU utilisation is measured against **requests**, so wrong requests mean wrong
scaling. Queue workers should scale on backlog instead (KEDA does this well).
And every extra replica needs database connections: 12 pods with a pool of 20
is 240 connections.

## Debugging a broken pod

```sh
kubectl get pods -l app=orders-api
kubectl describe pod <pod>        # events: scheduling, probes, OOMKilled, image pulls
kubectl logs <pod> --previous     # logs from the crashed container
kubectl exec -it <pod> -- sh      # if the image has a shell
kubectl debug -it <pod> --image=busybox --target=api   # ephemeral debug container
kubectl port-forward svc/orders-api 8080:80            # call it from your laptop
```

| Status | Usually means |
| --- | --- |
| `Pending` | no node has enough requested CPU or memory, or a volume cannot attach |
| `ImagePullBackOff` | wrong image name or tag, or missing registry credentials |
| `CrashLoopBackOff` | the app exits on start: bad config, missing secret, failed probe |
| `OOMKilled` (in describe) | memory limit exceeded |
| Running but 0/1 ready | readiness probe failing: wrong path or port, dependency down |

`describe` events and `logs --previous` answer most of these in a minute.

## When Kubernetes is the wrong tool

Kubernetes shines with many services, a platform team, and needs such as custom
scheduling or sidecars. For one API and a frontend, a managed container
platform (Cloud Run, Azure Container Apps, ECS Fargate, Fly.io) gives you
rolling deploys, autoscaling and TLS without cluster upgrades, networking
plug-ins and a YAML estate to maintain. Saying so in an interview is a sign of
judgement, not ignorance. [cloud-building-blocks](cloud-building-blocks.md)
compares the options.

## What you should be able to answer

- What is the difference between a Pod, a Deployment and a Service?
- Explain startup, readiness and liveness probes, and why liveness must not
  check the database.
- What happens when a container exceeds its memory limit versus its CPU limit?
- What makes a rolling deploy zero-downtime, and where should migrations run?
- A pod is in `CrashLoopBackOff`. What commands do you run, in what order?
- When would you recommend against Kubernetes for a team?
