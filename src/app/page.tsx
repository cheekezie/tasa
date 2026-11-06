import {
  ArrowRight,
  BellRing,
  ChartPie,
  Check,
  ChevronDown,
  Divide,
  Eye,
  Gift,
  GraduationCap,
  Languages,
  Lightbulb,
  Lock,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Ticket,
  Tv,
  UsersRound,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';

import { SiteFooter } from '@/components/SiteFooter';
import { HeroActions } from '@/components/HeroActions';
import { SiteHeader } from '@/components/SiteHeader';
import { StoreButtons } from '@/components/StoreButtons';
import { photos } from '@/lib/site';

const services: { icon: LucideIcon; label: string; detail: string }[] = [
  { icon: Lightbulb, label: 'Electricity', detail: 'Prepaid & postpaid, token in seconds' },
  { icon: Smartphone, label: 'Airtime & data', detail: 'MTN, Airtel, Glo, 9mobile' },
  { icon: Tv, label: 'TV', detail: 'DStv, GOtv, StarTimes' },
  { icon: Wifi, label: 'Internet', detail: 'Smile, Spectranet and more' },
  { icon: GraduationCap, label: 'Exam PINs', detail: 'WAEC and JAMB' },
];

const features: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Zap, title: 'Pay bills in seconds', body: 'Electricity, airtime, data, TV, internet and exam PINs. We check the meter or card number first, so you see whose it is before you pay.' },
  { icon: Repeat, title: 'Recurring bills', body: 'Set DStv or your meter to pay itself every week or month. We remind you before it runs if your wallet is short.' },
  { icon: Divide, title: 'Split a bill', body: 'Share the light bill or the decoder with your house. Everyone pays their part into a pot, and Tela pays the bill when it’s full.' },
  { icon: UsersRound, title: 'Groups & dues', body: 'Associations, clubs and alumni sets collect dues, levies and one-off contributions. Members see exactly what they owe.' },
  { icon: Ticket, title: 'Events & tickets', body: 'Sell tickets to your event, scan them at the door and get paid out to your bank. Or find something to do this weekend.' },
  { icon: Gift, title: 'Gifts & giveaways', body: 'Pay someone’s bill as a gift, or send a code your followers can use towards theirs.' },
  { icon: Sparkles, title: 'Tela Points', body: 'Earn points on what you pay and turn them into money in your wallet.' },
  { icon: ChartPie, title: 'Know your spending', body: 'See where your money goes each month, by bill and by category, with tips to spend less.' },
];

const steps = [
  { title: 'Sign up with your phone number', body: 'Download Tela, verify your number with a one-time code and set a 4-digit PIN.' },
  { title: 'Fund your wallet', body: 'Transfer from any Nigerian bank to your own Tela account number. It lands in your wallet automatically.' },
  { title: 'Pay, split or collect', body: 'Pick a bill, see every charge before you confirm, and approve with your PIN. Your token or receipt comes straight back.' },
];

const reasons: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Eye, title: 'No surprise charges', body: 'Every payment shows its price and charges, line by line, before you confirm. What you see is what leaves your wallet.' },
  { icon: RotateCcw, title: 'Failed? You get it back', body: 'If a provider rejects a payment, the money goes straight back to your wallet. If they’re slow, we keep checking until it’s settled.' },
  { icon: Lock, title: 'Your PIN on every payment', body: 'Nothing leaves your wallet without your PIN, and a new sign-in always asks for a code sent to you.' },
  { icon: ShieldCheck, title: 'Group money stays safe', body: 'Dues can only be paid out to the account members agreed to. Changing it takes several executives and a waiting period.' },
  { icon: BellRing, title: 'Never miss a bill', body: 'Recurring bills, dues and splits show up in one “Coming up” list, with a reminder before anything is due.' },
  { icon: Languages, title: 'Made for Nigeria', body: 'Naira everywhere, the providers you already use, and the whole app in English or Pidgin.' },
];

const faqs = [
  {
    q: 'Is Tela free to use?',
    a: 'Downloading Tela and signing up is free. Some payments carry a small service charge, and you always see it, itemised, before you confirm. Nothing is added afterwards.',
  },
  {
    q: 'How do I add money to my wallet?',
    a: 'Every Tela account gets its own account number. Transfer to it from any Nigerian bank app and the money appears in your wallet automatically.',
  },
  {
    q: 'What happens if a bill payment fails?',
    a: 'If the provider rejects it, the full amount goes back to your wallet straight away. If the provider is slow to answer, the payment shows as processing while we keep checking with them, and you’re never charged twice.',
  },
  {
    q: 'Can I send my wallet balance back to my bank?',
    a: 'Your wallet is for payments on Tela. Money you earn on Tela, like ticket sales or a group’s dues, can be paid out to the bank account you set up for it.',
  },
  {
    q: 'How does splitting a bill work?',
    a: 'You enter the bill (we check the meter or card number) and the people sharing it. Everyone pays their share before the deadline you choose. When the pot is full Tela pays the bill and everyone sees the receipt, token included. If not everyone pays in time, everyone gets their share back.',
  },
  {
    q: 'Who can see a group’s money?',
    a: 'Members see their own dues and every withdrawal the group makes. Executives see the balance and who has paid. Withdrawals only go to the payout account members accepted when they joined.',
  },
  {
    q: 'I got an invite link to a group. What do I do?',
    a: 'Open the link on your phone. If you have Tela, it opens the group so you can read its terms and join. If not, install Tela first, then open the link again or enter the invite code in Groups.',
  },
  {
    q: 'Can I pay without downloading the app?',
    a: 'Yes, for one-off bills: JAMB and WAEC PINs, electricity tokens and airtime, up to ₦50,000. Pay by bank transfer on our website and your PIN or token is shown there and texted to you. If anything goes wrong, the money waits in a Tela wallet for your phone number.',
  },
  {
    q: 'Is Tela available in Pidgin?',
    a: 'Yes. You can switch the whole app between English and Pidgin in your settings.',
  },
];

function SectionTitle({ eyebrow, title, body, center }: { eyebrow: string; title: string; body?: string; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-hot">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-deep sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg leading-relaxed text-ink-muted">{body}</p>}
    </div>
  );
}

function Spotlight({
  photo,
  eyebrow,
  title,
  body,
  points,
  flip,
}: {
  photo: { src: string; alt: string };
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={flip ? 'md:order-2' : undefined}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-track">
          <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
        </div>
      </div>
      <div>
        <SectionTitle eyebrow={eyebrow} title={title} body={body} />
        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-ink">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mint text-brand">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <span className="leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-mint blur-3xl" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm text-brand ring-1 ring-line">
                <span className="h-2 w-2 rounded-full bg-gold" aria-hidden />
                Bills, splits and dues in one app
              </p>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-brand-deep sm:text-5xl lg:text-6xl">
                Pay every bill in seconds. Share the rest.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
                Light, airtime, data and TV, paid from one wallet. Split bills with the people you live with, collect your group’s dues, and sell tickets
                to your event, with every charge shown before you pay.
              </p>
              <HeroActions />
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
                {['Electricity token in seconds', 'Refunded if a bill fails', 'Your PIN on every payment'].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand-light" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto w-full max-w-md">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-track shadow-2xl shadow-brand-deep/15">
                <Image src={photos.hero.src} alt={photos.hero.alt} fill priority sizes="(min-width: 768px) 28rem, 90vw" className="object-cover" />
              </div>
              {/* A taste of the app, over the photo. */}
              <div className="absolute -left-4 top-10 w-56 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-line sm:-left-10">
                <p className="text-xs text-ink-muted">IKEDC · Prepaid</p>
                <p className="mt-1 text-sm font-semibold text-brand-deep">Token ready</p>
                <p className="mt-2 rounded-lg bg-track px-2 py-1.5 font-mono text-xs tracking-wider text-ink">1234 5678 9012 3456 7890</p>
              </div>
              <div className="absolute -right-3 bottom-10 w-52 rounded-2xl bg-brand p-4 text-white shadow-xl sm:-right-8">
                <p className="text-xs text-white/70">House light · split 4 ways</p>
                <p className="mt-1 text-lg font-semibold">₦20,100</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/20">
                  <div className="h-1.5 w-full rounded-full bg-gold" />
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-white/90">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Bill paid
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* What you can pay */}
        <section aria-label="What you can pay" className="border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 md:grid-cols-5">
            {services.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-brand">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="block text-xs leading-snug text-ink-muted">{detail}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionTitle
            center
            eyebrow="Features"
            title="Everything you pay for, and everyone you pay with"
            body="Tela started with bills. It grew into the place your house, your association and your event crowd sort out money together."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl bg-white p-6 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-deep/5">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand text-white">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-brand-deep">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Spotlights */}
        <section className="bg-white">
          <div className="mx-auto max-w-6xl space-y-24 px-4 py-24 sm:px-6">
            <Spotlight
              photo={photos.friends}
              eyebrow="Split a bill"
              title="The light bill, shared fairly"
              body="No more one person paying and chasing everyone else. Start a split, and Tela collects each share and pays the bill when everyone’s in."
              points={[
                'We check the meter or decoder number before anyone pays',
                'Everyone sees who has paid, and the token once it’s bought',
                'Not everyone paid in time? Everyone gets their share back',
                'Split it again next month in one tap, with past rounds kept together',
              ]}
            />
            <Spotlight
              flip
              photo={photos.students}
              eyebrow="Groups & dues"
              title="Collect dues without chasing anyone"
              body="For associations, alumni sets, clubs and committees. Members join with your invite link and pay what they owe, when they owe it."
              points={[
                'Monthly or yearly dues, plus one-off levies like a condolence fee',
                'Members pick which periods to pay; overdue ones are clear to everyone',
                'A month-by-month view of who has paid, and export it to PDF or Excel',
                'Money only goes to the account your members agreed to',
              ]}
            />
            <Spotlight
              photo={photos.concert}
              eyebrow="Events & tickets"
              title="Sell out your event, get paid properly"
              body="Create your event, set your ticket types and share the link. Guests pay on Tela and get their tickets on their phone."
              points={['Scan tickets at the door from the app', 'See sales as they happen', 'Get paid out to your bank account']}
            />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionTitle center eyebrow="How it works" title="Up and running in three minutes" />
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="relative rounded-3xl bg-white p-7 ring-1 ring-line">
                <span className="text-5xl font-semibold text-gold">{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold text-brand-deep">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Why Tela */}
        <section id="why-tela" className="bg-brand-deep text-white">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-accent">Why Tela</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Money you can see, and trust</h2>
                <p className="mt-4 text-lg leading-relaxed text-white/70">
                  Paying bills shouldn’t mean guessing what you’ll be charged or wondering where your money went. Tela is built so you always know.
                </p>
                <div className="relative mt-10 hidden aspect-[4/3] overflow-hidden rounded-3xl lg:block">
                  <Image src={photos.family.src} alt={photos.family.alt} fill sizes="30rem" className="object-cover" />
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {reasons.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
                    <Icon className="h-6 w-6 text-accent" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/70">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
          <SectionTitle center eyebrow="FAQ" title="Questions people ask" />
          <div className="mt-12 divide-y divide-line rounded-3xl bg-white ring-1 ring-line">
            {faqs.map((faq) => (
              <details key={faq.q} className="group px-6 py-5">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-left font-semibold text-brand-deep">
                  {faq.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-ink-subtle transition group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 leading-relaxed text-ink-muted">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Download */}
        <section id="download" className="px-4 pb-24 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-brand px-6 py-16 text-center text-white sm:px-12">
            <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-brand-light/40 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-gold/20 blur-3xl" aria-hidden />
            <div className="relative">
              <Image src="/brand/app-icon.png" alt="Tela app icon" width={80} height={80} className="mx-auto h-20 w-20 rounded-[1.4rem] shadow-xl shadow-brand-deep/30 ring-1 ring-white/20" />
              <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Get Tela on your phone</h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">Free to download. Your first bill takes about a minute.</p>
              <StoreButtons tone="light" className="mt-8 justify-center" />
              <a href="#features" className="mt-8 inline-flex items-center gap-1 text-sm text-white/70 hover:text-white">
                See everything Tela does <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
