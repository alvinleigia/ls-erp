BEGIN;
-- Retention remains unchanged. A separate purpose removes only exact,
-- unreferenced duplicates and pins the older surviving original during removal.
ALTER TABLE "VerificationDisposal" ALTER COLUMN "policyVersion" DROP NOT NULL,
 ADD COLUMN kind text NOT NULL DEFAULT 'RETENTION', ADD COLUMN "retainedEvidenceId" text,
 ADD CONSTRAINT "VerificationDisposal_purpose_check" CHECK(
  (kind='RETENTION' AND "policyVersion" IS NOT NULL AND "retainedEvidenceId" IS NULL)
  OR (kind='DUPLICATE' AND "policyVersion" IS NULL AND "retainedEvidenceId" IS NOT NULL AND "retainedEvidenceId"<>"evidenceId")),
 ADD CONSTRAINT "VerificationDisposal_retained_evidence_fk" FOREIGN KEY("tenantId","caseId","retainedEvidenceId") REFERENCES "VerificationEvidence"("tenantId","caseId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VerificationDisposal_retained_active_idx" ON "VerificationDisposal"("tenantId","retainedEvidenceId") WHERE state IN ('PENDING','DELETING');
CREATE FUNCTION app.verification_duplicate_original(t text,eid text) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE e public."VerificationEvidence"%ROWTYPE; keeper text;
BEGIN
 IF app.verification_disposal_authority(t,'read') IS DISTINCT FROM true THEN RETURN NULL; END IF;
 SELECT v.* INTO e FROM public."VerificationEvidence" v JOIN public."CustomerVerificationCase" c ON c."tenantId"=v."tenantId" AND c.id=v."caseId"
 WHERE v."tenantId"=t AND v.id=eid AND v.state='READY' AND app.verification_subject_visible(t,c."contactId",c."accountId");
 IF e.id IS NULL
 OR EXISTS(SELECT 1 FROM public."VerificationSubmissionEvidence" WHERE "tenantId"=t AND "evidenceId"=eid)
 OR (SELECT action FROM public."VerificationHoldEvent" WHERE "tenantId"=t AND "caseId"=e."caseId" ORDER BY number DESC LIMIT 1)='PLACE'
 OR EXISTS(SELECT 1 FROM public."OrderVerificationAcceptance" a WHERE a."tenantId"=t AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.proof->'participants') p WHERE p->>'caseId'=e."caseId"))
 OR EXISTS(SELECT 1 FROM public."VerificationDisposal" d WHERE d."tenantId"=t AND d."retainedEvidenceId"=eid AND d.state IN ('PENDING','DELETING')) THEN RETURN NULL; END IF;
 SELECT k.id INTO keeper FROM public."VerificationEvidence" k
 WHERE k."tenantId"=t AND k."caseId"=e."caseId" AND k.state='READY' AND k."documentCode"=e."documentCode"
 AND k."contentType"=e."contentType" AND k.bytes=e.bytes AND k.sha256=e.sha256 AND k.sha256 IS NOT NULL
 AND (k."createdAt",k.id COLLATE "C")<(e."createdAt",e.id COLLATE "C")
 AND NOT EXISTS(SELECT 1 FROM public."VerificationDisposal" d WHERE d."tenantId"=t AND d."evidenceId"=k.id AND d.state<>'CANCELLED')
 ORDER BY k."createdAt",k.id COLLATE "C" LIMIT 1;
 RETURN keeper;
END $$;
CREATE OR REPLACE FUNCTION app.verification_disposal_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision jsonb; e "VerificationEvidence"%ROWTYPE; operation text; uid text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Disposal history is retained' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 operation:=CASE WHEN TG_OP='INSERT' THEN 'create' WHEN NEW.state='CANCELLED' THEN 'cancel' ELSE 'approve' END;
 IF app.verification_disposal_authority(NEW."tenantId",operation) IS DISTINCT FROM true OR NEW."actorUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Administrative disposal authority is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM "VerificationEvidence" WHERE "tenantId"=NEW."tenantId" AND "caseId"=NEW."caseId" AND id=NEW."evidenceId" FOR UPDATE;
 IF e.id IS NULL OR e.state<>'READY' THEN RAISE EXCEPTION 'Choose an accepted original' USING ERRCODE='23514'; END IF;
 IF NEW.state<>'CANCELLED' AND EXISTS(SELECT 1 FROM "VerificationDisposal" d WHERE d."tenantId"=NEW."tenantId" AND d."retainedEvidenceId"=e.id AND d.state IN ('PENDING','DELETING')) THEN
  RAISE EXCEPTION 'This original is preserved by a duplicate removal request' USING ERRCODE='23514';
 END IF;
 IF NEW.kind='DUPLICATE' AND NEW.state<>'CANCELLED' THEN
  IF app.verification_duplicate_original(NEW."tenantId",e.id) IS DISTINCT FROM NEW."retainedEvidenceId" OR NEW."retainedEvidenceId" IS NULL THEN RAISE EXCEPTION 'Duplicate removal requires an older matching original without holds or saved references' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='RETENTION' AND (TG_OP='INSERT' OR (OLD.state='PENDING' AND NEW.state='DELETING')) THEN
  decision:=app.verification_retention_decision(NEW."tenantId",e.id);
  IF decision->>'decision' IS DISTINCT FROM 'REVIEW' OR (decision->>'policyVersion')::integer IS DISTINCT FROM NEW."policyVersion" THEN RAISE EXCEPTION 'Disposal is blocked by retention, holds or saved references' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.state<>'PENDING' OR NEW."createdByUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Start with a pending disposal request' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=statement_timestamp(); NEW."startedAt":=NULL; NEW."retryAfter":=NULL; NEW."completedAt":=NULL;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."caseId",NEW."evidenceId",NEW."policyVersion",NEW.kind,NEW."retainedEvidenceId",NEW."previewHash",NEW.reason,NEW."createdByUserId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."caseId",OLD."evidenceId",OLD."policyVersion",OLD.kind,OLD."retainedEvidenceId",OLD."previewHash",OLD.reason,OLD."createdByUserId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR OLD.state IN ('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'Disposal identity and terminal history are immutable' USING ERRCODE='23514'; END IF;
  NEW."startedAt":=OLD."startedAt"; NEW."retryAfter":=OLD."retryAfter"; NEW."completedAt":=OLD."completedAt";
  IF NEW.state='DELETING' AND OLD.state IN ('PENDING','DELETING') THEN
   IF OLD.state='DELETING' AND OLD."retryAfter">clock_timestamp() THEN RAISE EXCEPTION 'Wait for the current removal attempt before reconciliation' USING ERRCODE='23514'; END IF;
   NEW."startedAt":=coalesce(OLD."startedAt",statement_timestamp()); NEW."retryAfter":=statement_timestamp()+interval '3 minutes';
  ELSIF OLD.state='DELETING' AND NEW.state='COMPLETED' THEN
   IF EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" WHERE "tenantId"=NEW."tenantId" AND "evidenceId"=e.id) OR (SELECT action FROM "VerificationHoldEvent" WHERE "tenantId"=NEW."tenantId" AND "caseId"=e."caseId" ORDER BY number DESC LIMIT 1)='PLACE' OR EXISTS(SELECT 1 FROM "OrderVerificationAcceptance" a WHERE a."tenantId"=NEW."tenantId" AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.proof->'participants') p WHERE p->>'caseId'=e."caseId")) THEN RAISE EXCEPTION 'Preservation references changed; reconcile before completion' USING ERRCODE='23514'; END IF;
   NEW."completedAt":=statement_timestamp(); NEW."retryAfter":=NULL;
  ELSIF NOT(OLD.state='PENDING' AND NEW.state='CANCELLED') THEN RAISE EXCEPTION 'An irreversible disposal cannot be cancelled or reopened' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
