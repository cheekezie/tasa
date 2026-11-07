import ExcelJS from 'exceljs';
import { koboToNaira } from '../../lib/money';
import { lagosParts } from '../recurring/schedule';
import type { PeriodStatus } from './groups.dues';
import { GroupsService } from './groups.service';
import type { GroupPeriod } from './models/group.model';

/** Everyone, on one sheet: the export isn't paginated like the screen is. */
const ALL = 10_000;

const STATUS_LABEL: Record<PeriodStatus, string> = { paid: 'Paid', due: 'Due', overdue: 'Overdue', optional: 'Optional', upcoming: 'Ahead' };
/** Cell fills, light enough to print. */
const STATUS_FILL: Partial<Record<PeriodStatus, string>> = { paid: 'FFD7F5E3', due: 'FFFFE9D1', overdue: 'FFFDDCDC' };

const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const DAY_MONTH = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });

/** "WK1": Monday-to-Sunday weeks counted from the year's first Monday, as the app shows them. */
function weekNumber(start: Date) {
  const { y, m, d } = lagosParts(start);
  const day = new Date(Date.UTC(y, m, d));
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  return `WK${Math.ceil(((monday.getTime() - Date.UTC(monday.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)}`;
}

function columnName(kind: 'recurring' | 'one_off', period: GroupPeriod | null, start: string) {
  const date = new Date(start);
  if (kind === 'one_off') return 'Paid';
  if (period === 'yearly') return String(lagosParts(date).y);
  if (period === 'weekly') return `${weekNumber(date)} (${DAY_MONTH.format(date)})`;
  return MONTH.format(date);
}

/**
 * The payment report as a spreadsheet, for executives: who paid which period of one due, with
 * what each owes and the totals. Amounts are naira here, the one place money isn't kobo: it's a
 * file for people to read and add up, not something the app parses.
 */
export async function dueReportWorkbook(groupId: string, userId: string, dueId: string, q: { year?: number | undefined; search?: string | undefined }) {
  const [group, report] = await Promise.all([GroupsService.detail(groupId, userId), GroupsService.dueReport(groupId, userId, dueId, { ...q, page: 1, limit: ALL })]);
  const { due } = report;
  const names = report.columns.map((c) => columnName(due.kind, due.period, c.start));

  const book = new ExcelJS.Workbook();
  book.creator = 'Tasa';
  book.created = new Date();
  const sheet = book.addWorksheet(due.name.slice(0, 31), { views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }] });
  const naira = '"₦"#,##0.00';

  const price = due.kind === 'recurring' ? `${due.period}` : 'once';
  sheet.addRow([group.name]).font = { bold: true, size: 14 };
  sheet.addRow([
    `${due.name} · ₦${koboToNaira(due.amount).toLocaleString('en-NG')} ${price} · ${due.compulsory ? 'compulsory' : 'optional'}${report.year ? ` · ${report.year}` : ''}`,
  ]);
  sheet.addRow([
    `Collected ₦${koboToNaira(report.totals.collected).toLocaleString('en-NG')} · Outstanding ₦${koboToNaira(report.totals.outstanding).toLocaleString('en-NG')} · ${report.totals.owing} of ${report.totals.members} owing`,
  ]);
  sheet.addRow([`Exported ${new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date())}`]).font = {
    color: { argb: 'FF888888' },
  };
  sheet.addRow([]);

  const header = sheet.addRow(['Member', 'Username', ...names, 'Periods paid', 'Owes']);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F1F4' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  for (const row of report.items) {
    const line = sheet.addRow([
      row.user.name ?? '',
      row.user.username ? `@${row.user.username}` : '',
      ...row.cells.map((c) => (c ? STATUS_LABEL[c] : '')),
      row.paid,
      koboToNaira(row.owed),
    ]);
    row.cells.forEach((c, i) => {
      const fill = c && STATUS_FILL[c];
      if (fill) line.getCell(3 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
    line.getCell(3 + names.length + 1).numFmt = naira;
    if (row.owed > 0) line.getCell(3 + names.length + 1).font = { color: { argb: 'FFC62828' } };
  }

  // Per column: how many paid of those it applied to, and what came in.
  const paidRow = sheet.addRow(['Paid', '', ...report.columns.map((c) => `${c.paid} of ${c.members}`), '', '']);
  const collectedRow = sheet.addRow(['Collected', '', ...report.columns.map((c) => koboToNaira(c.collected)), '', koboToNaira(report.totals.outstanding)]);
  paidRow.font = collectedRow.font = { bold: true };
  collectedRow.eachCell((cell, n) => {
    if (n > 2) cell.numFmt = naira;
  });
  collectedRow.getCell(1).value = 'Collected';
  collectedRow.getCell(3 + names.length + 1).note = 'Total outstanding';

  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 18;
  names.forEach((_, i) => (sheet.getColumn(3 + i).width = due.period === 'weekly' ? 14 : 11));
  sheet.getColumn(3 + names.length).width = 13;
  sheet.getColumn(4 + names.length).width = 14;

  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const slug = `${group.name}-${due.name}${report.year ? `-${report.year}` : ''}`
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return { buffer, filename: `${slug}.xlsx` };
}
