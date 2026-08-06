import * as Sentry from "@sentry/nextjs";

// Only NEXT_PUBLIC_*-prefixed env vars are inlined into the browser bundle
// by Next.js at build time. process.env.SENTRY_DSN (used by the server and
// edge configs, which run in Node.js/edge runtimes and read real process
// env at request time) would resolve to undefined here, silently disabling
// the client-side SDK.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
});
