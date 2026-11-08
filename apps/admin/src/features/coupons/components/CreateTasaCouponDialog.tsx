import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreateTasaCoupon, type TasaCouponInput } from "@/features/coupons/api";
import { FormField, NairaInput, ServicesPicker } from "@/features/coupons/components/FormBits";
import { fieldErrors, koboFromInput, type ServiceId } from "@/features/coupons/money";
import { count, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

type Kind = "coupon" | "gift";
type RecipientType = "username" | "phone" | "email";

const RECIPIENT_PLACEHOLDER: Record<RecipientType, string> = { username: "ada_lovelace", phone: "08031234567", email: "ada@example.com" };

/**
 * A giveaway Tasa pays for. Nothing moves now: each use is booked as a cost when it happens,
 * so the ceiling (amount × people) is what this could cost at most.
 */
export function CreateTasaCouponDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* Remounted on every open, so the form starts empty. */}
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const create = useCreateTasaCoupon();
  const [kind, setKind] = useState<Kind>("coupon");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [services, setServices] = useState<"all" | ServiceId[]>("all");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("phone");
  const [recipientValue, setRecipientValue] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...fieldErrors(create.error), ...local };
  const amountKobo = koboFromInput(amount);
  const people = kind === "gift" ? 1 : Number(quantity) || 0;

  const submit = () => {
    const problems: Record<string, string> = {};
    if (amountKobo === null || amountKobo <= 0) problems.amount = "Enter an amount in naira";
    if (!expiresAt) problems.expiresAt = "Choose when it expires";
    if (kind === "coupon" && services !== "all" && services.length === 0) problems.services = "Pick at least one service, or every bill";
    setLocal(problems);
    if (Object.keys(problems).length > 0 || amountKobo === null) return;

    const shared = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      amount: amountKobo,
      expiresAt: new Date(expiresAt).toISOString(),
    };
    const body: TasaCouponInput =
      kind === "coupon"
        ? { kind, ...shared, quantity: Number(quantity), services, ...(code.trim() ? { code: code.trim().toUpperCase() } : {}) }
        : {
            kind,
            ...shared,
            recipient: { type: recipientType, value: recipientValue.trim() },
            ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
            ...(message.trim() ? { message: message.trim() } : {}),
          };

    create.mutate(body, {
      onSuccess: (coupon) => {
        toast.success(kind === "gift" ? `Gift sent · code ${coupon.code}` : `Giveaway ${coupon.code} is live`);
        onDone();
        navigate(toPath(appRoutes.COUPON, { id: coupon.id }));
      },
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">New Tasa giveaway</DialogTitle>
        <DialogDescription>Paid for by Tasa. Each use is booked as a cost when it happens.</DialogDescription>
      </DialogHeader>

      <div className="inline-flex rounded-lg border border-grey-50 bg-white p-0.5">
        {(["coupon", "gift"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", kind === k ? "bg-primary text-white" : "text-grey-500 hover:bg-grey-25")}
          >
            {k === "coupon" ? "Giveaway for many people" : "Gift for one person"}
          </button>
        ))}
      </div>

      <FormField id="tc-title" label="Title" error={errors.title} hint="Shown to people in the app.">
        <Input id="tc-title" maxLength={60} value={title} error={!!errors.title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "gift" ? "Sorry about your token" : "Launch week giveaway"} />
      </FormField>

      <FormField id="tc-desc" label="Description (optional)" error={errors.description}>
        <Textarea id="tc-desc" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="tc-amount" label={kind === "gift" ? "Gift amount" : "Amount per person"} error={errors.amount} hint="₦100 to ₦100,000, spent across bills.">
          <NairaInput id="tc-amount" value={amount} error={!!errors.amount} onChange={setAmount} placeholder="1000" />
        </FormField>
        {kind === "coupon" && (
          <FormField id="tc-qty" label="How many people" error={errors.quantity}>
            <Input id="tc-qty" type="number" min={1} max={100000} value={quantity} error={!!errors.quantity} onChange={(e) => setQuantity(e.target.value)} />
          </FormField>
        )}
      </div>

      {kind === "coupon" ? (
        <>
          <FormField label="Works on" error={errors.services}>
            <ServicesPicker value={services} onChange={setServices} />
          </FormField>
          <FormField id="tc-code" label="Code (optional)" error={errors.code} hint="4–24 letters, numbers or dashes. Leave blank to generate one.">
            <Input id="tc-code" maxLength={24} value={code} error={!!errors.code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH500" className="font-mono" />
          </FormField>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <FormField label="Send to" error={errors.recipient}>
              <Select value={recipientType} onValueChange={(v) => setRecipientType(v as RecipientType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="username">Tasa username</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="tc-rcpt" label="Recipient" error={errors["recipient.value"]} hint="Not on Tasa yet? They're invited, and the gift waits for them.">
              <Input id="tc-rcpt" value={recipientValue} error={!!errors["recipient.value"]} onChange={(e) => setRecipientValue(e.target.value)} placeholder={RECIPIENT_PLACEHOLDER[recipientType]} />
            </FormField>
          </div>
          <FormField id="tc-rname" label="Their name (optional)" error={errors.recipientName}>
            <Input id="tc-rname" maxLength={60} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          </FormField>
          <FormField id="tc-msg" label="Message (optional)" error={errors.message}>
            <Textarea id="tc-msg" maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Sorry about the delay. This one's on us." />
          </FormField>
        </>
      )}

      <FormField id="tc-exp" label="Expires" error={errors.expiresAt}>
        <Input id="tc-exp" type="datetime-local" value={expiresAt} error={!!errors.expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </FormField>

      {amountKobo !== null && amountKobo > 0 && people > 0 && (
        <p className="rounded-lg bg-grey-25 p-3 text-sm text-grey-500">
          Most this can cost Tasa: <span className="font-medium text-grey-800">{naira(amountKobo * people)}</span>
          {kind === "coupon" && ` (${naira(amountKobo)} × ${count(people)} people)`}.
          {kind === "gift" && " The recipient is told by SMS or email, and in the app."}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : kind === "gift" ? "Send gift" : "Create giveaway"}
        </Button>
      </DialogFooter>
    </form>
  );
}
