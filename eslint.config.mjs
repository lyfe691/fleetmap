import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // eslint-plugin-react-hooks (React Compiler era) ships two rules that flag
    // intentional patterns in this codebase: refs that deliberately hold
    // render-spanning state (the forward-clamped route split and the marker
    // glide) and snapshot-load setState inside effects (the snapshot-then-
    // subscribe live hooks), plus the same in scaffolded shadcn components.
    // Keep them as warnings — signal without breaking `next build` — rather
    // than disabling lint wholesale.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
