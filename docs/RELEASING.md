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

## Run the GitHub Workflow

The workflow is now located at [.github/workflows/release.yml](../.github/workflows/release.yml). The maintainer has granted the required workflow scope. Attestations only exist after a real run completes its attestation step; authorization alone is not proof of provenance.

1. Confirm the account has permission to dispatch Actions and that the public repository has Actions enabled. Never send access tokens or login codes to chat.
2. Use the committed workflow on the default branch; no manual asset upload or template copying is needed.
3. Increment the version in package.json, manifest.json and versions.json; update the lockfile and changelog. Never reuse an existing release tag.
4. Run **Verified release** from GitHub Actions on the exact commit being released.
5. The workflow installs locked dependencies, runs lint/tests/build/reproducibility checks, obtains a GitHub OIDC identity, attests the exact three files, and uploads those same files to a new release. It does not rebuild between attestation and upload or replace existing assets.
6. Check the workflow result and asset attestations before requesting another Obsidian review.

Attestations cannot be created honestly by renaming a checksum file or uploading a locally invented provenance document. They require the authenticated GitHub Actions environment. Old manually uploaded releases remain unchanged; use the new CI-built release for directory review. A failed run is not a completed release.

## Verify a Release's Provenance

Every CI-built release asset carries a GitHub SLSA provenance attestation: a statement, signed by the GitHub-hosted runner and recorded in the sigstore transparency log, that the exact file bytes were produced by `.github/workflows/release.yml` from a specific commit of this repository. Reviewers and users can check it independently without trusting the maintainer:

1. Install the GitHub CLI and authenticate (`gh auth login`); read access to the public repository is enough.
2. Download the three release assets:
   ```sh
   gh release download 1.0.3 --repo sunyongyang/obsidian_voice --clobber
   ```
3. Verify each asset against the expected signer identity:
   ```sh
   gh attestation verify main.js \
     --repo sunyongyang/obsidian_voice \
     --signer-workflow sunyongyang/obsidian_voice/.github/workflows/release.yml
   ```
   Repeat for `manifest.json` and `styles.css`. Exit code 0 means all three checks passed: the file's SHA-256 digest matches the digest named in the attestation (it is the exact file the workflow built), the signature is cryptographically valid, and the signing identity is this repository and this workflow at the released commit.

To pin the source commit as well, compare the release page's target commit with the certificate identity from `gh attestation verify --format json`: the signer workflow path, source repository and source commit must match the corresponding release run. A passing result cannot be fabricated locally — it requires the authenticated GitHub Actions environment.

## Release Asset Policy

Upload only main.js, manifest.json and styles.css to the marketplace release. No ZIP, source archive uploaded by the maintainer, local configuration or audio files are required. GitHub's automatically generated source-code downloads are separate from release assets.

The bundled MIT Edge SDK is pinned and transformed through a checked TypeScript AST pass. The transform removes file-export and voice-list methods and forces its Node transport for Obsidian's Electron renderer. If the expected SDK structure changes, the build fails rather than silently weakening the check. The release test rejects any runtime fs import or the previous GPL client. Preserve all dependency licenses in the main.js notice block.