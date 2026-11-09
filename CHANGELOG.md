# Changelog

## Unreleased

First release, to be tagged v1.

* `checks.yml`: secret scan, install, typecheck, lint, unit tests, coverage floor and critical-path coverage, build.
* `deep.yml`: security rules tests and integration tests on the Firebase emulators, end-to-end tests, button timings (warning only).
* `speed.yml`: Lighthouse page weight, main content time, layout shift and frozen time for each listed page; optional timed journeys; a "Speed report (<target>)" issue per target that comments only when the failing rows change; `enforce: false` for report-only.
* Every run ends with one table of PASS, FAIL, MISSING and WARN rows. A check that could not run or measure never reads as a pass.
* A value just over a limit is shown with enough decimals to read as over it (3.01 s against a 3 s limit). Coverage below the floor is rounded down.
* pnpm projects that name their pnpm version in package.json (`packageManager`) set up without a version clash.
* A run whose scripts could not be loaded says to check that `pipeline_ref` matches the `@ref` in `uses:`.

Note: `pipeline_ref` defaults to `v1` in all three workflows. A v2 must change the pipeline_ref default in all three workflows.
