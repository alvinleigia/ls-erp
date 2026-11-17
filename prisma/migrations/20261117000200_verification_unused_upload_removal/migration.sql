BEGIN;
-- Unused accepted uploads may be removed administratively without publishing or
-- shortening retention. Saved evidence, case holds and transaction proofs remain
-- protected. Existing purposes and the durable disposal lifecycle are unchanged.
ALTER TABLE "VerificationDisposal" DROP CONSTRAINT "VerificationDisposal_purpose_check",
 ADD CONSTRAINT "VerificationDisposal_purpose_check" CHECK(
  (kind='RETENTION' AND "policyVersion" IS NOT NULL AND "retainedEvidenceId" IS NULL)
  OR (kind='DUPLICATE' AND "policyVersion" IS NULL AND "retainedEvidenceId" IS NOT NULL AND "retainedEvidenceId"<>"evidenceId")
  OR (kind='UNSUBMITTED' AND "policyVersion" IS NULL AND "retainedEvidenceId" IS NULL));

CREATE FUNCTION app.verification_unused_original(t text,eid text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE e public."VerificationEvidence"%ROWTYPE;
BEGIN
 IF app.verification_disposal_authority(t,'read') IS DISTINCT FROM true THEN RETURN false; END IF;
 SELECT v.* INTO e FROM public."VerificationEvidence" v
 JOIN public."CustomerVerificationCase" c ON c."tenantId"=v."tenantId" AND c.id=v."caseId"
 WHERE v."tenantId"=t AND v.id=eid AND v.state='READY'
 AND app.verification_subject_visible(t,c."contactId",c."accountId");
 IF e.id IS NULL
 OR EXISTS(SELECT 1 FROM public."VerificationSubmissionEvidence" WHERE "tenantId"=t AND "evidenceId"=eid)
 OR (SELECT action FROM public."VerificationHoldEvent" WHERE "tenantId"=t AND "caseId"=e."caseId" ORDER BY number DESC LIMIT 1)='PLACE'
 OR EXISTS(SELECT 1 FROM public."OrderVerificationAcceptance" a WHERE a."tenantId"=t AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.proof->'participants') p WHERE p->>'caseId'=e."caseId"))
 OR EXISTS(SELECT 1 FROM public."VerificationDisposal" d WHERE d."tenantId"=t AND d."retainedEvidenceId"=eid AND d.state IN ('PENDING','DELETING')) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION app.verification_unused_disposal_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- verification_disposal_write obtains the tenant/evidence locks, checks native
 -- administrator authority, immutable purpose/identity and versioned transitions.
 -- This additional invariant runs on every non-cancelled unused-file transition,
 -- including irreversible start, reconciliation and completion.
 IF NEW.kind='UNSUBMITTED' AND NEW.state<>'CANCELLED'
 AND app.verification_unused_original(NEW."tenantId",NEW."evidenceId") IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Unused removal is blocked by submission history, holds, transaction references or a preserved original' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verification_unused_disposal_write BEFORE INSERT OR UPDATE ON "VerificationDisposal"
 FOR EACH ROW EXECUTE FUNCTION app.verification_unused_disposal_write();
COMMIT;
