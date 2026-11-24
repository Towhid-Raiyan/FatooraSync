// Vercel runs `npm run vercel-build` instead of `npm run build` when it exists.
//
// Production deploys apply pending Prisma migrations before building, so the
// deployed code never runs against a database that is behind its schema
// (missing columns/tables surface as P2021/P2022 -> HTTP 500 on every route
// that touches them). If the migration fails, the build fails and Vercel keeps
// serving the previous deployment.
//
// Preview and development builds skip migrations on purpose: an unmerged
// branch must never migrate a shared database.
//
// Requires DIRECT_URL (the database owner role) in the Vercel Production
// environment - `prisma migrate deploy` connects through it.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DIRECT_URL) {
    console.error(
      "DIRECT_URL is not set for the Production environment; cannot run migrations."
    );
    process.exit(1);
  }
  console.log("Production build: applying pending Prisma migrations...");
  run("npx prisma migrate deploy");
} else {
  console.log(
    `Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`
  );
}

run("npm run build");
