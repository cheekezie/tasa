import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/http";
import { BRAND } from "@/config/brand";
import { useAuthStore } from "@/stores/auth.store";
import { Button } from "@/shared/ui/button";
import FormInput from "@/shared/components/FormInput";

/** Staff sign in with the email and password a super admin gave them. */
export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // RequireGuest sends us on to ?next= or the dashboard.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-grey-800">Sign in</h1>
        <p className="mt-1 text-sm text-grey-400">The {BRAND.product} back office, for Tela staff only.</p>
      </div>
      <FormInput
        name="email"
        label="Work email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <FormInput
        name="password"
        label="Password"
        isPassword
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      {import.meta.env.DEV && (
        <SampleAccounts
          onPick={(sample) => {
            setEmail(sample);
            setPassword(DEV_PASSWORD);
          }}
        />
      )}
    </form>
  );
}

/**
 * Local development only (`npm run seed:dev-admins` in tela-api creates them): one account per
 * role, so each role's view is a click away. Production builds drop this, password and all.
 */
const DEV_PASSWORD = import.meta.env.DEV ? "tela-dev-admin" : "";
const DEV_ACCOUNTS = import.meta.env.DEV
  ? [
      { email: "super@tela.dev", role: "Super admin" },
      { email: "finance@tela.dev", role: "Finance" },
      { email: "support@tela.dev", role: "Support" },
      { email: "compliance@tela.dev", role: "Compliance" },
    ]
  : [];

function SampleAccounts({ onPick }: { onPick: (email: string) => void }) {
  return (
    <div className="rounded-lg border border-dashed border-grey-100 p-3">
      <p className="text-xs font-medium text-grey-500">Sample accounts · local only</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DEV_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            type="button"
            onClick={() => onPick(a.email)}
            className="rounded-md border border-grey-50 px-2.5 py-1.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <span className="block text-xs font-medium text-grey-800">{a.role}</span>
            <span className="block truncate text-[11px] text-grey-400">{a.email}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-grey-400">
        Password <span className="font-mono">{DEV_PASSWORD}</span>. Create them with <span className="font-mono">npm run seed:dev-admins</span> in tela-api.
      </p>
    </div>
  );
}
