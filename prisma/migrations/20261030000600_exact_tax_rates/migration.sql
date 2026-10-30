BEGIN;
SET LOCAL extra_float_digits=3;
-- Preserve each finite float's shortest round-trip decimal representation.
-- Never round a master rate to fit the new 12-place input contract.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Tax" WHERE percent::text IN ('NaN','Infinity','-Infinity') OR percent<0 OR percent>100) OR EXISTS(SELECT 1 FROM "AppointmentOrderTax" WHERE percent::text IN ('NaN','Infinity','-Infinity') OR percent<0) OR EXISTS(SELECT 1 FROM "PurchaseOrderItem" WHERE "taxPercent"::text IN ('NaN','Infinity','-Infinity') OR "taxPercent"<0) THEN RAISE EXCEPTION 'Review invalid/non-finite tax percentages before the exact-rate migration' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM "Tax" WHERE percent::text::numeric<>round(percent::text::numeric,12)) THEN RAISE EXCEPTION 'Review master tax rates exceeding 12 decimal places; no rates have been rounded' USING ERRCODE='23514';END IF;
END $$;
ALTER TABLE "Tax" ALTER COLUMN percent TYPE numeric USING percent::text::numeric;
ALTER TABLE "AppointmentOrderTax" ALTER COLUMN percent TYPE numeric USING percent::text::numeric;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "taxPercent" TYPE numeric USING "taxPercent"::text::numeric;
-- Unconstrained numeric prevents storage from rounding before validation. Frozen
-- historical percentages retain all their decimal digits, including old sums.
ALTER TABLE "Tax" ADD CONSTRAINT exact_directory_tax_rate CHECK(percent NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND percent BETWEEN 0 AND 100 AND scale(trim_scale(percent))<=12);
ALTER TABLE "AppointmentOrderTax" ADD CONSTRAINT exact_saved_tax_rate CHECK(percent NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND percent>=0);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT exact_saved_purchase_rate CHECK("taxPercent" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND "taxPercent">=0);
-- No UPDATE, snapshot recalculation, timestamp, ownership, grants or policy changes.
COMMIT;
