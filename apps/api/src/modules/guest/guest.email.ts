import { formatNaira } from '../../lib/money';
import { localPhone } from '../../lib/schemas';
import type { ITransaction } from '../transactions/models/transaction.model';
import type { IGuestOrder } from './models/guest-order.model';

const BRAND = '#0A4D3C';
const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cleanToken = (t: string) => t.replace(/^Token\s*:\s*/i, '');

function row(label: string, value: string) {
  return `<tr><td style="padding:6px 0;color:#6B6860;font-size:14px">${escape(label)}</td><td style="padding:6px 0;color:#1A1A18;font-size:14px;text-align:right">${escape(value)}</td></tr>`;
}

/** The big thing they came for: a PIN or token, in a box that's easy to read and copy. */
function codeBox(label: string, value: string) {
  return `<div style="margin:20px 0;padding:18px;border-radius:14px;background:#F0ECE4;text-align:center">
    <div style="color:#6B6860;font-size:12px;letter-spacing:.04em;text-transform:uppercase">${escape(label)}</div>
    <div style="margin-top:6px;font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:.12em;color:#1A1A18">${escape(value)}</div>
  </div>`;
}

/**
 * The email a website buyer gets: their PIN or token with the receipt, or, if it didn't go
 * through, where their money is. Plain inline styles, since email clients ignore stylesheets.
 */
export function guestOrderEmail(order: IGuestOrder, bill: ITransaction | null, inWallet: number, links: { order: string; site: string }) {
  const what = order.bill.planName ?? `${order.bill.provider} ${order.bill.serviceId === 'airtime' ? 'airtime' : order.bill.serviceId === 'electricity' ? 'electricity' : ''}`.trim();
  const delivered = order.status === 'delivered';
  const pins = bill?.bill?.pins ?? [];
  const token = bill?.bill?.token ? cleanToken(bill.bill.token) : null;

  const subject = delivered
    ? pins.length
      ? `Your ${order.bill.planName ?? order.bill.provider} PIN`
      : token
        ? `Your electricity token for meter ${order.bill.account}`
        : `Your ${order.bill.provider} top-up went through`
    : `Your ${order.bill.provider} payment didn’t go through`;

  const body = delivered
    ? `${pins.map((p) => codeBox(`PIN${p.serial ? ` · serial ${p.serial}` : ''}`, p.pin)).join('')}
       ${token ? codeBox(`Token${bill?.bill?.units ? ` · ${bill.bill.units}` : ''}`, token) : ''}
       ${!pins.length && !token ? `<p style="font-size:16px;color:#1A1A18">${escape(formatNaira(order.amount))} ${escape(order.bill.provider)} was sent to ${escape(order.bill.account)}.</p>` : ''}
       ${pins.length ? '<p style="font-size:14px;color:#6B6860">Keep this PIN safe. It can only be used once.</p>' : ''}`
    : `<p style="font-size:16px;color:#1A1A18">${escape(order.failureReason ?? 'The provider didn’t complete the payment.')}</p>
       <p style="font-size:14px;line-height:1.6;color:#6B6860">${
         inWallet > 0
           ? `Your ${escape(formatNaira(inWallet))} is safe in a Tasa wallet for ${escape(localPhone(order.phone))}. Get the Tasa app and sign up with that number to use it, or to try again.`
           : 'No money was taken.'
       }</p>`;

  const html = `<!doctype html><html><body style="margin:0;background:#FAF8F4;font-family:-apple-system,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:700;color:${BRAND}">Tasa</div>
    <div style="margin-top:20px;padding:28px;border-radius:20px;background:#FFFFFF;border:1px solid #E8E4DC">
      <h1 style="margin:0;font-size:20px;color:#063328">${escape(delivered ? 'Here it is' : 'This didn’t go through')}</h1>
      <p style="margin:6px 0 0;font-size:14px;color:#6B6860">${escape([what, order.bill.account, order.bill.customerName].filter(Boolean).join(' · '))}</p>
      ${body}
      <table style="width:100%;margin-top:12px;border-top:1px solid #E8E4DC;border-collapse:collapse">
        ${row('Amount', formatNaira(order.amount))}
        ${order.fee > 0 ? row('Charge', formatNaira(order.fee)) : ''}
        ${row('Reference', bill?.reference ?? order.reference)}
      </table>
      <a href="${escape(links.order)}" style="display:block;margin-top:20px;padding:14px;border-radius:14px;background:${BRAND};color:#FFFFFF;text-align:center;font-weight:600;text-decoration:none">View your order</a>
    </div>
    <p style="margin:20px 4px 0;font-size:13px;line-height:1.6;color:#6B6860">
      Next time, pay in seconds from your Tasa wallet: no transfer to wait for, and your PINs and tokens are always in the app.
      <a href="${escape(links.site)}" style="color:${BRAND}">Get Tasa</a>.
    </p>
  </div></body></html>`;

  return { subject, html };
}
