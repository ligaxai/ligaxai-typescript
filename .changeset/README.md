# Changesets

Every user-visible change to a publishable package ships with a changeset: run `pnpm changeset`,
pick the packages and the bump, write one or two lines for the CHANGELOG. The release workflow
(`.github/workflows/release.yml`) turns accumulated changesets into a "Version Packages" PR; merging
that PR publishes to npm with provenance.

The three packages are `linked`, so they move to the same version when released together.
