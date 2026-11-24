BEGIN;
-- An undecided catalog price is distinct from an explicit zero price.
-- Existing prices, currencies, source rows and saved sales evidence are retained.
ALTER TABLE "CatalogItem" ALTER COLUMN price DROP NOT NULL;
-- Import source metadata is covered by the existing immutable-source trigger.
ALTER TABLE "CatalogImport" ADD COLUMN "defaultCurrency" TEXT CHECK ("defaultCurrency" ~ '^[A-Z]{3}$');
COMMIT;
