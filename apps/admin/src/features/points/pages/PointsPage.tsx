import appRoutes from "@/routes/appRoutes";
import { Link } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { useChargePreview } from "@/features/charges/api";
import { FormField, NairaInput } from "@/features/coupons/components/FormBits";
import { fieldErrors, inputFromKobo, koboFromInput } from "@/features/coupons/money";
import { usePoints, useUpdatePoints, type PointsSettings } from "@/features/points/api";
import { count, dateTime, naira, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { useCan } from "@/stores";

/** A small transfer: the cheapest charge a looping transfer would pay. */
const SAMPLE_TRANSFER = 10_000;

/** How points are earned and what they're worth, and what Tasa still owes in unconverted points. */
export default function PointsPage() {
  const query = usePoints();
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Points"
        subtitle="Users earn points on bills and transfers, and convert them to wallet cash."
        actions={[
          <Button key="users" asChild variant="outline">
            <Link to={appRoutes.POINTS_USERS}>Points by user</Link>
          </Button>,
        ]}
      />
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Points not yet converted" value={count(data.outstanding.points)} hint="Across every user" />
            <Metric
              label="Cost still to come"
              value={naira(data.outstanding.value)}
              hint="If every point converted today. It reaches the books only when points convert."
            />
            <Metric
              label="Earning"
              value={data.settings.active ? "On" : "Off"}
              tone={data.settings.active ? "good" : "default"}
              hint={data.settings.updatedAt ? `Settings changed ${dateTime(data.settings.updatedAt)}` : undefined}
            />
          </div>
          {/* Remounts after a save so the form shows what the API stored. */}
          <SettingsForm key={data.settings.updatedAt ?? "settings"} settings={data.settings} />
        </div>
      )}
    </>
  );
}

function SettingsForm({ settings }: { settings: PointsSettings }) {
  const canEdit = useCan("finance");
  const update = useUpdatePoints();
  const transferCharge = useChargePreview({ scope: "transfer", amount: SAMPLE_TRANSFER });

  const [active, setActive] = useState(settings.active);
  const [billPoints, setBillPoints] = useState(String(settings.billPointsPer100Naira));
  const [transferPoints, setTransferPoints] = useState(String(settings.transferPoints));
  const [pointValue, setPointValue] = useState(inputFromKobo(settings.pointValue));
  const [minRedeem, setMinRedeem] = useState(String(settings.minRedeemPoints));
  const [local, setLocal] = useState<Record<string, string>>({});
  const errors = { ...fieldErrors(update.error), ...local };

  const valueKobo = koboFromInput(pointValue) ?? 0;
  const transferWorth = (Number(transferPoints) || 0) * valueKobo;
  const billBack = (Number(billPoints) || 0) * valueKobo; // kobo back per ₦100 (10,000 kobo) paid
  const charge = transferCharge.data?.fee;
  const loopProfit = charge !== undefined && transferWorth >= charge && transferWorth > 0;

  const save = () => {
    const problems: Record<string, string> = {};
    if (!Number.isInteger(valueKobo) || valueKobo < 1) problems.pointValue = "At least ₦0.01 (1 kobo)";
    if (!Number.isInteger(Number(transferPoints))) problems.transferPoints = "A whole number of points";
    if (!Number.isInteger(Number(minRedeem)) || Number(minRedeem) < 1) problems.minRedeemPoints = "A whole number, at least 1";
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    update.mutate(
      {
        active,
        billPointsPer100Naira: Number(billPoints),
        transferPoints: Number(transferPoints),
        pointValue: valueKobo,
        minRedeemPoints: Number(minRedeem),
      },
      { onSuccess: () => toast.success("Points settings saved. Every server picks them up within 30 seconds.") },
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Panel title="Settings">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex items-center justify-between gap-4 rounded-lg border border-grey-50 px-3 py-2.5">
            <span>
              <span className="block text-sm text-grey-800">Earning points</span>
              <span className="block text-xs text-grey-400">Off stops new points. People can still convert what they have.</span>
            </span>
            <Switch checked={active} disabled={!canEdit} onCheckedChange={setActive} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="pt-bill" label="Points per ₦100 paid on a bill" error={errors.billPointsPer100Naira} hint="Only what the user paid themselves, after discounts.">
              <Input id="pt-bill" type="number" step="0.1" min={0} max={100} disabled={!canEdit} value={billPoints} error={!!errors.billPointsPer100Naira} onChange={(e) => setBillPoints(e.target.value)} />
            </FormField>
            <FormField id="pt-transfer" label="Points per transfer" error={errors.transferPoints}>
              <Input id="pt-transfer" type="number" min={0} max={1000} disabled={!canEdit} value={transferPoints} error={!!errors.transferPoints} onChange={(e) => setTransferPoints(e.target.value)} />
            </FormField>
            <FormField id="pt-value" label="One point is worth" error={errors.pointValue} hint="Paid into the wallet when points convert.">
              <NairaInput id="pt-value" disabled={!canEdit} value={pointValue} error={!!errors.pointValue} onChange={setPointValue} />
            </FormField>
            <FormField id="pt-min" label="Fewest points to convert" error={errors.minRedeemPoints} hint={valueKobo ? `= ${naira((Number(minRedeem) || 0) * valueKobo)}` : undefined}>
              <Input id="pt-min" type="number" min={1} disabled={!canEdit} value={minRedeem} error={!!errors.minRedeemPoints} onChange={(e) => setMinRedeem(e.target.value)} />
            </FormField>
          </div>
          {canEdit ? (
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save settings"}
            </Button>
          ) : (
            <p className="text-xs text-grey-400">Only finance can change points settings.</p>
          )}
        </form>
      </Panel>

      <div className="space-y-6">
        <Panel title="What this pays out">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-grey-500">Back on bills</dt>
              <dd className="text-grey-800">
                {naira(billBack)} per ₦100 ({percent(billBack / 100, 2)})
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-grey-500">Each transfer earns</dt>
              <dd className="text-grey-800">{naira(transferWorth)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-grey-500">Charge on a {naira(SAMPLE_TRANSFER)} transfer</dt>
              <dd className="text-grey-800">{transferCharge.isPending ? "…" : transferCharge.isError ? "—" : naira(charge)}</dd>
            </div>
          </dl>
        </Panel>
        <div
          className={cn(
            "rounded-xl border p-4 text-sm",
            loopProfit ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-grey-50 bg-white text-grey-500",
          )}
        >
          <div className="mb-1 flex items-center gap-2">
            <p className="font-medium text-grey-800">Keep a transfer's points worth less than its charge</p>
            {loopProfit && <StatusBadge variant="error" label="Too high" />}
          </div>
          <p>
            Otherwise people can send money back and forth between their own accounts and earn more in points than they pay in charges.
            {loopProfit && ` Right now a transfer earns ${naira(transferWorth)} but costs ${naira(charge)}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
