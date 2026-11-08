import type { WebhookEvent, WebhookStatus } from "@/features/webhooks/api";
import type { StatusVariant } from "@/shared/components/StatusBadge";

export const WEBHOOK_STATUS_VARIANTS: Record<WebhookStatus, StatusVariant> = {
  received: "warning",
  processed: "success",
  ignored: "inactive",
  failed: "error",
};

export const PROVIDER_LABELS: Record<WebhookEvent["provider"], string> = { sayswitch: "SaySwitch", vtpass: "VTpass" };

export const SIGNATURE_LABELS: Record<WebhookEvent["signature"], string> = {
  valid: "Valid signature",
  invalid: "Invalid signature",
  none: "Unsigned",
};
