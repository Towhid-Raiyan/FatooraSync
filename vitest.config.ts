import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
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
