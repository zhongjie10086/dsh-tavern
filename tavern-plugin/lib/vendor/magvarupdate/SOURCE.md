# MagVarUpdate compatibility source

- Upstream: <https://github.com/MagicalAstrogy/MagVarUpdate>
- Pinned commit: `0a730cd4a9b99689d1135a49b542c780b977c24c`
- License: MIT (see `LICENSE`)
- Release source: `upstream/` retains the pinned official source, build inputs and license. Test/example commands and the five direct Jest development dependencies have been removed from its package metadata, with the workspace dependency declarations updated in `yarn.lock`. Build dependency versions remain pinned; unused resolved lock records are retained. This installation release does not include the project's test fixtures, logs or screenshots. The upstream-published bundle SHA-256 is `3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f`.
- `upstream/src/jest.ts` is retained because production store and update modules import its environment probe. It uses a local declaration and does not import a Jest package; it is business source, not a test configuration or test runner.
- Host build: `host-build/` retains the integration transform, deterministic rebuild script and runtime artifact. See its README for the applied adaptations. The running host bundle SHA-256 is `f42355f9de8310674e886150ce045752be559ec1290ee75b0f4fa444b39d1100`, as required by `lib/domain/official-mvu-assets.js`; no runtime bundle bytes were changed while preparing this release.
- Runtime asset: `lib/domain/official-mvu-assets.js` verifies the host-build hash before exposing the package-local artifact. Loading this asset does not fetch MVU Core or its module dependencies from a CDN.
- Local integration: the audited upstream bundle runs inside the shared per-chat script sandbox and reaches dsh-tavern state only through `lib/domain/tavern-script-host-adapter.js`. The retired self-written runtime is not part of the production path.
- Development conformance tests remain outside this installation release; the preserved source and build inputs do not imply full MagVarUpdate compatibility or a new performance result.
- Expression evaluator: `mathjs` `12.4.3`, the exact version resolved by the pinned upstream `yarn.lock`; Apache-2.0. dsh-tavern uses the math expression parser and does not copy upstream's `new Function` literal fallback.
