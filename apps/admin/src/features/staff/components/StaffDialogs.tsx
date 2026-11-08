import { useState } from "react";
import { toast } from "sonner";
import { useCreateStaff, useResetStaffPassword, useUpdateStaff, type StaffChanges, type StaffMember } from "@/features/staff/api";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { MIN_PASSWORD, ROLE_INFO } from "@/features/staff/roles";
import { ADMIN_ROLES, useAuthStore, type AdminRole } from "@/stores/auth.store";

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: AdminRole; onChange: (r: AdminRole) => void; disabled?: boolean }) {
  return (
    <>
      <Select value={value} onValueChange={(v) => onChange(v as AdminRole)} {...(disabled ? { disabled } : {})}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {ADMIN_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_INFO[r].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-grey-400">{ROLE_INFO[value].does}</p>
    </>
  );
}

const ErrorLine = ({ error }: { error: Error | null }) => (error ? <p className="text-sm text-destructive">{error.message}</p> : null);

export function CreateStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateStaff();
  const [form, setForm] = useState({ name: "", email: "", role: "support" as AdminRole, password: "" });
  const valid = form.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(form.email.trim()) && form.password.length >= MIN_PASSWORD;

  const close = (o: boolean) => {
    if (!o) {
      setForm({ name: "", email: "", role: "support", password: "" });
      create.reset();
    }
    onOpenChange(o);
  };

  const submit = () =>
    create.mutate(
      { name: form.name.trim(), email: form.email.trim(), role: form.role, password: form.password },
      {
        onSuccess: (s) => {
          toast.success(`${s.name} can now sign in`);
          close(false);
        },
      },
    );

  return (
    <ConfirmationModal
      open={open}
      onOpenChange={close}
      title="Add a staff member"
      primaryAction={{ label: create.isPending ? "Adding…" : "Add staff member", onClick: submit, disabled: create.isPending || !valid }}
      secondaryAction={{ label: "Cancel", closeOnClick: true }}
    >
      <div className="space-y-4 p-2 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="staff-name">Name</Label>
          <Input id="staff-name" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="staff-email">Work email</Label>
          <Input id="staff-email" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="staff-role">Role</Label>
          <RoleSelect id="staff-role" value={form.role} onChange={(role) => setForm({ ...form, role })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="staff-password">Temporary password</Label>
          <Input id="staff-password" isPassword autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <p className="text-xs text-grey-400">At least {MIN_PASSWORD} characters. Share it privately; they can change it under My account.</p>
        </div>
        <ErrorLine error={create.error} />
      </div>
    </ConfirmationModal>
  );
}

/** Name, role and access. The API refuses changing your own role or access, and removing the last super admin. */
export function EditStaffDialog({ member, isSelf, onClose }: { member: StaffMember; isSelf: boolean; onClose: () => void }) {
  const update = useUpdateStaff();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<AdminRole>(member.role);
  const [isActive, setIsActive] = useState(member.isActive);

  const changes: StaffChanges = {
    ...(name.trim() !== member.name ? { name: name.trim() } : {}),
    ...(role !== member.role ? { role } : {}),
    ...(isActive !== member.isActive ? { isActive } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const valid = name.trim().length >= 2;

  const submit = () =>
    update.mutate(
      { id: member.id, changes },
      {
        onSuccess: (s) => {
          // Keep the header's name in step when you rename yourself.
          if (isSelf) useAuthStore.setState((st) => ({ user: st.user ? { ...st.user, name: s.name } : st.user }));
          toast.success(changes.isActive === false ? `${s.name} is deactivated and signed out` : `${s.name} updated`);
          onClose();
        },
      },
    );

  return (
    <ConfirmationModal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${member.name}`}
      primaryAction={{ label: update.isPending ? "Saving…" : "Save changes", onClick: submit, disabled: update.isPending || !dirty || !valid }}
      secondaryAction={{ label: "Cancel", closeOnClick: true }}
    >
      <div className="space-y-4 p-2 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-role">Role</Label>
          <RoleSelect id="edit-role" value={role} onChange={setRole} disabled={isSelf} />
          {role !== member.role && <p className="text-xs text-grey-500">Takes effect on their next request; no sign-in needed.</p>}
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-grey-50 p-3">
          <div>
            <Label htmlFor="edit-active">Back-office access</Label>
            <p className="mt-0.5 text-xs text-grey-400">
              {isActive ? "Can sign in." : "Deactivated: signed out everywhere and can't sign in until reactivated."}
            </p>
          </div>
          <Switch id="edit-active" checked={isActive} disabled={isSelf} onCheckedChange={setIsActive} />
        </div>
        {isSelf && <p className="text-xs text-grey-400">You can't change your own role or access. Ask another super admin.</p>}
        <ErrorLine error={update.error} />
      </div>
    </ConfirmationModal>
  );
}

export function ResetPasswordDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const reset = useResetStaffPassword();
  const [password, setPassword] = useState("");

  const submit = () =>
    reset.mutate(
      { id: member.id, password },
      {
        onSuccess: () => {
          toast.success(`${member.name}'s password is reset and they've been signed out`);
          onClose();
        },
      },
    );

  return (
    <ConfirmationModal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset ${member.name}'s password`}
      primaryAction={{
        label: reset.isPending ? "Resetting…" : "Reset password",
        variant: "destructive",
        onClick: submit,
        disabled: reset.isPending || password.length < MIN_PASSWORD,
      }}
      secondaryAction={{ label: "Cancel", closeOnClick: true }}
    >
      <div className="space-y-4 p-2 text-sm">
        <p className="text-grey-500">They're signed out on every device and must sign in with the new password.</p>
        <div className="space-y-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <Input id="reset-password" isPassword autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-grey-400">At least {MIN_PASSWORD} characters.</p>
        </div>
        <ErrorLine error={reset.error} />
      </div>
    </ConfirmationModal>
  );
}
