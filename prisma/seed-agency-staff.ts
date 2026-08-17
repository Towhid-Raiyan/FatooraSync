import { prisma } from "../src/lib/db/client";
import { hashPassword } from "../src/lib/auth/password";

// One-time bootstrap: run this once against production to create the first
// CTO account. There is no UI to create AgencyStaff rows in v1 (staff
// management is explicitly deferred - see the admin panel v1 spec, §2) so
// this script is the only way one gets created until that ships. Password
// is supplied via env var, not hardcoded - invoke as:
//   ADMIN_SEED_PASSWORD=your-strong-password npx tsx prisma/seed-agency-staff.ts
async function main() {
  const email = "cto@fatoorasync.sa".toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password) {
    console.error(
      "ADMIN_SEED_PASSWORD is not set. Run this script as:\n" +
        "  ADMIN_SEED_PASSWORD=your-strong-password npx tsx prisma/seed-agency-staff.ts"
    );
    process.exit(1);
  }

  const existing = await prisma.agencyStaff.findUnique({ where: { email } });
  if (existing) {
    console.log(`AgencyStaff with email ${email} already exists (id ${existing.id}) - not creating a duplicate.`);
    return;
  }

  const staff = await prisma.agencyStaff.create({
    data: { email, passwordHash: await hashPassword(password), role: "CTO" },
  });
  console.log(`Created CTO account ${staff.email} (id ${staff.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
