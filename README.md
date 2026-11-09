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

## How to add a project

Do this on a feature branch taken from the project's `staging` branch.

1. **Match the script names.** The checker runs whichever of these exist in `package.json` (in `working_directory`). One that is missing shows as MISSING, never as a pass. For a project with `money_project: true`, a missing `test` or end-to-end script fails the run.

   | Script | Workflow | What it does |
   |---|---|---|
   | `typecheck` | checks | `tsc --noEmit` or equivalent |
   | `lint` | checks | linter |
   | `test` | checks | unit tests, writing `coverage/coverage-summary.json` when `CI` is set |
   | `build` | checks | production build with placeholder config |
   | `test:rules` | deep | security rules tests on the Firebase emulator |
   | `test:integration` | deep | service-layer tests on the emulator |
   | `test:e2e` (or `e2e_script`) | deep | Playwright against the local app and emulators |
   | `test:speed` | speed | optional read-only timed journeys on staging |

   Run each one locally and note the counts, so the first CI run can be compared with them.

2. **Write the coverage file.** The checker reads `coverage-summary.json`. With Vitest:

   ```ts
   coverage: {
     provider: 'v8',
     reporter: ['text-summary', 'json-summary'],
     include: ['src/**'],
     enabled: !!process.env.CI,
     reportOnFailure: true,
   },
   ```

   `reportOnFailure: true` keeps the file when a test fails, so the Coverage row shows a number instead of MISSING. With Jest, set `coverageReporters: ['text-summary', 'json-summary']` and run `jest --coverage`. In a monorepo, every package with real code reports coverage; list each summary file in `coverage_files`.

3. **Set the floor.** Run the tests with `CI=true`, read the total line coverage and set `coverage_floor` to it, rounded down. Write the date in a comment. The floor only ever goes up: when coverage is 2 or more points above it, the summary says what to raise it to.

4. **List the critical paths.** `critical_globs` takes repo-relative patterns for money, login, permission and secret-handling code, one per line. Matching is case-sensitive, so `*payment*` misses `recordPayment.ts`. Give every word a first-letter class: `src/**/*[Pp]ayment*`. Check what the patterns catch before committing:

   ```bash
   git ls-files | node -e "const {matchesGlob}=require('node:path');const g=process.argv.slice(1);require('fs').readFileSync(0,'utf8').split('\n').filter(f=>g.some(x=>matchesGlob(f,x))).forEach(f=>console.log(f))" 'src/**/*[Pp]ayment*'
   ```

   The target for these files is 100% tested. Keep `critical_enforced` off (a WARN row) until the project reaches it, then turn it on.

5. **Add the prepare commands.** `prepare_build` writes a placeholder env file so the build compiles. `prepare_e2e` writes the emulator env file and placeholder Functions secrets. Use a `demo-<name>` emulator project id. CI never holds real keys.

6. **Copy the timing helper.** Copy `templates/expect-fast.ts` from this repo into the project's tests and wrap timed steps with `expectFast('label', () => ...)`. End-to-end timings are warnings only; `test:speed` timings on staging warn over 1 s and fail over 3 s.

7. **Projects that take money:** have at least one end-to-end test that walks the money path, and set `money_project: true` on `checks` and `deep`.

8. **Speed journeys (optional).** `test:speed` signs in to staging as a read-only test user and never writes data. Store its login as the `SPEED_USER` and `SPEED_PASSWORD` repo secrets and pass them by name.

9. **Write `.github/workflows/ci.yml`.** Start from the example above. A fuller layout:
   - `checks` on every push and pull request.
   - `deep` on pull requests into `staging` or `main`, on pushes to those two branches, and on manual runs.
   - `speed` with `target: staging` on pull requests into `main`.
   - A nightly `speed` job (a matrix over `staging` and `live`) with `open_issue: true` and `issues: write`. Scheduled runs use the `ci.yml` on the repo's default branch, so the nightly report starts once the file reaches that branch; until then use **Run workflow**.
   - Keep `enforce: false` on every speed job until the pages pass.

   If a project's minutes are tight, run the nightly speed job against the live site only, with two pages and no journeys.

10. **Prove it catches a failure.** On the same feature branch, commit a deliberately broken test, push, and check the run goes red with a FAIL row naming it. Then `git revert` the commit, push, and check it goes green. Doing it on the feature branch avoids a throwaway branch that has to be deleted later.

11. **Open a pull request into `staging`.** Put the local counts from step 1 next to the counts in the run summary, plus the floor and the red-then-green proof. Squash merge. If the project had its own test workflow, remove it in the same pull request once the counts match; deploy workflows stay.
