import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { API_URL } from '@/lib/api/client';
import { groupsService } from '@/lib/api/services/groups';
import { getTokens } from '@/lib/api/tokens';
import { DuePeriodStatus, GroupDueReportDto } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';
import i18n from '@/lib/i18n';

type Options = { year?: number; search?: string };

const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'short', timeZone: 'Africa/Lagos' });
const DAY_MONTH = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const YEAR = new Intl.DateTimeFormat('en-NG', { year: 'numeric', timeZone: 'Africa/Lagos' });
const LAGOS_PARTS = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Lagos' });
const STAMP = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fileSlug = (...parts: (string | number | null | undefined)[]) =>
  parts
    .filter(Boolean)
    .join('-')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

function weekNumber(start: string) {
  const [y, m, d] = LAGOS_PARTS.format(new Date(start)).split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  return `WK${Math.ceil(((monday.getTime() - Date.UTC(monday.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)}`;
}

function columnName(report: GroupDueReportDto, start: string) {
  const date = new Date(start);
  if (report.due.kind === 'one_off') return i18n.t('groups.status.paid');
  if (report.due.period === 'yearly') return YEAR.format(date);
  if (report.due.period === 'weekly') return `${weekNumber(start)}<br><small>${DAY_MONTH.format(date)}</small>`;
  return MONTH.format(date);
}

async function share(file: File, mimeType: string, UTI: string) {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: i18n.t('groups.export') });
  return true;
}

/** Every member, not just the first page the screen shows. */
async function wholeReport(groupId: string, dueId: string, options: Options) {
  const first = await groupsService.dueReport(groupId, dueId, { ...options, page: 1 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page++) {
    const next = await groupsService.dueReport(groupId, dueId, { ...options, page });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { ...first, items };
}

const MARK: Record<DuePeriodStatus, string> = { paid: '✓', due: '•', overdue: '!', optional: '–', upcoming: '' };

function reportHtml(groupName: string, report: GroupDueReportDto) {
  const { due } = report;
  const price =
    due.kind === 'recurring'
      ? i18n.t(`groups.every.${due.period!}`, { amount: formatNaira(due.amount) })
      : i18n.t('groups.once', { amount: formatNaira(due.amount) });
  const head = report.columns.map((c) => `<th>${columnName(report, c.start)}</th>`).join('');
  const rows = report.items
    .map((row) => {
      const name = escape(row.user.name ?? (row.user.username ? `@${row.user.username}` : i18n.t('groups.aMember')));
      const cells = row.cells.map((c) => `<td class="c ${c ?? 'none'}">${c ? MARK[c] : ''}</td>`).join('');
      return `<tr><td class="name">${name}${row.user.username && row.user.name ? `<br><small>@${escape(row.user.username)}</small>` : ''}</td>${cells}<td class="num ${row.owed > 0 ? 'owes' : ''}">${row.owed > 0 ? formatNaira(row.owed) : '—'}</td></tr>`;
    })
    .join('');
  const foot = report.columns.map((c) => `<td class="c"><b>${c.paid}</b>/${c.members}</td>`).join('');
  const legend = (['paid', 'due', 'overdue', 'optional'] as const)
    .map((s) => `<span class="c ${s}">${MARK[s]}</span> ${escape(i18n.t(`groups.status.${s}`))}`)
    .join(' &nbsp; ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1c1c28; font-size: 10px; }
  h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 4px; color: #555; }
  .totals { margin: 8px 0 10px; font-size: 11px; } .totals b { color: #1c1c28; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #e3e3ea; padding: 4px; }
  th { background: #f4f4f7; font-weight: 600; } small { color: #888; font-weight: 400; }
  .name { text-align: left; white-space: nowrap; } .num { text-align: right; white-space: nowrap; } .owes { color: #c62828; font-weight: 600; }
  .c { text-align: center; width: 22px; } .paid { background: #d7f5e3; color: #1b7a43; font-weight: 700; }
  .due { background: #ffe9d1; color: #b45f06; } .overdue { background: #fddcdc; color: #c62828; font-weight: 700; } .optional { color: #999; } .none { background: #fafafa; }
  tfoot td { background: #f4f4f7; } .legend { margin-top: 8px; color: #555; } .legend .c { display: inline-block; padding: 0 4px; }
  .stamp { margin-top: 6px; color: #999; }
</style></head><body>
  <h1>${escape(groupName)}</h1>
  <p>${escape(due.name)} · ${escape(price)} · ${escape(i18n.t(due.compulsory ? 'groups.compulsory' : 'groups.optionalTag'))}${report.year ? ` · ${report.year}` : ''}</p>
  <div class="totals">${escape(i18n.t('groups.collected'))} <b>${formatNaira(report.totals.collected)}</b> &nbsp;·&nbsp; ${escape(i18n.t('groups.outstanding'))} <b>${formatNaira(report.totals.outstanding)}</b> &nbsp;·&nbsp; ${escape(i18n.t('groups.owing'))} <b>${report.totals.owing}/${report.totals.members}</b></div>
  <table><thead><tr><th class="name">${escape(i18n.t('groups.tab.members'))}</th>${head}<th class="num">${escape(i18n.t('groups.owes', { amount: '' }).trim())}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td class="name"><b>${escape(i18n.t('groups.status.paid'))}</b></td>${foot}<td class="num"><b>${formatNaira(report.totals.outstanding)}</b></td></tr></tfoot></table>
  <div class="legend">${legend}</div>
  <div class="stamp">${escape(i18n.t('groups.exportedAt', { date: STAMP.format(new Date()) }))}</div>
</body></html>`;
}

/** The payment report as a landscape PDF, every member, then the share sheet. False if the device can't share. */
export async function exportDueReportPdf(groupId: string, groupName: string, dueId: string, options: Options) {
  const report = await wholeReport(groupId, dueId, options);
  const { uri } = await Print.printToFileAsync({ html: reportHtml(groupName, report), width: 842, height: 595 });
  const named = new File(Paths.cache, `${fileSlug(groupName, report.due.name, report.year)}.pdf`);
  await new File(uri).move(named, { overwrite: true });
  return share(named, 'application/pdf', 'com.adobe.pdf');
}

/** The payment report as an Excel file, built by the API (every member on one sheet), then the share sheet. */
export async function exportDueReportExcel(groupId: string, groupName: string, dueId: string, options: Options) {
  // Any authorised call first, so an expired session is refreshed before the download uses it.
  const { due, year } = await groupsService.dueReport(groupId, dueId, { ...options, page: 1 });
  const query = new URLSearchParams();
  if (options.year) query.set('year', String(options.year));
  if (options.search) query.set('search', options.search);
  const destination = new File(Paths.cache, `${fileSlug(groupName, due.name, year)}.xlsx`);
  const file = await File.downloadFileAsync(`${API_URL}/groups/${groupId}/dues/${dueId}/report.xlsx${query.size ? `?${query}` : ''}`, destination, {
    headers: { Authorization: `Bearer ${getTokens()?.accessToken ?? ''}` },
    idempotent: true,
  });
  return share(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet');
}
