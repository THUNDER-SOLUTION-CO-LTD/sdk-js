# Contributing

Development uses [Bun](https://bun.com), at the version in `.bun-version`. Node.js and npm are not
needed. Install the development tools, then run:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run check:package
bun scripts/smoke.ts bun
```

The test suite runs on Bun and checks the README examples and conformance fixtures without
credentials. The package is built for Node.js. To check it there, install Node.js and run
`bun scripts/smoke.ts node`: it installs the tarball in an empty project and calls a local mock of
the API with both `require` and `import`. CI does this on every Node.js version in
`.github/workflows/ci.yml`.

For live tests, set `THUNDER_API_KEY` or `THUNDER_API_KEY_FILE` to your own key, and optionally
`THUNDER_V1_BASE_URL` and `THUNDER_V2_BASE_URL` to the API endpoints. The other variables are
listed at the top of `test/integration/live.test.ts`:

```sh
bun run test:integration
```

Live tests may use quota. Never commit keys or slip data.
Keep pull requests focused, add regression tests and update both READMEs when the API changes.
Run the checks above before submitting. Use Conventional Commits for commit messages and PR titles.
Report vulnerabilities through [SECURITY.md](SECURITY.md).
Maintainers follow [RELEASING.md](RELEASING.md).
