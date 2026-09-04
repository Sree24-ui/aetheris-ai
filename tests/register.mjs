// Module resolution shim for `node --test`.
//
// Node runs the project's TypeScript directly (type stripping), which keeps
// the test suite dependency-free — no bundler, no transpiler, no test
// framework. What Node does not do is TypeScript's *resolution* rules, so two
// things need mapping before its own resolver runs:
//
//   1. extensionless relative imports (`./appConfig`) -> `./appConfig.ts`
//   2. the `@/*` path alias from tsconfig.json -> `src/*`
//
// Registered with `node --import ./tests/register.mjs`.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC_ROOT = pathToFileURL(path.join(process.cwd(), "src") + path.sep);
// Only TypeScript: a JavaScript dependency resolves through Node's own rules,
// and rewriting those specifiers breaks CommonJS packages (which expect a
// path, not a file: URL, back from the resolver).
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Returns the first existing file for a specifier that omitted its extension. */
function resolveExtension(baseUrl) {
  if (/\.[a-z]+$/i.test(baseUrl.pathname)) return undefined;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = new URL(baseUrl.href + suffix);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return undefined;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), SRC_ROOT);
      const resolved = resolveExtension(target) ?? target.href;
      return nextResolve(resolved, context);
    }
    // Dependencies resolve normally. This shim exists for the project's own
    // TypeScript, where extensionless imports are the TypeScript convention.
    if (
      specifier.startsWith(".") &&
      context.parentURL &&
      !context.parentURL.includes("/node_modules/")
    ) {
      const target = new URL(specifier, context.parentURL);
      const resolved = resolveExtension(target);
      if (resolved) return nextResolve(resolved, context);
    }
    return nextResolve(specifier, context);
  },
});
