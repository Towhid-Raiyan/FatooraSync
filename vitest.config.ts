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
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/.next/**"],
    server: {
      deps: {
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
});
