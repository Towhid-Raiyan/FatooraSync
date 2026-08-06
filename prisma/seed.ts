import { seedTenant } from "../src/lib/db/seed-tenant";

async function main() {
  await seedTenant({
    legalName: "Demo Trading Establishment",
    tradeNameEn: "Demo Shop",
    tradeNameAr: "متجر تجريبي",
    vatNumber: "300000000000099",
    ownerEmail: "owner@demo.local",
    ownerPassword: "changeme123",
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
