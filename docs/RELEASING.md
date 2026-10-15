# Reproducible Releases and Attestations

Use Node.js 24.15.0 and npm 11.12.1. Commit the lockfile. All release text and embedded license notices are normalized to LF, and bundled license files are sorted before concatenation.

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run verify:build
```

The final command builds from a clean temporary install with both LF and CRLF source text, then compares SHA-256 hashes with the current three release assets. It writes evidence to dist/reproducibility.json and does not edit the working tree. No secrets or personal notes enter the fixture.

## Enable the GitHub Workflow

The current local GitHub login does not have the workflow scope. Its device authorization attempt was not completed, so no active workflow or GitHub attestation is claimed.

1. The account owner runs `gh auth refresh --hostname github.com --scopes workflow` and completes GitHub's official browser authorization. Never send the access token or login code to chat.
2. Copy docs/release-workflow.yml to .github/workflows/release.yml and commit/push it. It is intentionally stored under docs until the required scope is granted.
3. Increment the version in package.json, manifest.json and versions.json; update the lockfile and changelog. Never reuse an existing release tag.
4. Run **Verified release** from GitHub Actions on the exact commit being released.
5. The workflow installs locked dependencies, runs lint/tests/build/reproducibility checks, obtains a GitHub OIDC identity, attests the exact three files, and uploads those same files to a new release. It does not rebuild between attestation and upload or replace existing assets.
6. Check the workflow result and asset attestations before requesting another Obsidian review.

Attestations cannot be created honestly by renaming a checksum file or uploading a locally invented provenance document. They require the authenticated GitHub Actions environment. A manually uploaded release can have reproducible hashes but still legitimately show the missing-attestation recommendation until CI publishing is enabled.

## Release Asset Policy

Upload only main.js, manifest.json and styles.css to the marketplace release. No ZIP, source archive uploaded by the maintainer, local configuration or audio files are required. GitHub's automatically generated source-code downloads are separate from release assets.

The bundled MIT Edge SDK is pinned and transformed through a checked TypeScript AST pass. The transform removes file-export and voice-list methods and forces its Node transport for Obsidian's Electron renderer. If the expected SDK structure changes, the build fails rather than silently weakening the check. The release test rejects any runtime fs import or the previous GPL client. Preserve all dependency licenses in the main.js notice block.