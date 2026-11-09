# ci-pipeline

The shared checker for every Victofusion and AIT project. Each project calls these GitHub workflows on every change. They run the project's own tests (unit, integration, end-to-end), measure how much of the code is tested, and time the staging site's key pages and buttons against fixed limits. Every run ends with a table that says PASS, FAIL, MISSING or WARN for each check.

This repo holds only the checking rules. It has no passwords, keys, site addresses or client data.
