# Releasing

Merge the release pull request. release-please updates the changelog and version, then creates the version tag and the GitHub Release. The Release workflow then builds with Bun and publishes the new version with the npm CLI, using trusted publishing and provenance. `bun publish` cannot generate provenance, so the workflow installs Node.js for that one step.

If publishing fails, re-run the failed job or run Release on the version tag.
