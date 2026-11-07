import { useState } from 'react';

import { CalendarField } from '@/components/ui/CalendarField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useT } from '@/context/SettingsContext';
import { toIsoDate } from '@/lib/calendar';

const DEADLINES = [24, 48, 168] as const;
/** The API's limit: a week, so a bill isn't left waiting while its price moves. */
const MAX_HOURS = 168;
type Choice = `${(typeof DEADLINES)[number]}` | 'date' | 'keep';

/** Hours from now to the end of that day in Lagos, within the API's limit. */
const hoursUntil = (day: string) => Math.min(MAX_HOURS, Math.max(1, Math.ceil((Date.parse(`${day}T23:59:59+01:00`) - Date.now()) / 3_600_000)));

/**
 * How long a split stays open: 24 hours, 48 hours, a week, or the end of a chosen day. With
 * `keepable`, the first choice leaves the current deadline alone (for editing). `hours()` reads
 * it at the moment it's needed, so the time spent filling the form isn't lost.
 */
export function useSplitDeadline({ keepable = false, initial = '48' }: { keepable?: boolean; initial?: Choice } = {}) {
  const [choice, setChoice] = useState<Choice>(keepable ? 'keep' : initial);
  // Today can't be picked (it may be nearly over); the last day must end inside the limit.
  const [{ tomorrow, lastDay }] = useState(() => ({
    tomorrow: toIsoDate(new Date(Date.now() + 86_400_000)),
    lastDay: toIsoDate(new Date(Date.now() + 6 * 86_400_000)),
  }));
  const [day, setDay] = useState(tomorrow);
  return {
    choice,
    setChoice,
    day,
    setDay,
    tomorrow,
    lastDay,
    keepable,
    /** Undefined: keep the current deadline. */
    hours: () => (choice === 'keep' ? undefined : choice === 'date' ? hoursUntil(day) : Number(choice)),
  };
}

export function SplitDeadlineField({ deadline }: { deadline: ReturnType<typeof useSplitDeadline> }) {
  const t = useT();
  return (
    <>
      <SegmentedControl
        compact
        options={[
          ...(deadline.keepable ? [{ value: 'keep' as const, label: t('splits.keepDeadline') }] : []),
          ...DEADLINES.map((h) => ({ value: `${h}` as Choice, label: t(`splits.within.${h}`) })),
          { value: 'date' as const, label: t('splits.pickDate') },
        ]}
        value={deadline.choice}
        onChange={deadline.setChoice}
      />
      {deadline.choice === 'date' && (
        <CalendarField title={t('splits.closesOn')} value={deadline.day} min={deadline.tomorrow} max={deadline.lastDay} onChange={deadline.setDay} />
      )}
    </>
  );
}
