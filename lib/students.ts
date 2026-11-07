import { Programme } from '@/lib/api/types';
import { Translate } from '@/lib/i18n';

/** What they're studying for. Matches the API. */
export const PROGRAMMES: Programme[] = [
  'undergraduate',
  'part_time',
  'masters',
  'doctorate',
  'pgd',
  'nd',
  'hnd',
  'nce',
  'diploma',
  'jupeb',
  'ijmb',
  'pre_degree',
  'pre_science',
  'foundation',
];

/** How many years (levels) each programme has. Matches the API. */
export const MAX_LEVEL: Record<Programme, number> = {
  undergraduate: 5,
  part_time: 5,
  masters: 2,
  doctorate: 5,
  pgd: 1,
  nd: 2,
  hnd: 2,
  nce: 3,
  diploma: 2,
  jupeb: 1,
  ijmb: 1,
  pre_degree: 1,
  pre_science: 1,
  foundation: 1,
};

/** The API's (English) names; screens pass `t` to get them from the locale. */
const PROGRAMME_NAMES: Record<Programme, string> = {
  undergraduate: 'Undergraduate',
  part_time: 'Part-time / Sandwich',
  masters: 'Master’s',
  doctorate: 'Doctorate (PhD)',
  pgd: 'Postgraduate Diploma',
  nd: 'National Diploma (ND)',
  hnd: 'Higher National Diploma (HND)',
  nce: 'NCE',
  diploma: 'Diploma',
  jupeb: 'JUPEB',
  ijmb: 'IJMB',
  pre_degree: 'Pre-degree',
  pre_science: 'Pre-science',
  foundation: 'Foundation',
};

export const programmeName = (programme: Programme, t?: Translate) => (t ? t(`students.programmes.${programme}`) : PROGRAMME_NAMES[programme]);

/** The levels a programme has: 1..MAX_LEVEL. */
export const levelsOf = (programme: Programme) => Array.from({ length: MAX_LEVEL[programme] }, (_, i) => i + 1);

/** "300 level", "ND1", "JUPEB" (one-year programmes), "Year 2 · Master’s". Matches the API's `levelLabel`. */
export function levelLabel(programme: Programme, level: number, t?: Translate) {
  if (programme === 'undergraduate' || programme === 'part_time') return `${level}00 level`;
  if (programme === 'nd' || programme === 'hnd') return `${programme.toUpperCase()}${level}`;
  const name = programmeName(programme, t);
  if (MAX_LEVEL[programme] === 1) return name;
  return t ? t('students.yearOf', { level, programme: name }) : `Year ${level} · ${name}`;
}

/** How the API compares departments ("Dept. of Computer Science" = "computer science"). Matches the API. */
export const departmentKey = (department: string) =>
  department
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the )?(department|dept)\.?( of)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
