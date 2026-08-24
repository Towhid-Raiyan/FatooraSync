import { Prisma } from "@prisma/client";

// Prisma only maps a foreign-key violation to the structured `P2003` error
// (PrismaClientKnownRequestError) when the write itself sets an invalid FK
// value. A DELETE blocked by a RESTRICT constraint on a *referencing* row in
// another table -- e.g. deleting a Product that still has DocumentLines --
// surfaces instead as an untyped PrismaClientUnknownRequestError wrapping the
// raw Postgres error (code 23001/23503); verified against actual runtime
// behavior, not Prisma's docs. Both shapes have to be checked.
export function isForeignKeyViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return true;
  if (err instanceof Prisma.PrismaClientUnknownRequestError && /foreign key constraint/i.test(err.message)) return true;
  return false;
}
