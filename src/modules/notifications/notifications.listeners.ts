import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { CouponModel } from '../coupons/models/coupon.model';
import { CouponsService } from '../coupons/coupons.service';
import { GroupMemberModel, GroupModel, GroupPayoutChangeModel } from '../groups/models/group.model';
import { SplitModel } from '../splits/models/split.model';
import { RecurringBillModel } from '../recurring/models/recurring-bill.model';
import { TransactionModel } from '../transactions/models/transaction.model';
import { UserModel } from '../users/models/user.model';
import { publicName } from '../users/users.service';
import { NotificationsService } from './notifications.service';

/** Turns domain events into in-app notifications, pushes and SMS. */
export function registerNotifications() {
  // Push reaches the victim's old device; email matters because a SIM swap doesn't reach it.
  bus.on('pin.reset', async ({ userId }) => {
    const body = "Your Tela PIN was changed. If this wasn't you, contact support now.";
    await NotificationsService.notify(userId, { type: 'system', title: 'PIN changed', body });
    const user = await UserModel.findById(userId).select('email');
    if (user?.email) await NotificationsService.email(user.email, 'Your Tela PIN was changed', body);
  });

  bus.on('bvn.reviewed', async ({ userId, status, reason }) => {
    await NotificationsService.notify(userId, {
      type: 'system',
      title: status === 'verified' ? 'BVN verified' : 'BVN not verified',
      body: status === 'verified' ? 'Your BVN has been verified.' : `We couldn't verify your BVN: ${reason}. Check it and try again.`,
    });
  });

  bus.on('seller.reviewed', async ({ userId, status, reason }) => {
    await NotificationsService.notify(userId, {
      type: 'system',
      title: status === 'approved' ? "You're approved to sell tickets" : 'Your selling details need another look',
      body:
        status === 'approved'
          ? 'Your details are verified. You can create events and start selling.'
          : `We couldn't approve your details: ${reason}. Send them again from your selling page.`,
    });
  });

  // ── Groups ──
  bus.on('group.member', async ({ memberId, stage }) => {
    const member = await GroupMemberModel.findById(memberId);
    const group = member && (await GroupModel.findById(member.group));
    if (!member || !group) return;
    const data = { groupId: group.id as string };
    if (stage === 'requested') {
      const user = await UserModel.findById(member.user).select('fullName username');
      const who = user ? publicName(user) : 'Someone';
      for (const e of group.executives) {
        await NotificationsService.notify(e.user, { type: 'system', title: `${group.name}: new join request`, body: `${who} asked to join. Approve or decline them in the group.`, data });
      }
    }
    if (stage === 'approved') await NotificationsService.notify(member.user, { type: 'system', title: `You’re in ${group.name}`, body: 'An executive approved you. You can pay your dues now.', data });
    if (stage === 'rejected') await NotificationsService.notify(member.user, { type: 'system', title: `${group.name} declined your request`, body: 'Contact the group if you think this is a mistake.', data });
  });

  bus.on('group.due', async ({ groupId, dueId }) => {
    const group = await GroupModel.findById(groupId);
    const due = group?.dues.find((d) => d._id.toString() === dueId);
    if (!group || !due) return;
    // A one-off is for whoever's in the group now; a recurring due for every member.
    const members = await GroupMemberModel.find({ group: group._id, status: 'active', ...(due.kind === 'one_off' && { joinedAt: { $lte: due.createdAt } }) }).select('user');
    const price = due.kind === 'recurring' ? `${formatNaira(due.amount)} ${due.period}` : formatNaira(due.amount);
    const body = due.compulsory
      ? `${price}${due.dueAt ? `, due by ${due.dueAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })}` : ''}. Pay it from the group.`
      : `${price}, optional. Pay it from the group if you’d like to.`;
    for (const m of members) {
      await NotificationsService.notify(m.user, { type: 'system', title: `${group.name}: ${due.name}`, body, data: { groupId } });
    }
  });

    bus.on('group.suspension', async ({ groupId, suspended, reason }) => {
    const group = await GroupModel.findById(groupId);
    if (!group) return;
    for (const e of group.executives) {
      await NotificationsService.notify(e.user, {
        type: 'system',
        title: suspended ? `${group.name} is paused by Tela` : `${group.name} is back`,
        body: suspended
          ? `${reason ? `${reason}. ` : ''}Members can't join or pay, and withdrawals wait, while we review. The group's money is safe.`
          : 'Members can join and pay again, and withdrawals are open.',
        data: { groupId },
      });
    }
  });

  bus.on('group.payoutChange', async ({ changeId, stage }) => {
    const change = await GroupPayoutChangeModel.findById(changeId);
    const group = change && (await GroupModel.findById(change.group));
    if (!change || !group) return;
    const data = { groupId: group.id as string };
    const to = `${change.to.accountName}, ${change.to.bankName} •••• ${change.to.accountNumber.slice(-4)}`;
    const executives = group.executives.map((e) => e.user);
    const tell = async (users: typeof executives, title: string, body: string) => {
      for (const user of users) await NotificationsService.notify(user, { type: 'system', title, body, data, dedupeKey: `payout-change:${changeId}:${stage}:${String(user)}` });
    };
    if (stage === 'proposed') {
      await tell(change.cosigners.map((c) => c.user), `${group.name}: approve a new payout account?`, `The owner wants dues paid out to ${to}. Open the group to approve or object.`);
      await tell(executives.filter((e) => !change.cosigners.some((c) => c.user.equals(e))), `${group.name}: payout account change`, `The owner proposed paying dues out to ${to}. You can object in the group.`);
    }
    if (stage === 'cooling_off') {
      const members = await GroupMemberModel.find({ group: group._id, status: 'active' }).select('user').lean();
      const when = change.effectiveAt!.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
      await tell(executives, `${group.name}: payout account changes ${when}`, `Approved. Dues will be paid out to ${to} from ${when} unless an executive objects.`);
      await tell(members.map((m) => m.user), `${group.name} is changing where dues go`, `From ${when}, dues will be paid out to ${to}. You’ll be asked to accept this before paying again.`);
    }
    if (stage === 'applied') {
      const members = await GroupMemberModel.find({ group: group._id, status: 'active' }).select('user').lean();
      await tell(members.map((m) => m.user), `${group.name}: accept the new terms`, `Dues are now paid out to ${to}. Accept the new terms in the group before your next payment.`);
      await tell(executives, `${group.name}: new payout account is live`, `Withdrawals now go to ${to}.`);
    }
    if (stage === 'rejected') await tell(executives, `${group.name}: payout account change stopped`, `An executive objected: ${change.closedReason ?? 'no reason given'}. The account stays as it was.`);
    if (stage === 'expired') await tell(executives, `${group.name}: payout account change lapsed`, 'Not every co-signer approved in time. The account stays as it was.');
  });

  // ── Split bills ──
  bus.on('split.update', async ({ splitId, stage }) => {
    const split = await SplitModel.findById(splitId);
    if (!split) return;
    const data = { splitId };
    const everyone = [...new Map([split.starter, ...split.shares.map((x) => x.user)].map((u) => [String(u), u])).values()];
    if (stage === 'created') {
      const starter = await UserModel.findById(split.starter).select('fullName username');
      const who = starter ? publicName(starter) : 'Someone';
      for (const share of split.shares) {
        if (share.user.equals(split.starter)) continue;
        await NotificationsService.notify(share.user, {
          type: 'bill',
          title: `${who} is splitting ${split.title}`,
          body: `Your share is ${formatNaira(share.amount)}. Pay it before the deadline, or everyone gets their money back.`,
          data,
        });
      }
      return;
    }
    if (stage === 'rescheduled') {
      const when = split.deadline.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
      for (const share of split.shares) {
        if (share.user.equals(split.starter) || share.paidAt) continue;
        await NotificationsService.notify(share.user, { type: 'bill', title: `${split.title}: new deadline`, body: `Pay your ${formatNaira(share.amount)} share by ${when}.`, data });
      }
      return;
    }
    const copy = {
      paid: {
        title: `${split.title} is paid`,
        body:
          split.bill.serviceId === 'electricity'
            ? 'Everyone paid their share and the bill went through. Open the split for the token.'
            : 'Everyone paid their share and the bill went through.',
      },
      failed: { title: `${split.title} wasn’t paid`, body: split.closedReason ?? 'Everyone got their share back.' },
      expired: { title: `${split.title} ran out of time`, body: 'Not everyone paid before the deadline, so everyone got their share back.' },
      cancelled: { title: `${split.title} was cancelled`, body: 'Anyone who paid got their share back.' },
    }[stage];
    for (const user of everyone) await NotificationsService.notify(user, { type: 'bill', ...copy, data, dedupeKey: `split:${splitId}:${stage}:${String(user)}` });
  });

  bus.on('event.rateReminder', async ({ userId, eventId, title, organiser }) => {
    await NotificationsService.notify(userId, {
      type: 'system',
      title: `How was ${title}?`,
      body: `Rate ${organiser} from your ticket in Tela. Your stars help other people pick good events.`,
      data: { eventId },
    });
  });

  bus.on('seller.suspension', async ({ userId, suspended, reason }) => {
    await NotificationsService.notify(userId, {
      type: 'system',
      title: suspended ? 'Your selling account is suspended' : 'Your selling account is back',
      body: suspended
        ? `${reason ? `${reason}. ` : ''}Your events are paused and withdrawals are on hold while we review. Tickets already sold still work.`
        : 'You can sell tickets again. Events we paused are back on sale.',
    });
  });

  bus.on('funding.succeeded', async ({ transactionId }) => {
    const t = await TransactionModel.findById(transactionId);
    if (!t) return;
    await NotificationsService.notify(t.user, {
      type: 'wallet',
      title: 'Wallet funded',
      body: `${formatNaira(t.amount)} has been added to your wallet.`,
      data: { reference: t.reference },
      dedupeKey: `funded:${t.reference}`,
    });
  });

  bus.on('bill.succeeded', async ({ transactionId }) => {
    const t = await TransactionModel.findById(transactionId);
    if (!t?.bill) return;
    const body = t.bill.token
      ? `Your ${t.bill.provider} token: ${t.bill.token}${t.bill.units ? ` (${t.bill.units} units)` : ''}`
      : `${formatNaira(t.amount)} ${t.bill.provider} payment for ${t.bill.account} was successful.`;
    await NotificationsService.notify(t.user, {
      type: 'bill',
      title: 'Payment successful',
      body,
      data: { reference: t.reference },
      dedupeKey: `bill-ok:${t.reference}`,
    });
  });

  // "Pay their bill": tell the recipient only once it's actually delivered, token included.
  bus.on('bill.succeeded', async ({ transactionId }) => {
    const t = await TransactionModel.findById(transactionId);
    if (!t?.bill || !t.giftTo?.label) return;
    const sender = await UserModel.findById(t.user).select('fullName username');
    const from = sender ? publicName(sender) : 'Someone';
    const proof = t.bill.token
      ? ` ${t.bill.serviceId === 'electricity' ? 'Token' : 'PIN'}: ${t.bill.token}${t.bill.units ? ` (${t.bill.units})` : ''}.`
      : t.bill.pins?.length
        ? ` PIN: ${t.bill.pins.map((p) => p.pin).join(', ')}.`
        : '';
    const text = `${from} paid your ${t.bill.provider} ${t.bill.planName ?? ''} (${formatNaira(t.amount)}) for ${t.bill.account} on Tela.${proof}`
      .replace(/\s+/g, ' ')
      .replace(' ()', '');
    const full = t.giftTo.message ? `${text} "${t.giftTo.message}"` : text;

    const recipient = t.giftTo.user
      ? await UserModel.findById(t.giftTo.user)
      : await UserModel.findOne(t.giftTo.phone ? { phone: t.giftTo.phone } : { email: t.giftTo.email });
    if (recipient) {
      await NotificationsService.notify(recipient._id, {
        type: 'gift',
        title: `${from} paid a bill for you 🎁`,
        body: full,
        data: { reference: t.reference },
        dedupeKey: `bill-gift:${t.reference}`,
      });
    }
    // Outside the app too: the token is useful even without Tela installed.
    const phone = recipient?.phone ?? t.giftTo.phone ?? (t.bill.serviceId === 'airtime' ? `+234${t.bill.account.slice(1)}` : undefined);
    const address = recipient?.email ?? t.giftTo.email;
    if (phone) await NotificationsService.sms(phone, full);
    else if (address) await NotificationsService.email(address, `${from} paid a bill for you on Tela 🎁`, full);
  });

  bus.on('bill.failed', async ({ transactionId }) => {
    const t = await TransactionModel.findById(transactionId);
    if (!t?.bill) return;
    await NotificationsService.notify(t.user, {
      type: 'bill',
      title: 'Payment failed',
      body: `Your ${t.bill.provider} payment for ${t.bill.account} didn't go through. ${formatNaira(t.total)} is back in your wallet.`,
      data: { reference: t.reference },
      dedupeKey: `bill-failed:${t.reference}`,
    });
  });

  bus.on('transfer.completed', async ({ creditId }) => {
    const t = await TransactionModel.findById(creditId);
    if (!t) return;
    await NotificationsService.notify(t.user, {
      type: 'transfer',
      title: 'Money received',
      body: `@${t.counterparty?.username ?? 'someone'} sent you ${formatNaira(t.amount)}.`,
      data: { reference: t.reference },
    });
  });

  bus.on('gift.created', async ({ couponId }) => {
    const c = await CouponModel.findById(couponId);
    if (!c || c.kind !== 'gift') return;
    const sender = c.owner ? await UserModel.findById(c.owner).select('fullName username') : null;
    const senderName = c.fundedBy === 'tela' ? 'Tela' : (sender?.fullName ?? `@${sender?.username ?? 'A friend'}`);
    const text = CouponsService.describeGift(c, senderName);
    const full = c.message ? `${text} "${c.message}"` : text;
    const recipient = c.recipientUser
      ? await UserModel.findById(c.recipientUser)
      : await UserModel.findOne(c.recipientPhone ? { phone: c.recipientPhone } : { email: c.recipientEmail });
    if (recipient) {
      await NotificationsService.notify(recipient._id, { type: 'gift', title: 'You received a gift 🎁', body: text, data: { code: c.code } });
    }
    // Also reach them outside the app: an invite if they aren't on Tela yet.
    const phone = recipient?.phone ?? c.recipientPhone;
    const address = recipient?.email ?? c.recipientEmail;
    if (phone) await NotificationsService.sms(phone, full);
    else if (address) await NotificationsService.email(address, `${senderName} sent you a gift on Tela 🎁`, full);
  });

  bus.on('recurring.skipped', async ({ recurringId, reason }) => {
    const r = await RecurringBillModel.findById(recurringId);
    if (!r) return;
    await NotificationsService.notify(r.user, {
      type: 'recurring',
      title: `${r.label} was skipped`,
      body: `${reason}. We'll try again on ${r.nextRunAt.toDateString()}.`,
      data: { recurringId },
    });
  });

  bus.on('beneficiary.collection', async ({ transactionId }) => {
    const t = await TransactionModel.findById(transactionId);
    if (!t) return;
    await NotificationsService.notify(t.user, {
      type: 'wallet',
      title: 'Payment received',
      body: `${formatNaira(t.amount)} arrived for ${t.narration?.split(' · ')[0] ?? 'your beneficiary'}.`,
      data: { reference: t.reference },
      dedupeKey: `collection:${t.reference}`,
    });
  });
}
