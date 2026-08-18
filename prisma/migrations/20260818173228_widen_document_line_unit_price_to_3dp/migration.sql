-- Widen DocumentLine.unitPrice from Decimal(12,2) to Decimal(12,3) so a unit
-- price back-solved from a typed line Total can carry enough precision to
-- round-trip to that exact total. Lossless: every existing 2-decimal value is
-- exactly representable at 3 decimals.
ALTER TABLE "DocumentLine" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,3);
