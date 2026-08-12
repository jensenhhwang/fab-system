# Project Rules

## Next.js

This is not the Next.js version assumed by model training data. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

## Twin operating time

- All production and simulation features must use the shared Twin operating clock.
- The default and mandatory operating-time multiplier is `24×`: one real hour advances one operating day.
- Apply `real elapsed time × 24` only to modeled operations such as WIP progression, material consumption, replenishment and purchase-order ETA, final test, automatic shipment, and contract-period aggregation.
- Never accelerate wall-clock facts such as `createdAt`, approval time, user actions, audit logs, authentication/session expiry, or external-system receipt time. Record those as real `recordedAt`-class timestamps.
- Do not introduce feature-local clocks, product-specific multipliers, or tick-count-based time progression. New time-dependent behavior must consume the shared Twin operating clock.
- Keep wall-clock time and operating time explicitly separated in field names, APIs, and UI labels.

## Subagents

- Do not invoke Cree, Fab, X, or any other subagent automatically for feature requests.
- Invoke subagents only when the user explicitly names an agent or asks for multi-agent or three-person planning-team review.
- Keep the existing definitions in `.claude/agents/` available for those explicit requests.
