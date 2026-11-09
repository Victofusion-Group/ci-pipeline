# ci-pipeline

The shared checker for every Victofusion and AIT project. Each project calls these GitHub workflows on every change. They run the project's own tests (unit, integration, end-to-end), measure how much of the code is tested, and time the staging site's key pages and buttons against fixed limits. Every run ends with a table that says PASS, FAIL, MISSING or WARN for each check.

This repo holds only the checking rules. It has no passwords, keys, site addresses or client data.

## Using the checker

A project adds one file, `.github/workflows/ci.yml`. A minimal one:

```yaml
name: CI

on:
  push:
  pull_request:
  schedule:
    - cron: '0 2 * * *'   # nightly speed report

jobs:
  checks:
    if: github.event_name != 'schedule'
    permissions:
      contents: read
    uses: Victofusion-Group/ci-pipeline/.github/workflows/checks.yml@v1
    with:
      pipeline_ref: v1
      package_manager: npm
      coverage_floor: 60

  deep:
    if: github.event_name != 'schedule'
    permissions:
      contents: read
    uses: Victofusion-Group/ci-pipeline/.github/workflows/deep.yml@v1
    with:
      pipeline_ref: v1
      package_manager: npm

  speed:
    if: github.event_name == 'schedule'
    permissions:
      contents: read
      issues: write          # only because open_issue is true
    uses: Victofusion-Group/ci-pipeline/.github/workflows/speed.yml@v1
    with:
      pipeline_ref: v1
      urls: |
        https://example.com/
        https://example.com/pricing
      target: staging
      open_issue: true
      enforce: false         # report only until the pages pass, then remove
    secrets:
      speed_user: ${{ secrets.SPEED_USER }}
      speed_password: ${{ secrets.SPEED_PASSWORD }}
```

Rules:

1. **Always set `pipeline_ref` to the same ref as `uses:`.** The workflow file comes from the `@ref` after `uses:`; the scripts it runs come from `pipeline_ref`. If they differ, the two can disagree. If `pipeline_ref` names a ref that does not exist, the run stops with a message saying so.
2. **Grant `contents: read` to every job.** Add `issues: write` only to the nightly speed job that sets `open_issue: true`. It opens a "Speed report (staging)" or "Speed report (live)" issue, one per target, and comments only when the list of failing pages changes.
3. **Pass the speed login as named secrets** (`speed_user`, `speed_password`), not `secrets: inherit`, so the checker sees only those two values.
4. **Turn speed blocking on once the pages pass.** With `enforce: false` the speed table still shows FAIL rows and the issue still updates, but the run stays green. Remove the line once every page is within its limits.
