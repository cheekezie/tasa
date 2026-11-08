import { cn } from '@/lib/utils';

// ─── Generic semantic variants ────────────────────────────────────────────────

export type StatusVariant =
  | 'success'
  | 'error'
  | 'warning'
  | 'progress'
  | 'info'
  | 'neutral'
  | 'inactive'
  | 'open'
  | 'closed';

type VariantStyle = { dot: string; text: string; bg: string };

const variantStyles: Record<StatusVariant, VariantStyle> = {
  success: {
    dot: 'bg-[#06C270]',
    text: 'text-[#06C270]',
    bg: 'bg-[#ECFDF3]',
  },
  open: {
    dot: 'bg-[#06C270]',
    text: 'text-[#06C270]',
    bg: 'bg-[#ECFDF3]',
  },
  error: {
    dot: 'bg-[#D03333]',
    text: 'text-[#D03333]',
    bg: 'bg-[#B3261E]/10',
  },
  warning: {
    dot: 'bg-[#F59E0B]',
    text: 'text-[#F59E0B]',
    bg: 'bg-[#FFFBEB]',
  },
  info: {
    dot: 'bg-[#0088FF]',
    text: 'text-[#0088FF]',
    bg: 'bg-[#ECF2FD]',
  },
  neutral: {
    dot: 'bg-[#4C5361]',
    text: 'text-[#4C5361]',
    bg: 'bg-slate-200',
  },
  inactive: {
    dot: 'bg-[#9CA3AF]',
    text: 'text-[#6B7280]',
    bg: 'bg-[#F3F4F6]',
  },
  closed: {
    dot: 'bg-[#9CA3AF]',
    text: 'text-[#6B7280]',
    bg: 'bg-[#F3F4F6]',
  },
  progress: {
    dot: 'bg-white',
    text: 'text-white',
    bg: 'bg-blue-400',
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  variant: StatusVariant;
  label: string;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatusBadge({ variant, label, className }: StatusBadgeProps) {
  const { dot, text, bg } = variantStyles[variant];
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium whitespace-nowrap capitalize sm:gap-1.5 sm:px-2 sm:py-0.5 sm:text-xs',
        text,
        bg,
        className
      )}
    >
      <span className={cn('h-1 w-1 shrink-0 rounded-full sm:h-1.5 sm:w-1.5', dot)} />
      {label}
    </span>
  );
}
