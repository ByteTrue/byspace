# React Compiler

`packages/app/app.config.js` sets `reactCompiler: true`, so every component and hook in the app is compiled before it reaches Babel's normal output. The compiler memoizes aggressively, and it decides what to memoize by **data flow**, not by the dependency arrays you write.

That difference produces one failure mode that is silent, passes typecheck and lint, and looks correct in review.

## The failure mode

A memo whose only reason to recompute is a revision counter. The counter is read, never used:

```tsx
const version = useSyncExternalStore(subscribe, getVersion, getVersion);
return useMemo(() => {
  void version; // dependency hint — invisible to the compiler
  return ids.map((id) => store.getSnapshot(id)).join("|");
}, [ids, store, version]);
```

The compiler drops `void version;` as dead code, so nothing in the memo's data flow depends on `version`. The generated cache guard is built from the values the memo actually reads:

```js
if ($[0] !== ids || $[1] !== store) {
  // no version
  t0 = ids.map(t1).join("|");
  $[0] = ids;
  $[1] = store;
  $[2] = t0;
} else {
  t0 = $[2]; // returns the first value forever
}
```

`ids` and `store` are stable, so the memo computes once and never again. The component re-renders on every store tick and still returns the value from first render.

This is issue 076: the tunnels list read "Loading..." forever while the RPC answered correctly, because the query key derived from this hook froze at its first value. `useHostRuntimeConnectionStatuses` in `packages/app/src/runtime/host-runtime.ts` had the same freeze, so every caller that built a key from it was affected.

## The fix

`"use no memo"` at the top of the function, before any other statement:

```tsx
export function useHostRuntimeConnectionStatuses(serverIds: readonly string[]): ReadonlyMap<...> {
  // The compiler cannot see that store.getSnapshot() reads mutable state, so
  // it caches the memo below and the map freezes at its first value.
  "use no memo";
  const store = getHostRuntimeStore();
  ...
}
```

The compiler leaves the function alone and React evaluates the real dependency array. There is no narrower fix:

- **Using the value** does not help. The compiler keeps the memo cached and appends the fresh value to a stale computation — worse, because it looks right.
- **Making it a branch condition** does not help either; the memo's own guard still omits it.
- **Dropping `useMemo`** does not help. The compiler inserts its own memo with the same data-flow-derived guard.

## Where this pattern appears

The `void <counter>;` idiom exists because the store exposes no observable snapshot object — `useSyncExternalStore` returns a number, and the read has to happen during render. Grep for it:

```bash
rg "void (version|revision|tick|Revision|Tick|Version);" packages/app/src
```

Sites the compiler compiles are the ones that break. Two were frozen when this doc was written (`use-agent-history.ts`, `panel-instance-attributes.ts`); others in the same grep are safe only because the compiler bails on their enclosing function for an unrelated reason — refs read during render, an incompatible library, a `finally` clause.

**Bailing is incidental.** A refactor that removes the bail condition silently turns a working memo into a frozen one. Treat every `void <counter>;` site as a defect to fix with `"use no memo"`, not as a site to check.

## Checking whether the compiler ran

The compiler's decisions are not visible in the source. Compile one file and read the guard — it is the `if ($[...` line above the computation. If your revision variable is not in it, the value is frozen.

```bash
node -e '
const babel = require("@babel/core");
const p = require.resolve("babel-plugin-react-compiler");
const fs = require("fs");
const f = "packages/app/src/hooks/use-agent-history.ts";
const out = babel.transformSync(fs.readFileSync(f, "utf8"), {
  filename: f, configFile: false, babelrc: false,
  plugins: [[p, {}]],
  parserOpts: { plugins: ["jsx", "typescript"] },
}).code;
console.log(out.includes("react/compiler-runtime") ? "compiler ran" : "compiler bailed");
'
```

A file that bails has no `react/compiler-runtime` import. To see _why_ it bailed, pass a logger and read the `CompileError` events:

```bash
node -e '
const babel = require("@babel/core");
const p = require.resolve("babel-plugin-react-compiler");
const fs = require("fs");
const f = "packages/app/src/hooks/use-projects.ts";
const events = [];
babel.transformSync(fs.readFileSync(f, "utf8"), {
  filename: f, configFile: false, babelrc: false,
  plugins: [[p, { logger: { logEvent: (_f, e) => events.push(e) } }]],
  parserOpts: { plugins: ["jsx", "typescript"] },
});
for (const e of events) {
  if (e.kind === "CompileError") console.log(e.detail?.options?.reason ?? e.detail);
}
'
```

## In the browser

The dev bundle URL carries `transform.reactCompiler=true`. To check a hook's live values, log the raw store read and the memoized value in the same render — if they disagree, the memo is frozen:

```tsx
console.log("raw=", runtime.getSnapshot(id)?.connectionStatus, "memo=", memoizedValue);
```

## Related

- [docs/unistyles.md](unistyles.md) — the other place where the Babel pipeline rewrites what you wrote, with the same class of silent divergence.
- `packages/app/src/components/ui/autocomplete-popover.tsx` — `"use no memo"` used for a different reason: the compiler memoizes effect captures that read `SharedValue.value` during render.
