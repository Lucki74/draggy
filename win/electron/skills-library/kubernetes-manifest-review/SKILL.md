---
name: kubernetes-manifest-review
description: Reviews Kubernetes manifests or rendered Helm output for resource limits, probes, security context, rollout settings and exposure, and ranks the findings with fixes. Use when the user asks to review k8s yaml, check a deployment before release, or understand why pods restart.
---

# Kubernetes manifest review

## Goal

Find the settings in Kubernetes manifests that cause outages, noisy neighbours or exposure, and propose exact fixes.

A good review is ranked, cites the file and field, and separates breakage from preference.

## When to use

- The user shares Deployment, StatefulSet, Service, Ingress or CronJob yaml for review.
- A pod is in CrashLoopBackOff, OOMKilled or Pending and the manifest may be the cause.
- A chart needs a check before release.
- For Terraform that creates the cluster, use `use_skill` with `terraform-review`.

## Steps

1. Find the manifests with `search_files` for `kind: Deployment` and similar, or `list_directory` on the deploy folder. For Helm, render first with `helm template` through `run_command` and review the output.
2. Read each workload with `read_file`. Note the kind, replicas, image reference and namespace.
3. Check images: a pinned tag or digest, not `latest`, and a sensible `imagePullPolicy`.
4. Check resources: `requests` and `limits` for CPU and memory exist, and memory limit is not below what the app uses at peak.
5. Check probes: a readiness probe that tests dependencies the pod needs, a liveness probe that does not, and a startup probe for slow boots.
6. Check security: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, dropped capabilities, no `hostNetwork` or privileged mode.
7. Check rollout: `strategy`, `maxUnavailable`, a `PodDisruptionBudget` for replicated services, and more than one replica for anything user facing.
8. Check configuration: secrets come from `Secret` or an external store, not literal env values, and config maps are referenced by the right names.
9. Check exposure: Service type, Ingress hosts and TLS, and a NetworkPolicy where the cluster enforces them.
10. If `kubectl` is available, run `kubectl apply --dry-run=server` or `kubectl diff` with `run_command` to catch schema errors. Never apply to a cluster without the user's say.
11. Check API versions against the cluster version with `read_url` on the Kubernetes deprecation page, since removed versions fail at apply time.
12. Rank findings as Outage risk, Security, Reliability and Style, each with the field path and corrected snippet.

## Gotchas

- A liveness probe that checks a database turns a database blip into a restart storm of every pod.
- CPU limits that are too low cause throttling that looks like slowness, with no error in the logs.
- Selector labels in a Deployment are immutable. A fix that changes them needs a delete and recreate.
- A `latest` tag with `IfNotPresent` pulls once per node, so nodes run different code.
- Helm values override templates silently. Review the rendered output as well as the chart source.
- A `PodDisruptionBudget` with `minAvailable` equal to replicas blocks node drains forever.

## Output

- Findings grouped by severity, each with file, field path, risk and a fixed snippet.
- A one-line verdict: ready, ready after fixes, or needs rework.
- What was rendered or dry-run, and what was not checked against a live cluster.
