# ST-Prompt-Template source and runtime

Pinned upstream: https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2

Upstream manifest version: 1.17.9 (upstream package.json reports 1.17).
License: upstream AGPL-3.0; see `upstream/LICENSE`. Attribution remains with
the upstream authors. Preserve the corresponding source and build inputs when
distributing the derived host artifact.

## Installation release source selection

`upstream/` retains the official source, configuration, included libraries,
locales, settings HTML, dependency lock and license. It is a selected source
inventory: upstream documentation, test fixtures and CI workflow files are not
shipped. The generated upstream `dist/` is also excluded. All five source entry
modules (handler, command, UI, exports and code editor) remain available.

`upstream-lock.json` keeps the original repository, commit, version and license,
and records the SHA-256 of every file actually retained in this release.
`releaseExcludedPaths` records the development-only omissions. The host
integration lives outside `upstream/`; the upstream business source files have
not been edited. This inventory is not a claim that all upstream documentation
or tests are distributed, or that every upstream feature has been validated.

## Preserved runtime and build inputs

The complete `host-build/artifact/` contains `manifest.json` and every declared
script chunk, worker, font, settings HTML and third-party license notice. The
production asset reader verifies each served file's hash and size against that
manifest. Do not trim files from this artifact or alter it during source
packaging.

`host-build/` retains the adapters, loaders and build entry. `build.mjs` imports
`audit.mjs` to verify the selected source inventory before building; this audit
is a required build dependency, not a shipped browser test. The build checks
the exact upstream package-lock. Upstream repository ownership and license
metadata are unchanged.

To rebuild, install the pinned upstream package-lock in a separate dependency
directory, then run:

```sh
node tavern-plugin/lib/vendor/st-prompt-template/host-build/build.mjs /path/to/dependencies /path/to/output
```

These commands are for source reproducibility. Ordinary installation uses the
committed runtime artifact and does not rebuild it or download a personal
preset. Development smoke tests, research documents and local evidence are
not part of this installation release.
