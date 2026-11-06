'use client';

import { ArrowRight, ChevronDown, Download } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { APPLE_PATH, PLAY_PATH } from '@/components/StoreButtons';
import { site } from '@/lib/site';
import { cn } from '@/lib/utils';

type Store = { key: 'ios' | 'android'; name: string; small: string; href: string; path: string };

/**
 * The hero's two actions, side by side even on a phone: get the app (a small menu with both
 * stores, the visitor's own first), or pay a bill on the web right now.
 */
export function HeroActions() {
  const [open, setOpen] = useState(false);
  const [android, setAndroid] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Without a store listing yet, each option goes to the download section instead.
  const stores: Store[] = [
    { key: 'ios', name: 'App Store', small: 'iPhone', href: site.appStoreUrl || '/#download', path: APPLE_PATH },
    { key: 'android', name: 'Google Play', small: 'Android', href: site.playStoreUrl || '/#download', path: PLAY_PATH },
  ];
  // The visitor's own phone's store first.
  const ordered = android ? [...stores].reverse() : stores;

  return (
    <div className='mt-8 flex flex-wrap gap-3'>
      <div ref={root} className='relative'>
        <button
          type='button'
          aria-haspopup='menu'
          aria-expanded={open}
          onClick={() => {
            setAndroid(/android/i.test(navigator.userAgent));
            setOpen((o) => !o);
          }}
          className='inline-flex items-center gap-2 text-sm rounded-2xl bg-brand px-5 py-3.5 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-deep'
        >
          <Download className='h-5 w-5' aria-hidden />
          Download the App
          <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} aria-hidden />
        </button>
        {open && (
          <div
            role='menu'
            className='absolute left-0 z-30 mt-2 w-60 rounded-2xl bg-white p-1.5 shadow-xl shadow-brand-deep/10 ring-1 ring-line'
          >
            {ordered.map((s) => {
              const external = s.href.startsWith('http');
              return (
                <a
                  key={s.key}
                  role='menuitem'
                  href={s.href}
                  {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
                  onClick={() => setOpen(false)}
                  className='flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-track'
                >
                  <svg viewBox='0 0 24 24' aria-hidden className='h-6 w-6 fill-ink'>
                    <path d={s.path} />
                  </svg>
                  <span className='leading-tight'>
                    <span className='block text-sm font-semibold text-ink'>{s.name}</span>
                    <span className='block text-xs text-ink-muted'>
                      {external ? `For ${s.small}` : `Coming soon for ${s.small}`}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Link
        href='/pay'
        className='inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3.5 font-semibold text-brand ring-1 ring-line transition hover:ring-brand'
      >
        Pay a bill
        <ArrowRight className='h-4 w-4' aria-hidden />
      </Link>
    </div>
  );
}
