import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // The app's tsconfig.json sets jsx: "preserve" because Next.js transforms JSX
  // itself via SWC. Vite 8 defaults to its oxc-based transform (esbuild options
  // are ignored when oxc is set), and oxc reads the same "preserve" setting from
  // tsconfig, which leaves raw JSX in the output and breaks parsing here. Without
  // this override any .tsx file with JSX fails to parse ("make sure to not set
  // jsx to preserve"). This only affects the Vitest transform pipeline, not
  // Next's own build.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    globals: false,
    // `.worktrees/` is this project's own manual-fallback worktree convention;
    // `.claude/worktrees/` is where the harness's native worktree tool creates
    // them. Without excluding both, running the suite from the repo root while
    // any harness-created worktree exists re-runs its nested copy of every test
    // concurrently against the same shared dev database as this run -- producing
    // unique-constraint collisions that look like real failures but are really
    // just the same test racing itself.
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/.claude/worktrees/**", "**/.next/**"],
    server: {
      deps: {
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
});
