import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { inTransaction, isDuplicateKey } from '../../lib/db';
import { withLegacy } from '../../lib/references';
import { notFound } from '../../lib/errors';
import { bus } from '../../lib/events';
import { BeneficiariesService } from '../beneficiaries/beneficiaries.service';
import { BeneficiaryModel } from '../beneficiaries/models/beneficiary.model';
import { ChargesService } from '../charges/charges.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { customerOf } from '../payments/customer';
import { gateway } from '../payments/providers';
import { TransactionModel } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { DedicatedAccountModel, type DedicatedAccountDoc, type IDedicatedAccount } from './models/dedicated-account.model';
import { recordLateFee } from './wallet.service';

/**
 * Every dedicated account is its own SaySwitch customer with a synthetic email we control,
 * so customer codes never collide with the customers SaySwitch creates for one-time
 * fundings, and SaySwitch's emails never reach the user.
 */
const accountEmail = (prefix: 'w' | 'b', id: string) => `${prefix}${id}@${env.CUSTOMER_EMAIL_DOMAIN}`;

export const collectionReference = (providerReference: string) => `TSV${providerReference}`.slice(0, 40);

export const toAccountDto = (a: IDedicatedAccount) => ({
  bankName: a.bankName,
  accountNumber: a.accountNumber,
  accountName: a.accountName,
});

export type CollectResult =
  | { status: 'credited'; transaction: ReturnType<typeof toTransactionDto>; userId: string }
  | { status: 'already_credited'; transaction: ReturnType<typeof toTransactionDto> }
  | { status: 'not_paid' }
  | { status: 'unmatched'; customerCode?: string };

export const CollectionsService = {
  /** Creates (once) the permanent account for a wallet or a beneficiary. */
  async issue(p: {
    userId: string | Types.ObjectId;
    purpose: 'wallet' | 'beneficiary';
    beneficiary?: { id: string; label: string };
    consent?: IDedicatedAccount['consent'];
  }): Promise<DedicatedAccountDoc> {
    const filter = p.purpose === 'wallet' ? { user: p.userId, purpose: 'wallet' } : { beneficiary: p.beneficiary!.id };
    const existing = await DedicatedAccountModel.findOne(filter);
    if (existing) return existing;

    const user = await UserModel.findById(p.userId);
    if (!user) throw notFound('Account not found');
    const customer = customerOf(user);
    const va = await gateway.createDedicatedAccount({
      ...customer,
      email: p.purpose === 'wallet' ? accountEmail('w', user.id) : accountEmail('b', p.beneficiary!.id),
      ...(p.beneficiary && { lastName: `${customer.lastName} ${p.beneficiary.label}`.slice(0, 40) }),
    });
    try {
      return await DedicatedAccountModel.create({
        user: user._id,
        purpose: p.purpose,
        beneficiary: p.beneficiary?.id ?? null,
        accountNumber: va.accountNumber,
        bankName: va.bankName,
        accountName: va.accountName,
        customerCode: va.customerCode,
        consent: p.consent,
      });
    } catch (err) {
      // Two taps racing: the other request saved first. (SaySwitch keys the customer by email, so it's the same account.)
      if (isDuplicateKey(err)) return (await DedicatedAccountModel.findOne(filter))!;
      throw err;
    }
  },

  walletAccount: (userId: string) => DedicatedAccountModel.findOne({ user: userId, purpose: 'wallet' }),

  /**
   * Money arrived at SaySwitch under `providerReference` (their reference). Verifies it,
   * works out whose account it was from SaySwitch's own answer, and credits it once.
   * Safe to call from webhooks, replays and admins any number of times.
   */
  async collect(providerReference: string, hint: { accountNumber?: string; customerCode?: string; providerFee?: number } = {}): Promise<CollectResult> {
    const reference = collectionReference(providerReference);
    const existing = await TransactionModel.findOne({ reference: { $in: withLegacy(reference) } });
    if (existing) {
      if (hint.providerFee !== undefined) await recordLateFee(existing, hint.providerFee, 'collection');
      return { status: 'already_credited', transaction: toTransactionDto(existing) };
    }

    const status = await gateway.verify(providerReference);
    if (status.status !== 'success' || status.amountPaid <= 0) return { status: 'not_paid' };

    // SaySwitch's verify is authoritative. The webhook's account number is only a fallback
    // for when verify doesn't name a customer.
    const account = status.customerCode
      ? await DedicatedAccountModel.findOne({ customerCode: status.customerCode })
      : await DedicatedAccountModel.findOne(
          hint.accountNumber ? { accountNumber: hint.accountNumber } : { customerCode: hint.customerCode ?? '__none__' },
        );
    if (!account) return { status: 'unmatched', ...(status.customerCode && { customerCode: status.customerCode }) };

    const beneficiary = account.beneficiary ? await BeneficiaryModel.findById(account.beneficiary) : null;
    const paid = status.amountPaid;
    const reportedFee = status.providerFee ?? hint.providerFee;
    const providerFee = reportedFee ?? 0;
    const { charges, fee } = await ChargesService.compute({ scope: 'funding' }, paid);
    const credit = Math.max(0, paid - fee);

    const tx = await inTransaction(async (session) => {
      if (await TransactionModel.exists({ reference: { $in: withLegacy(reference) } }).session(session)) return null;
      const [t] = await TransactionModel.create(
        [
          {
            reference,
            user: account.user,
            kind: account.purpose === 'wallet' ? 'funding' : 'beneficiary_collection',
            direction: 'credit',
            status: 'success',
            amount: credit,
            fee: paid - credit,
            total: paid,
            charges,
            ...(beneficiary && { beneficiary: beneficiary._id, narration: `${beneficiary.label} · ${account.bankName} ${account.accountNumber}` }),
            providerData: { reference: providerReference },
            funding: {
              channel: 'dedicated',
              accountNumber: account.accountNumber,
              bankName: account.bankName,
              accountName: account.accountName,
              expiresAt: new Date(),
              amountReceived: paid,
              providerFee,
              providerFeeReported: reportedFee !== undefined,
            },
            completedAt: new Date(),
            events: [{ type: 'success', at: new Date(), note: `Transfer into ${account.purpose} account ${account.accountNumber}` }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `collection:${providerReference}`,
          memo: `Transfer into ${account.purpose} account ${account.accountNumber}`,
          transactionId: t!._id,
          lines: [
            { account: Accounts.collections, amount: paid - providerFee },
            // We absorb SaySwitch's fee so funding looks free.
            { account: Accounts.providerFees('collection'), amount: providerFee },
            { account: Accounts.wallet(account.user), amount: -credit },
            { account: Accounts.charges('funding'), amount: -(paid - credit) },
          ],
        },
        session,
      );
      return t!;
    });
    if (!tx) return { status: 'already_credited', transaction: toTransactionDto((await TransactionModel.findOne({ reference: { $in: withLegacy(reference) } }))!) };

    if (beneficiary) {
      bus.emit('beneficiary.collection', { transactionId: tx.id, beneficiaryId: beneficiary.id });
      // Auto-pay needs the user's current opt-in; an opted-out or removed beneficiary just keeps the money in the wallet.
      if (beneficiary.autoPay && !beneficiary.archivedAt) {
        await BeneficiariesService.autoPay(beneficiary, credit).catch((err) => console.error(`[collections] auto-pay ${beneficiary.id}`, err));
      }
    } else {
      bus.emit('funding.succeeded', { transactionId: tx.id });
    }
    return { status: 'credited', transaction: toTransactionDto(tx), userId: account.user.toString() };
  },

  /** For the "I've sent it" screen: transfers into this user's permanent accounts since `since`. */
  async credits(userId: string, since: Date) {
    const items = await TransactionModel.find({
      user: userId,
      kind: { $in: ['funding', 'beneficiary_collection'] },
      'funding.channel': 'dedicated',
      status: 'success',
      createdAt: { $gt: since },
    })
      .sort({ createdAt: -1 })
      .limit(20);
    return items.map(toTransactionDto);
  },
};
