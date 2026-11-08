import { Spending } from '@/lib/api/mappers';
import { formatNaira } from '@/lib/format';
import { Translate } from '@/lib/i18n';
import { ServiceId } from '@/constants/data';

type MoodKey = ServiceId | 'bills' | 'transfers' | 'gifts' | 'coupons' | 'tickets' | 'dues';

/** How each kind of spender's banner looks; the words are in `insights.mood` in the locales. */
const MOODS: Record<MoodKey, { gradient: [string, string]; confetti: string[]; symbol: string }> = {
  gifts: { gradient: ['#C2185B', '#7B2FF7'], confetti: ['#F06292', '#E91E63', '#CE93D8', '#FFFFFF'], symbol: '❤️' },
  coupons: { gradient: ['#C2410C', '#B45309'], confetti: ['#FFB347', '#FF6B6B', '#FFE08A', '#FFFFFF'], symbol: '🏷️' },
  transfers: { gradient: ['#0F5F8C', '#0A4D3C'], confetti: ['#5B8DEF', '#7FE0B8', '#BBDEFB', '#FFFFFF'], symbol: '💸' },
  dues: { gradient: ['#0F5F8C', '#4338CA'], confetti: ['#5B8DEF', '#7FE0B8', '#FFD54F', '#FFFFFF'], symbol: '🤝' },
  tickets: { gradient: ['#6D28D9', '#BE185D'], confetti: ['#E056FD', '#FFD54F', '#FF8A65', '#FFFFFF'], symbol: '🎟️' },
  bills: { gradient: ['#0A4D3C', '#1B7A5F'], confetti: ['#1B9E77', '#7FE0B8', '#EBBB01', '#FFFFFF'], symbol: '🧾' },
  electricity: { gradient: ['#92590A', '#B45309'], confetti: ['#EBBB01', '#FFD54F', '#FFA000', '#FFFFFF'], symbol: '⚡' },
  airtime: { gradient: ['#4338CA', '#7B2FF7'], confetti: ['#5B8DEF', '#B39DDB', '#7FE0B8', '#FFFFFF'], symbol: '📱' },
  tv: { gradient: ['#991B1B', '#6D28D9'], confetti: ['#FF8A65', '#E056FD', '#FFD54F', '#FFFFFF'], symbol: '📺' },
  water: { gradient: ['#0369A1', '#0E7490'], confetti: ['#4FC3F7', '#81D4FA', '#B3E5FC', '#FFFFFF'], symbol: '💧' },
  internet: { gradient: ['#0E7490', '#4338CA'], confetti: ['#4DD0E1', '#5B8DEF', '#B2EBF2', '#FFFFFF'], symbol: '🌐' },
  jamb: { gradient: ['#166534', '#0F5F8C'], confetti: ['#2ECC71', '#A5D6A7', '#FFD54F', '#FFFFFF'], symbol: '🎓' },
};

/** Who this report says they are, from where most of the money went. Null with nothing spent. */
export function spendingMood(report: Spending) {
  const [top] = report.byCategory;
  if (!top) return null;
  const [topService] = report.byService;
  const billLine = top.key === 'bills' ? topService : undefined;
  const key = (billLine?.key ?? top.key) as MoodKey;
  return { key, amount: (billLine ?? top).amount, ...MOODS[key] };
}

/** The name of where most of the money went, for one-line summaries. */
export function spendingTopName(key: MoodKey, t: Translate) {
  return key === 'bills' || key === 'transfers' || key === 'gifts' || key === 'coupons' || key === 'tickets' || key === 'dues'
    ? t(`insights.category.${key}`)
    : t(`services.${key}.name`);
}

/** The report in plain words, most useful first. Nothing is said without data behind it. */
export function spendingTips(report: Spending, t: Translate) {
  const tips: string[] = [];
  const [topCategory] = report.byCategory;
  const [topService] = report.byService;

  if (topService) {
    const service = t(`services.${topService.key as ServiceId}.name`);
    const amount = formatNaira(topService.amount);
    // With only one bill type, "the biggest" and a 100% share say nothing.
    tips.push(
      report.byService.length === 1
        ? t('insights.tipOnlyService', { service, amount })
        : t('insights.tipTopService', { service, amount, share: Math.round(topService.share * 100) }),
    );
  } else if (topCategory) {
    tips.push(
      t('insights.tipTopCategory', {
        category: t(`insights.category.${topCategory.key}`),
        amount: formatNaira(topCategory.amount),
      }),
    );
  }

  if (report.points.earned > 0) {
    tips.push(
      t('insights.tipPoints', { count: report.points.earned, amount: formatNaira(report.points.value) }),
    );
  }
  if (report.recurringMonthly > 0) {
    tips.push(t('insights.tipRecurring', { amount: formatNaira(report.recurringMonthly) }));
  }
  if (report.saved > 0) tips.push(t('insights.tipSaved', { amount: formatNaira(report.saved) }));
  return tips;
}
