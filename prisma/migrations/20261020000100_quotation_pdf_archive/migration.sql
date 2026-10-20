BEGIN;
ALTER TABLE "CrmQuotationRevision" ADD COLUMN "archivedPdf" JSONB;
ALTER TABLE "CrmQuotationRevision" ADD CONSTRAINT "CrmQuotationRevision_archive_valid"
  CHECK ("archivedPdf" IS NULL OR jsonb_typeof("archivedPdf") = 'object');

-- Preserve every saved field. The only allowed update attaches an archive once;
-- neither that archive nor the quotation snapshot can subsequently be replaced.
CREATE OR REPLACE FUNCTION app.preserve_quotation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."archivedPdf" IS NULL AND NEW."archivedPdf" IS NOT NULL
      AND (to_jsonb(OLD) - 'archivedPdf') = (to_jsonb(NEW) - 'archivedPdf') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Saved quotation versions are immutable';
END; $$;
COMMIT;
