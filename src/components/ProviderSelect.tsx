'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { GuestProvider } from '@/lib/guestApi';
import { cn } from '@/lib/utils';

function Logo({ provider }: { provider: GuestProvider }) {
  return provider.logo ? (
    // Provider logos come from VTpass.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={provider.logo} alt="" className="h-7 w-7 shrink-0 rounded-md bg-white object-contain ring-1 ring-line" />
  ) : (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-mint text-xs font-semibold text-brand">{provider.name.charAt(0)}</span>
  );
}

/**
 * A dropdown with each provider's logo, which a native <select> can't show. Behaves like one:
 * arrow keys move, Enter or Space picks, Escape closes, typing a letter jumps to it.
 */
export function ProviderSelect({
  label,
  placeholder,
  providers,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  providers: GuestProvider[];
  value: string;
  onChange: (code: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const selected = providers.find((p) => p.code === value);

  // Click or tap outside closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, providers.findIndex((p) => p.code === value)));
    setOpen(true);
  };
  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(providers.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (providers[active]) pick(providers[active].code);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (/^[a-z0-9]$/i.test(e.key)) {
      const next = providers.findIndex((p) => p.name.toLowerCase().startsWith(e.key.toLowerCase()));
      if (next >= 0) setActive(next);
    }
  };

  return (
    <div ref={root} className="relative">
      <span id={`${id}-label`} className="block text-sm font-medium text-ink">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={cn(
          'mt-1.5 flex w-full items-center gap-3 rounded-2xl border bg-white px-4 py-2.5 text-left outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15',
          open ? 'border-brand' : 'border-line',
        )}>
        {selected ? (
          <>
            <Logo provider={selected} />
            <span className="flex-1 truncate text-ink">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 py-1 text-ink-subtle">{placeholder}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-subtle transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-2xl bg-white p-1.5 shadow-xl shadow-brand-deep/10 ring-1 ring-line">
          {providers.map((p, i) => (
            <li
              key={p.code}
              id={`${id}-${i}`}
              role="option"
              aria-selected={p.code === value}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(p.code)}
              className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2', i === active && 'bg-track')}>
              <Logo provider={p} />
              <span className="flex-1 truncate text-sm text-ink">{p.name}</span>
              {p.code === value && <Check className="h-4 w-4 text-brand" aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
