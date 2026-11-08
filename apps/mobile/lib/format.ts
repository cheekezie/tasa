import i18n from '@/lib/i18n';

// Money formatting lives with the Kobo type; re-exported so screens keep one import for formatting.
export { formatNaira } from '@/lib/money';

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatDateTime(date: string) {
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatRelativeDate(date: string) {
  const target = new Date(date);
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return i18n.t('dates.today');
  if (diffDays === 1) return i18n.t('dates.tomorrow');
  if (diffDays < 0) return i18n.t('dates.daysAgo', { count: Math.abs(diffDays) });
  if (diffDays <= 7) return i18n.t('dates.inDays', { count: diffDays });
  return formatDate(date);
}

/** The same, for the middle of a sentence: "Due in 4 days", not "Due In 4 days". */
export function formatRelativeDateInline(date: string) {
  const text = formatRelativeDate(date);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "08031234567" → "0803 ••• 4567", so a phone number can be shown on a locked screen. */
export function maskPhone(phone: string) {
  return phone.length > 8 ? `${phone.slice(0, 4)} ••• ${phone.slice(-4)}` : phone;
}

/** "adaeze@gmail.com" → "a•••••@gmail.com". */
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name[0] ?? ''}${'•'.repeat(Math.max(name.length - 1, 3))}@${domain}`;
}

/** Masks whichever contact the account uses: phone if it has one, otherwise email. */
export function maskContact({ phone, email }: { phone: string; email: string }) {
  return phone ? maskPhone(phone) : maskEmail(email);
}
