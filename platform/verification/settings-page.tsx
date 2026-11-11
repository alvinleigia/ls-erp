"use client"
import { SectionTabs } from "@/components/erp/section-tabs"
import { useBusinessModules } from "@/platform/module-provider"
import { VerificationSettingsControls } from "./settings-controls"
import { VerificationCheckpointSettingsControls } from "./checkpoint-settings-controls"
import { VerificationRetentionSettings } from "./retention-settings-controls"
export function VerificationSettingsPage() {
  const { can } = useBusinessModules()
  return <SectionTabs scope="verification-settings" keepMounted tabs={[
    ...(can("verificationPolicies.read") ? [{ value: "requirements", label: "Requirements", content: <VerificationSettingsControls /> }] : []),
    ...(can("verificationCheckpoints.read") ? [{ value: "checkpoints", label: "Transaction checkpoints", content: <VerificationCheckpointSettingsControls /> }] : []),
    ...(can("verificationRetention.read") ? [{ value: "retention", label: "Retention", content: <VerificationRetentionSettings /> }] : []),
  ]} />
}
