`pnpm typecheck` rejects new TypeScript diagnostics in the browser and both PartyKit entry points. The baseline records 174 diagnostics from main at `7d796145b9a972f9da5e399a6802e86f8450ea83`, checked with TypeScript 5.9.3 and this repository's tsconfig.

This is a debt baseline, not a clean type check. `pnpm typecheck:all` reports every remaining error. Strict null checks are enabled; implicit `any` is still allowed. Preparation scripts and Vite configuration are outside this initial scope.

The comparison includes file, error code, message, source expression, and occurrence count. Moving an error does not fail the check. Fixing an old error cannot pay for a different new error, even when the total count falls.

Fix new diagnostics in source. Do not refresh the baseline to make a PR pass. When existing diagnostics are fixed, their baseline entries may be removed in the same reviewed change. A compiler or configuration update must review diagnostic changes explicitly.
