import { Check, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { StoreButtons } from '@/components/StoreButtons';
import { site } from '@/lib/site';

type Preview = { name: string; logoUrl: string | null; requireApproval: boolean };
type Props = { params: Promise<{ code: string }> };

const cleanCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

/**
 * Who's inviting, from the API's public preview (name and picture only). Cached briefly: an
 * invite link is often opened by a whole WhatsApp group at once.
 */
async function preview(code: string): Promise<Preview | null> {
  if (code.length < 4) return null;
  try {
    const res = await fetch(`${site.apiUrl}/public/groups/${encodeURIComponent(code)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return ((await res.json()) as { data: Preview }).data;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = cleanCode((await params).code);
  const group = await preview(code);
  const title = group ? `Join ${group.name} on Tela` : 'Join a group on Tela';
  const description = group ? `You've been invited to join ${group.name} and pay your dues on Tela.` : 'Open this invite in the Tela app to join the group.';
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, url: `/g/${code}`, ...(group?.logoUrl && { images: [{ url: group.logoUrl }] }) },
    // Invite codes are private to the people they're sent to.
    robots: { index: false, follow: false },
  };
}

/**
 * Where an invite link lands when the app doesn't open it: Tela isn't installed yet, or the link
 * was opened inside another app's browser. With Tela installed, iOS and Android open the app
 * straight to the join screen and this page is never seen.
 */
export default async function InvitePage({ params }: Props) {
  const code = cleanCode((await params).code);
  const group = await preview(code);
  const openInApp = `${site.appScheme}://groups/join?code=${code}`;

  return (
    <main className="flex min-h-screen flex-col items-center bg-surface px-4 py-10">
      <Link href="/" aria-label="Tela home">
        <Image src="/brand/tela-logo.png" alt="Tela Africa" width={140} height={42} priority className="h-8 w-auto" />
      </Link>

      <div className="mt-10 w-full max-w-md rounded-[2rem] bg-white p-8 text-center shadow-xl shadow-brand-deep/5 ring-1 ring-line">
        {group ? (
          <>
            {group.logoUrl ? (
              // A group's own picture, from Tela's storage: shown as-is.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={group.logoUrl} alt="" className="mx-auto h-20 w-20 rounded-2xl object-cover ring-1 ring-line" />
            ) : (
              <span className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-mint text-3xl font-semibold text-brand">{group.name.charAt(0).toUpperCase()}</span>
            )}
            <p className="mt-6 text-sm text-ink-muted">You’ve been invited to join</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-brand-deep">{group.name}</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Members pay their dues on Tela.{group.requireApproval ? ' An executive approves each person who joins.' : ''}
            </p>
          </>
        ) : (
          <>
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-mint text-brand">
              <UsersRound className="h-9 w-9" aria-hidden />
            </span>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-brand-deep">Join a group on Tela</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              We couldn’t look this invite up right now. If the code below doesn’t work in the app, ask the person who sent it for a new link.
            </p>
          </>
        )}

        <div className="mt-6 rounded-2xl bg-track px-4 py-3">
          <p className="text-xs text-ink-muted">Invite code</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em] text-ink">{code || '—'}</p>
        </div>

        <a href={openInApp} className="mt-6 block rounded-2xl bg-brand px-5 py-3.5 font-semibold text-white transition hover:bg-brand-deep">
          Open in Tela
        </a>
        <p className="mt-3 text-xs text-ink-subtle">Already have Tela? This opens the group so you can read its terms and join.</p>
      </div>

      <div className="mt-10 w-full max-w-md">
        <p className="text-center text-sm font-semibold text-brand-deep">New to Tela?</p>
        <ol className="mt-4 space-y-3 text-sm text-ink-muted">
          {['Install Tela and sign up with your phone number.', 'Come back to this link and tap “Open in Tela”.', 'Or open Groups in the app and enter the code above.'].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mint text-xs font-semibold text-brand">{i + 1}</span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <StoreButtons className="mt-6 justify-center" />
        <p className="mt-8 flex items-center justify-center gap-2 text-xs text-ink-subtle">
          <Check className="h-3.5 w-3.5" aria-hidden /> Dues go only to the account the group’s terms name.
        </p>
      </div>
    </main>
  );
}
