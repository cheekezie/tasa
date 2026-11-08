import { useState } from "react";
import { toast } from "sonner";
import { useAdminConfig, useSetFeature, useSetMaintenance, type FeatureState } from "@/features/config/api";
import { dateTime } from "@/lib/format";
import PageHeader from "@/shared/components/PageHeader";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

/** Which features the app offers right now, and whether it's up at all. */
export default function SwitchesPage() {
  const query = useAdminConfig();
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Switches & maintenance"
        subtitle="Turn features off for everyone in about a minute. Money already moving always finishes."
      />
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && <Skeleton className="h-96 rounded-xl" />}
      {data && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Panel title="Features">
            <ul className="divide-y divide-grey-50">
              {Object.entries(data.labels).map(([code, label]) => (
                <FeatureRow key={code} code={code} label={label} state={data.features[code] ?? { enabled: true, message: null }} />
              ))}
            </ul>
          </Panel>
          <Maintenance
            active={data.maintenance.active}
            message={data.maintenance.message}
            until={data.maintenance.until}
            startedAt={data.maintenanceStartedAt}
          />
        </div>
      )}
    </>
  );
}

/** One feature: on or off, and what people are told while it's off. */
function FeatureRow({ code, label, state }: { code: string; label: string; state: FeatureState }) {
  const canEdit = useCan("support");
  const setFeature = useSetFeature();
  const { ask } = useAskAction();
  const isService = code.startsWith("bill_");

  /** Turning off reaches everyone within a minute, so it's confirmed, with what the app will say. */
  const confirmOff = () =>
    ask({
      title: `Turn off ${label.toLowerCase()}?`,
      variant: "danger",
      confirmText: "Turn off",
      description: (
        <p>
          New {label.toLowerCase()} stop for everyone within a minute. Anything already in progress finishes, and nobody loses money.
        </p>
      ),
      input: {
        label: "What should the app say? (optional)",
        placeholder: `${label} is paused for now. Try again later.`,
        variant: "textarea",
        maxLength: 200,
      },
      onConfirm: async ({ inputValue }) => {
        await setFeature.mutateAsync({ code, enabled: false, ...(inputValue ? { message: inputValue } : {}) });
        return { message: `${label} is off` };
      },
    });

  return (
    <li className={`flex items-start justify-between gap-4 py-3 ${isService ? "pl-6" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-grey-800">{label}</p>
          {!state.enabled && <StatusBadge variant="warning" label="Off" />}
        </div>
        <p className="mt-0.5 font-mono text-xs text-grey-300">{code}</p>
        {!state.enabled && state.message && <p className="mt-1 text-xs text-grey-500">“{state.message}”</p>}
      </div>
      <Switch
        checked={state.enabled}
        disabled={!canEdit || setFeature.isPending}
        aria-label={`${label} ${state.enabled ? "on" : "off"}`}
        onCheckedChange={(on) => {
          if (!on) confirmOff();
          else setFeature.mutate({ code, enabled: true }, { onSuccess: () => toast.success(`${label} is back on`) });
        }}
      />
    </li>
  );
}

/** Takes the whole app offline. Super admins only; the back office and webhooks stay up. */
function Maintenance({ active, message, until, startedAt }: { active: boolean; message: string | null; until: string | null; startedAt: string | null }) {
  const canEdit = useCan("super_admin");
  const setMaintenance = useSetMaintenance();
  const [draft, setDraft] = useState("");
  const [back, setBack] = useState("");
  const { ask } = useAskAction();

  const confirmStart = () =>
    ask({
      title: "Take the app offline?",
      variant: "danger",
      confirmText: "Start maintenance",
      description: <p>Everyone using the app is shown the maintenance screen until you end it, including anyone mid-payment.</p>,
      onConfirm: async () => {
        await setMaintenance.mutateAsync({
          active: true,
          ...(draft.trim() ? { message: draft.trim() } : {}),
          ...(back ? { until: new Date(back).toISOString() } : {}),
        });
        return { message: "The app is in maintenance" };
      },
    });

  return (
    <Panel title="Maintenance mode">
      {active ? (
        <div className="space-y-3">
          <StatusBadge variant="error" label="App is offline" />
          <p className="text-sm text-grey-500">Since {dateTime(startedAt)}{until ? ` · back by ${dateTime(until)}` : ""}</p>
          {message && <p className="rounded-lg bg-grey-25 p-3 text-sm text-grey-500">“{message}”</p>}
          <Button
            className="w-full"
            disabled={!canEdit || setMaintenance.isPending}
            onClick={() => setMaintenance.mutate({ active: false }, { onSuccess: () => toast.success("The app is back online") })}
          >
            End maintenance
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <StatusBadge variant="success" label="App is online" />
          <p className="text-sm text-grey-500">
            Every app user sees a maintenance screen until you end it. Payments already moving still complete.
          </p>
          {canEdit ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mm-message">Message (optional)</Label>
                <Textarea id="mm-message" maxLength={200} placeholder="We're making Tasa better. We'll be back shortly." value={draft} onChange={(e) => setDraft(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mm-until">Expected back (optional, only shown)</Label>
                <Input id="mm-until" type="datetime-local" value={back} onChange={(e) => setBack(e.target.value)} />
              </div>
              <Button variant="destructive" className="w-full" onClick={confirmStart}>
                Start maintenance
              </Button>
            </>
          ) : (
            <p className="text-xs text-grey-400">Only super admins can start maintenance.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
