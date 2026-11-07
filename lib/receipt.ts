import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { ActivityItem } from '@/constants/data';
import { formatNaira } from '@/lib/format';
import i18n from '@/lib/i18n';
import { addKobo, kobo, subtractKobo } from '@/lib/money';

/** Entries saved before references existed get a stable one derived from their id. */
export function transactionReference(item: ActivityItem) {
  if (item.reference) return item.reference;
  const digits = item.id.replace(/\D/g, '');
  return `TL${digits.padStart(13, '0').slice(-13)}`;
}

export function formatDateTime(date: string) {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

export function signedAmount(item: ActivityItem) {
  return `${item.direction === 'credit' ? '+' : '-'}${formatNaira(item.amount)}`;
}

export type ReceiptRow = { label: string; value: string; copyable?: boolean };

/** The detail lines shown on the transaction screen and printed on the receipt. */
export function receiptRows(item: ActivityItem): ReceiptRow[] {
  const t = i18n.t.bind(i18n);
  const rows: (ReceiptRow | false | undefined)[] = [
    { label: t('transaction.reference'), value: transactionReference(item), copyable: true },
    !!item.token && { label: t('transaction.token'), value: item.token, copyable: true },
    !!item.units && { label: t('transaction.units'), value: item.units },
    ...(item.pins ?? []).map((entry) => ({
      label: t('transaction.pin'),
      value: entry.pin,
      copyable: true,
    })),
    { label: t('transaction.type'), value: t(`transaction.types.${item.type}`) },
    { label: t('transaction.date'), value: formatDateTime(item.date) },
    !!item.recipient && { label: t('transaction.recipient'), value: item.recipient },
    !!item.serviceId && { label: t('transaction.service'), value: t(`services.${item.serviceId}.name`) },
    !!item.provider && { label: t('transaction.provider'), value: item.provider },
    !!item.accountNumber &&
      !!item.serviceId && {
        label: t(`services.${item.serviceId}.account`),
        value: item.accountNumber,
        copyable: true,
      },
    !!item.couponCode && { label: t('transaction.coupon'), value: item.couponCode },
    !!item.note && { label: t('transaction.note'), value: item.note },
    !!item.method && { label: t('transaction.method'), value: t(`transaction.methods.${item.method}`) },
  ];

  // Only break the total down when there's something to break down.
  if (item.fee || item.discount) {
    const base = addKobo(subtractKobo(item.amount, item.fee ?? kobo(0)), item.discount ?? kobo(0));
    rows.push({ label: t('common.amount'), value: formatNaira(base) });
    if (item.fee) rows.push({ label: t('transaction.fee'), value: formatNaira(item.fee) });
    if (item.discount) rows.push({ label: t('transaction.discount'), value: `-${formatNaira(item.discount)}` });
  }
  rows.push({ label: t('transaction.total'), value: formatNaira(item.amount) });

  return rows.filter((row): row is ReceiptRow => !!row);
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function receiptHtml(item: ActivityItem) {
  const t = i18n.t.bind(i18n);
  const rows = receiptRows(item)
    .map(
      (row) =>
        `<tr><td class="label">${escape(row.label)}</td><td class="value">${escape(row.value)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 32px; font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1A1A18; background: #FFFFFF; }
  .sheet { max-width: 520px; margin: 0 auto; border: 1px solid #E8E4DC; border-radius: 20px; overflow: hidden; }
  .head { background: #0A4D3C; color: #FFFFFF; padding: 28px 28px 24px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .kind { margin-top: 4px; font-size: 13px; opacity: 0.75; }
  .amount { padding: 28px 28px 8px; text-align: center; }
  .amount .figure { font-size: 34px; font-weight: 700; color: ${item.direction === 'credit' ? '#1B9E77' : '#1A1A18'}; }
  .amount .title { margin-top: 6px; font-size: 15px; color: #6B6860; }
  .status { display: inline-block; margin-top: 12px; padding: 5px 12px; border-radius: 999px; background: #E6F5EF; color: #1B9E77; font-size: 12px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 8px; }
  td { padding: 12px 28px; font-size: 14px; border-top: 1px solid #F0ECE4; vertical-align: top; }
  td.label { color: #6B6860; width: 42%; }
  td.value { text-align: right; font-weight: 600; word-break: break-word; }
  .foot { padding: 18px 28px 26px; font-size: 12px; color: #9C9890; text-align: center; border-top: 1px solid #F0ECE4; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="brand">Tasa</div>
      <div class="kind">${escape(t('transaction.receiptTitle'))}</div>
    </div>
    <div class="amount">
      <div class="figure">${escape(signedAmount(item))}</div>
      <div class="title">${escape(item.title)}</div>
      <div class="status">${escape(t('transaction.successful'))}</div>
    </div>
    <table>${rows}</table>
    <div class="foot">${escape(t('transaction.receiptFooter'))}</div>
  </div>
</body>
</html>`;
}

/**
 * Renders the receipt to a PDF and opens the system sheet, where it can be saved to Files /
 * the device or sent on. Returns false when the device can't share files.
 */
export async function downloadReceipt(item: ActivityItem) {
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(item) });
  if (!(await Sharing.isAvailableAsync())) return false;
  // Print names the file with a random id; give it one people will recognise in Files.
  const named = new File(Paths.cache, `Tasa-receipt-${transactionReference(item)}.pdf`);
  await new File(uri).move(named, { overwrite: true });
  await Sharing.shareAsync(named.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: i18n.t('transaction.download'),
  });
  return true;
}
