import pino from "pino";
import type { Writable } from "node:stream";

export function createLogger(tenantId?: string, destination?: Writable) {
  const base = destination ? pino(destination) : pino();
  return base.child({ tenantId });
}

export function getLogger(tenantId?: string) {
  return createLogger(tenantId);
}
