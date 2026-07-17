# ADR-0001: Signal-combination escalation overrides numeric scoring

Date: 2026-07-17

Status: Accepted

## Context

AgentWatch scores each Finding by summing fixed per-signal point contributions
and mapping the total to a severity band (0 to 29 info, 30 to 59 low, 60 to 89
medium, 90 to 119 high, 120 and above critical). That model is simple and
explainable, but it has a blind spot: a Finding that combines several
individually modest signals can land in a low severity band even when the
combination represents a critical-risk posture.

The clearest example is an MCP config that declares a remote endpoint
(remote-endpoint, +35) and also exposes a dynamic tool registry
(dynamic-registry, +30). The numeric total is 65, which is medium. But the
combination means a third-party operator can change the Agent's capability
surface at runtime over a network the operator controls. The numeric score
understates the risk because neither signal was designed to carry the full
weight of the other.

Three combinations were identified as critical regardless of numeric score:

1. remote-endpoint + dynamic-registry + memory-request
2. remote-endpoint + dynamic-registry + local-execution
3. remote-endpoint + credential-reach

## Decision

AgentWatch forces a Finding to critical severity when any of those three signal
combinations is present, even when the numeric total would place it in a lower
band. The escalation check runs after the numeric mapping and always wins.

The numeric scoring table is unchanged. Signals that are not part of an
escalation combination still contribute their points and the severity bands
still apply for every other Finding.

## Consequences

Severity is no longer a pure function of the numeric score. A reader who only
looks at the score cannot predict severity without also checking the signal set.
The `explain` command and the human report surface the signals and the
escalation rule so the special case is visible to the user.

The set of escalation combinations is now part of the stability contract.
Adding, removing, or reweighting a combination changes the severity of existing
Findings and the scan exit code, so changes here require updating the
assertions document and the explain registry in the same change.

Pure numeric scoring would have been simpler to maintain, but it would have let
the most dangerous configurations report as medium severity, which defeats the
tool's purpose of surfacing agent-surface risk before it is exploited.
