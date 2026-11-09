# Preserve the customized distribution across upgrades

## Intent

Integrate upstream 0.62.0 without discarding the customized UI, multi-tab isolation,
CLI bridge, or model search. Prevent the customized command from replacing itself
with the stock registry distribution.

## Reconciliation

The main update spec permits global package upgrades. That remains the behavior
for unmarked builds. This delta explicitly refuses replacement of builds marked
custom, regardless of installation path. Read-only update checks remain supported.
OpenLore orientation returned no analysis; targeted source and assertion inspection
were used instead. The source already contains compact Process groups and model
search; the regression came from deploying the upstream artifact, not missing UI code.

## Scope

Both npm and SEA build paths embed an immutable custom marker. The update command
refuses stock replacement before network access. Update notices describe integration
and rebuilding instead of suggesting a stock install. A CI gate drives the built
app with Playwright to check compact Process groups and searchable models.

## Limits

External package-manager commands can still overwrite a global installation. This
change does not implement CLI ownership handoff or deploy/restart the live service.
