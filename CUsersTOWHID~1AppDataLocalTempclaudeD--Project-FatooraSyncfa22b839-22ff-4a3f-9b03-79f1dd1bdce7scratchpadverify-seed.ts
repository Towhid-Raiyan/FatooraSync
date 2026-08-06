import { prisma } from "../src/lib/db/client";

async function verifySeed() {
  const demoTenant = await prisma.tenant.findUnique({
    where: { vatNumber: "300000000000099" },
  });

  if (!demoTenant) {
    console.log("ERROR: Demo tenant not found");
    process.exit(1);
  }

  console.log("Tenant found:", demoTenant.tradeNameEn);

  const demoUser = await prisma.user.findFirst({
    where: { tenantId: demoTenant.id, email: "owner@demo.local" },
  });

  if (!demoUser) {
    console.log("ERROR: Demo user not found");
    process.exit(1);
  }

  console.log("User found:", demoUser.email);

  const demoSettings = await prisma.settings.findUnique({
    where: { tenantId: demoTenant.id },
  });

  if (!demoSettings) {
    console.log("ERROR: Demo settings not found");
    process.exit(1);
  }

  console.log("Settings found. Default VAT rate:", demoSettings.defaultVatRate);

  const walkInCustomer = await prisma.customer.findFirst({
    where: { tenantId: demoTenant.id, isWalkIn: true },
  });

  if (!walkInCustomer) {
    console.log("ERROR: Walk-in customer not found");
    process.exit(1);
  }

  console.log("Walk-in customer found:", walkInCustomer.name);

  console.log("\nAll seed data verified successfully!");
  await prisma.$disconnect();
  process.exit(0);
}

verifySeed().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
