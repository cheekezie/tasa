import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useChangePassword, useMe } from "@/features/account/api";
import { MIN_PASSWORD, ROLE_INFO } from "@/features/staff/roles";
import { dateTime } from "@/lib/format";
import appRoutes from "@/routes/appRoutes";
import { DetailRow } from "@/shared/components/DetailSectionCard";
import { LoadFailed, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { useAuthStore } from "@/stores/auth.store";

/** Who you're signed in as, and your password. */
export default function AccountPage() {
  const query = useMe();
  const me = query.data;

  return (
    <>
      <PageHeader title="My account" subtitle="Your back-office profile and password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Signed in as">
          {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
          {query.isPending && <Skeleton className="h-36 rounded-lg" />}
          {me && (
            <div className="space-y-2.5 text-sm">
              <DetailRow label="Name" value={me.name} />
              <DetailRow label="Email" value={me.email} />
              <DetailRow label="Role" value={ROLE_INFO[me.role].label} />
              <p className="text-xs text-grey-400">{ROLE_INFO[me.role].does}. Only a super admin can change your role.</p>
              <DetailRow label="Last sign-in" value={dateTime(me.lastLoginAt)} />
              <DetailRow label="Added" value={dateTime(me.createdAt)} />
            </div>
          )}
        </Panel>
        <ChangePassword />
      </div>
    </>
  );
}

/** Changing it ends every session you have, so we sign you out here too and you sign in with the new one. */
function ChangePassword() {
  const change = useChangePassword();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: async () => {
          toast.success("Password changed. Sign in again with your new password, here and on your other devices.");
          await logout();
          navigate(appRoutes.AUTH.LOGIN, { replace: true });
        },
      },
    );
  };

  return (
    <Panel title="Change password">
      <form className="space-y-4 text-sm" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input id="current-password" isPassword autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" isPassword autoComplete="new-password" error={tooShort} value={next} onChange={(e) => setNext(e.target.value)} />
          <p className={tooShort ? "text-xs text-destructive" : "text-xs text-grey-400"}>At least {MIN_PASSWORD} characters.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" isPassword autoComplete="new-password" error={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <p className="text-xs text-destructive">Doesn't match the new password.</p>}
        </div>
        {change.isError && <p className="text-sm text-destructive">{change.error.message}</p>}
        <p className="text-xs text-grey-400">You'll be signed out everywhere, including here, and sign in again with the new password.</p>
        <Button type="submit" disabled={!valid || change.isPending}>
          {change.isPending ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Panel>
  );
}
