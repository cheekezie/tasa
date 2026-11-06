import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useReplayWebhook, useWebhook } from "@/features/webhooks/api";
import { PROVIDER_LABELS, SIGNATURE_LABELS, WEBHOOK_STATUS_VARIANTS } from "@/features/webhooks/labels";
import { dateTime } from "@/lib/format";
import appRoutes from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DetailSectionCard } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

/** Bodies are usually JSON; show them indented when they are, untouched when they aren't. */
function pretty(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** One provider callback: exactly what arrived, what processing made of it, and a way to run it again. */
export default function WebhookDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const canReplay = useCan("finance");
  const query = useWebhook(id);
  const replay = useReplayWebhook(id);
  const { ask } = useAskAction();
  const event = query.data;
  const body = useMemo(() => (event ? pretty(event.rawBody) : ""), [event]);

  /** Safe to repeat, and it says why, since staff reach for it when something's already gone wrong. */
  const confirmReplay = () =>
    ask({
      title: "Replay this webhook?",
      confirmText: "Replay",
      description: (
        <div className="space-y-2">
          <p>
            The stored body is processed again, as if it had just arrived. It's safe to repeat: Tela asks{" "}
            {event ? PROVIDER_LABELS[event.provider] : "the provider"} for the real status before any money moves, and nothing can be credited or
            refunded twice.
          </p>
          {event?.status === "processed" && <p>This one was already processed, so a replay should change nothing.</p>}
        </div>
      ),
      onConfirm: async () => {
        try {
          const after = await replay.mutateAsync();
          return {
            message:
              after?.status === "processed"
                ? `Replayed: ${after.result ?? "processed"}`
                : `Replayed, and it was ${after?.status ?? "not found"}${after?.result ? `: ${after.result}` : ""}`,
          };
        } catch (error) {
          throw new Error(`Replay failed: ${error instanceof Error ? error.message : "unknown error"}. The error is saved on the event below.`);
        }
      },
    });

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <BackButton onClick={() => navigate(appRoutes.WEBHOOKS)} />
          <div>
            <h1 className="text-page-title text-grey-800">{event ? `${PROVIDER_LABELS[event.provider]} webhook` : "Webhook"}</h1>
            {event && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-body text-grey-400">Received {dateTime(event.createdAt)}</span>
                <StatusBadge variant={WEBHOOK_STATUS_VARIANTS[event.status]} label={event.status} />
              </div>
            )}
          </div>
        </div>
        {event && canReplay && (
          <Button disabled={replay.isPending} onClick={confirmReplay}>
            {replay.isPending ? "Replaying…" : "Replay"}
          </Button>
        )}
      </div>

      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}

      {event && (
        <div className="space-y-6">
          {event.error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Processing failed</p>
              <p className="mt-1 font-mono text-xs break-words text-grey-600">{event.error}</p>
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSectionCard
              title="Event"
              rows={[
                { label: "Provider", value: PROVIDER_LABELS[event.provider] },
                {
                  label: "Signature",
                  value: SIGNATURE_LABELS[event.signature],
                  ...(event.signature === "invalid" && { valueClassName: "text-destructive" }),
                },
                { label: "Received", value: dateTime(event.createdAt) },
                { label: "Processed", value: dateTime(event.processedAt) },
                { label: "Event ID", value: <span className="font-mono text-xs normal-case">{event.id}</span> },
              ]}
            />
            <DetailSectionCard
              title="Result"
              rows={[
                { label: "Status", value: event.status, type: "status", variant: WEBHOOK_STATUS_VARIANTS[event.status] },
                {
                  label: "Reference",
                  value: event.reference ? (
                    <Link
                      to={`${appRoutes.TRANSACTIONS}?reference=${encodeURIComponent(event.reference)}`}
                      className="font-mono text-xs text-primary normal-case hover:underline"
                    >
                      {event.reference}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "What happened", value: <span className="normal-case">{event.result ?? "—"}</span> },
              ]}
            />
          </section>

          <Panel title="Raw body">
            <p className="mb-3 text-xs text-grey-400">
              Exactly as {PROVIDER_LABELS[event.provider]} sent it. It can hold customer details: don't paste it outside Tela's tools.
            </p>
            <pre className="max-h-[480px] overflow-auto rounded-lg bg-grey-25 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-grey-700">
              {body}
            </pre>
          </Panel>
        </div>
      )}

    </>
  );
}
