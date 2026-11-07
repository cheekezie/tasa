import { CircleAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { naira } from "@/lib/quickpay";
import { site } from "@/lib/site";

type Period = { index: number; start: string | null; end: string | null };
type Receipt = {
  reference: string;
  paidAt: string;
  amount: number;
  payer: {
    name: string | null;
    matricNumber: string | null;
    department: string | null;
  };
  group: {
    name: string;
    logoUrl: string | null;
  };
  dues: {
    name: string;
    kind: "recurring" | "one_off" | null;
    period: "weekly" | "monthly" | "yearly" | null;
    periods: Period[];
  }[];
};
type Props = { params: Promise<{ code: string }> };

const cleanCode = (raw: string) =>
  raw
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 60);

/** Asked fresh every time: whoever scans it should see what Tasa holds now. */
async function lookup(code: string): Promise<Receipt | null> {
  if (code.length < 10) return null;
  try {
    const res = await fetch(
      `${site.apiUrl}/public/receipts/${encodeURIComponent(code)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { data: Receipt }).data;
  } catch {
    return null;
  }
}

const DAY = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
});
const PAID_AT = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

/** "1 Sep 2025 – 31 Aug 2026": the days a period covered, its end being the next one's start. */
function periodLabel(p: Period) {
  if (!p.start || !p.end) return null;
  const last = new Date(new Date(p.end).getTime() - 86_400_000);
  return `${DAY.format(new Date(p.start))} – ${DAY.format(last)}`;
}

export const metadata: Metadata = {
  title: { absolute: "Dues receipt · Tasa" },
  description: "Check a dues payment made on Tasa.",
  // Receipts are private to the student who shows them.
  robots: { index: false, follow: false },
};

/**
 * What a dues receipt's QR code opens: a department's clearance desk scans it and sees, from
 * Tasa, who paid which dues to which group. No sign-in; the code in the link is signed by the
 * API, so a made-up or altered one shows as not found.
 */
export default async function ReceiptPage({ params }: Props) {
  const code = cleanCode((await params).code);
  const receipt = await lookup(code);

  return (
    <main className="flex min-h-screen flex-col items-center bg-surface px-4 py-10">
      <Link href="/" aria-label="Tasa home">
        <Image
          src="/brand/tela-logo.png"
          alt="Tasa"
          width={88}
          height={42}
          priority
          className="h-8 w-auto"
        />
      </Link>

      {receipt ? (
        <div className="animate-fade-up mt-10 w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-xl shadow-brand-deep/5 ring-1 ring-line">
          <div className="flex items-center gap-3 bg-brand px-6 py-4 text-white">
            <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Payment confirmed by Tasa</p>
              <p className="text-xs text-white/75">
                Checked {PAID_AT.format(new Date())}
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-4">
              {receipt.group.logoUrl ? (
                // A group's own picture, from Tasa's storage: shown as-is.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={receipt.group.logoUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-line"
                />
              ) : (
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-mint text-xl font-semibold text-brand">
                  {receipt.group.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-brand-deep">
                  {receipt.group.name}
                </p>
                <p className="text-sm text-ink-muted">Tasa group</p>
              </div>
            </div>

            <dl className="mt-6 space-y-3 rounded-2xl bg-track p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Paid by</dt>
                <dd className="text-right font-medium text-ink">
                  {receipt.payer.name ?? "A Tasa member"}
                </dd>
              </div>
              {receipt.payer.matricNumber && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Matric number</dt>
                  <dd className="font-mono font-medium text-ink">
                    {receipt.payer.matricNumber}
                  </dd>
                </div>
              )}
              {receipt.payer.department && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Department</dt>
                  <dd className="text-right text-ink">
                    {receipt.payer.department}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Paid on</dt>
                <dd className="text-right text-ink">
                  {PAID_AT.format(new Date(receipt.paidAt))}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Amount</dt>
                <dd className="font-semibold text-ink">
                  {naira(receipt.amount)}
                </dd>
              </div>
            </dl>

            <div className="mt-6">
              <p className="text-sm font-semibold text-brand-deep">
                What was paid
              </p>
              <ul className="mt-3 space-y-3">
                {receipt.dues.map((d) => (
                  <li key={d.name} className="rounded-2xl p-4 ring-1 ring-line">
                    <p className="font-medium text-ink">{d.name}</p>
                    {d.kind === "recurring" ? (
                      <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                        {d.periods.map((p) => (
                          <li key={p.index}>
                            {periodLabel(p) ?? "One period"}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-ink-muted">
                        Paid in full
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-6 text-center font-mono text-xs text-ink-subtle">
              Reference {receipt.reference}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-10 w-full max-w-md rounded-[2rem] bg-white p-8 text-center shadow-xl shadow-brand-deep/5 ring-1 ring-line">
          <CircleAlert
            className="mx-auto h-10 w-10 text-accent-hot"
            aria-hidden
          />
          <h1 className="mt-4 text-xl font-semibold text-brand-deep">
            We can’t confirm this receipt
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            It isn’t a Tasa receipt, or the link was changed. Ask the student to
            open the receipt in their Tasa app and scan the QR code from there.
          </p>
        </div>
      )}

      <p className="mt-8 max-w-md text-center text-xs leading-relaxed text-ink-subtle">
        Tasa holds group dues and pays them out only to the account each group’s
        terms name.{" "}
        <Link href="/" className="font-medium text-brand">
          About Tasa
        </Link>
      </p>
    </main>
  );
}
