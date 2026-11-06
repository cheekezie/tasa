import { BadgeCheck, ScrollText, ShieldCheck } from "lucide-react";
import { Outlet } from "react-router-dom";
import { BRAND } from "@/config/brand";

const PROMISES = [
  { icon: ScrollText, text: "Every change is in the audit log, with who made it" },
  { icon: ShieldCheck, text: "Each role sees only what the API lets it do" },
  { icon: BadgeCheck, text: "Money is kept in kobo and shown to the naira" },
];

const AuthLayout = () => (
  <div className="grid min-h-screen grid-cols-12 bg-white" data-layout="auth">
    <div className="col-span-12 flex flex-col px-6 py-6 sm:px-10 md:col-span-7 lg:col-span-6">
      <div className="flex items-center gap-2">
        <img src={BRAND.logoUrl} alt={BRAND.name} className="h-8 object-contain" />
        <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          Admin
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <Outlet />
      </div>
      <p className="text-xs text-grey-300">
        For Tela staff only. Activity on this site is logged.
      </p>
    </div>

    <BrandPanel />
  </div>
);

/** The other half: who this is for and why it can be trusted, with a sketch of what's inside. */
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#055a4e_0%,#03463d_45%,#022a25_100%)] md:col-span-5 md:flex md:flex-col lg:col-span-6">
      {/* The T, huge and faint, so the panel is unmistakably Tela without shouting it. */}
      <img
        src={BRAND.iconUrl}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-28 h-136 w-auto opacity-[0.07] brightness-0 invert select-none"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.6)_1px,transparent_1px)] mask-[linear-gradient(to_bottom,black,transparent_70%)] bg-size-[22px_22px] opacity-[0.12]"
      />

      <div className="relative flex flex-1 flex-col justify-between gap-10 p-10 lg:p-14">
        <img src="/tela-logo.png" alt={BRAND.name} className="h-7 w-fit object-contain" />

        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-[0.18em] text-[#EBBE00] uppercase">
              Back office
            </p>
            {/* One line once the panel is wide enough for it; wraps on narrower screens. */}
            <h2 className="font-heading text-3xl leading-tight font-semibold text-white xl:text-4xl xl:whitespace-nowrap">
              Admin Management Console
            </h2>
            <p className="max-w-md text-base text-white/70">{BRAND.tagline}</p>
          </div>
          <PreviewSketch />
        </div>

        <ul className="space-y-3 pt-6">
          {PROMISES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-white/80">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Icon className="size-3.5 text-[#EBBE00]" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** A wordless sketch of the dashboard: shapes, not figures, so nothing here reads as real data. */
function PreviewSketch() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 86, 70, 92];
  return (
    <div aria-hidden className="relative max-w-md">
      <div className="rounded-2xl border border-white/10 bg-white/6 p-5 shadow-2xl backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-medium text-white/70">Profit &amp; loss</span>
          <span className="flex gap-1">
            <span className="h-1.5 w-6 rounded-full bg-white/20" />
            <span className="h-1.5 w-6 rounded-full bg-[#EBBE00]" />
          </span>
        </div>
        <div className="flex h-24 items-end gap-1.5">
          {bars.map((h, i) => (
            <span
              key={i}
              className={
                i === bars.length - 1
                  ? "flex-1 rounded-t bg-[#EBBE00]"
                  : "flex-1 rounded-t bg-white/25"
              }
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      <div className="absolute -right-4 -bottom-10 w-52 rounded-xl border border-white/10 bg-[#022a25]/90 p-4 shadow-xl lg:-right-10">
        <p className="mb-3 text-xs font-medium text-white/70">Needs attention</p>
        {["Organisers to review", "Payouts in flight", "Webhooks to replay"].map(
          (label, i) => (
            <div key={label} className="flex items-center justify-between py-1">
              <span className="text-[11px] text-white/60">{label}</span>
              <span
                className={
                  i === 0
                    ? "size-2 rounded-full bg-[#EBBE00]"
                    : "size-2 rounded-full bg-white/25"
                }
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default AuthLayout;
