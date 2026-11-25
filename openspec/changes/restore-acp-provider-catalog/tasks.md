# Tasks

## 1. PASEO catalog data and ranking

- [x] 1.1 Port the current PASEO 40-entry catalog and local SVGs, preserving pinned argv/env/params while omitting bundled-plugin behavior; add unique-id/icon/config-patch tests and run cd web && npx vitest run src/data/acp-provider-catalog.test.ts src/screens/use-acp-provider-catalog.test.ts --bail=1.
- [x] 1.2 Port PASEO title/id ranking and configured-id filtering with the existing protocol text-match helpers; cover empty-query ordering, ties, and disabled configured providers with cd web && npx vitest run src/screens/provider-catalog-search.test.ts --bail=1.

## 2. Add provider interaction

- [x] 2.1 Integrate the searchable catalog and retained Copy prompt into Add provider, with serialized patchConfig → refresh([id]) → open-detail behavior and visible failure handling; verify with cd web && npx vitest run src/screens/settings/providers-section.test.tsx --bail=1.
- [x] 2.2 Restore the required providerCatalog translations and update docs/custom-providers.md to distinguish official presets from arbitrary ACP CLIs and the separate writer/check workflow; verify the rendered labels and confirm the agy example remains on the Copy prompt path.

## 3. Generic ACP runtime catalog

- [x] 3.1 Refactor ACP startup to accept a probe context without changing interactive StartACPSession behavior, then implement bounded FetchACPProviderCatalog with NO_BROWSER, cwd/home resolution, negotiated model/mode snapshots, and guaranteed Close; cover success/current-model-default/timeout/process cleanup with go test ./internal/agent/providers -run ACPProviderCatalog -count=1.
- [x] 3.2 Change snapshot discovery to ProviderCatalog{Models,Modes}, dispatch only ready generic ACP providers to the probe, retain built-in/static/fallback behavior, and apply model overrides once; verify with go test ./internal/agent/providers -run 'ACPProviderCatalog|BuildSnapshotEntries' -count=1 and go test ./internal/server -run ProviderCatalog -count=1.

## 4. Integration verification

- [x] 4.1 In the dev browser, verify catalog rendering/search, retained Copy prompt, disabled configured entries staying hidden, and unchanged four primary built-ins without opening or searching causing config writes or process launches; record any unavailable real external-provider smoke as not run.
- [x] 4.2 Run npm run format, npm run typecheck, and npm run lint; inspect the diff and run git diff --check.
- [x] 4.3 Run npm run audit, confirm Go parity and browser checks pass, then run openspec validate restore-acp-provider-catalog --strict and confirm all tasks are complete.
