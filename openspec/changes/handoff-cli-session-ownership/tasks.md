## Implementation and proof

> **Superseded by `shared-cli-web-sessions`.** The user dropped exclusive ownership:
> web and the Pi CLI now write one session file at once. The handoff, reservation,
> adoption and lease implementation, its tests and `scripts/check-cli-handoff.mjs`
> were removed; `shared-cli-web-sessions` removes these requirements. Do not deploy
> or archive this change on its own.

- [x] Reconcile requested same-file behavior, existing sole-CLI-writer spec, and installed SDK shutdown lifecycle.
- [x] Add private receipt validation, original-PID barrier, exclusive durable writer lease, and dead-owner recovery.
- [x] Add separate terminal handoff confirmation and supported CLI resume guards without rewriting history.
- [x] Add current-project released-session discovery and main-workspace exact-file continuation.
- [x] Include adopted files in the authoritative saved-session inventory and preserve cancellation/retry behavior.
- [x] Cover every applicable scenario with exact assertion mappings, including cross-process contention and restart.
- [x] Exercise actual TUI reload, Submit feedback, late shutdown append, exact-file continuation and guarded CLI resume using Playwright.
- [x] Run focused server/extension tests, full UI suite, production build, native deployment/rollback proof, multi-tab probes and strict OpenSpec validation.
- [x] Document cooperative boundaries, pending-submit uncertainty, and explicit empty-mutex recovery.
- [x] Not deployed on its own: superseded by `shared-cli-web-sessions`.
