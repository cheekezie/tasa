import type { AppError } from '../../lib/errors';
import { TransactionModel } from '../transactions/models/transaction.model';
import { env } from '../../config/env';
import { isDuplicateKey } from '../../lib/db';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { Catalog, SERVICES, isPlanBased } from '../bills/bills.catalog';
import { BillsService, verifyBillAccount } from '../bills/bills.service';
import { ChargesService } from '../charges/charges.service';
import { CollectionsService, toAccountDto } from '../wallet/collections.service';
import { DedicatedAccountModel, type IDedicatedAccount } from '../wallet/models/dedicated-account.model';
import type { CreateBeneficiaryInput, OptInInput, UpdateBeneficiaryInput } from './beneficiaries.schema';
import { BeneficiaryModel, type BeneficiaryDoc, type IBeneficiary } from './models/beneficiary.model';

export const toBeneficiaryDto = (b: IBeneficiary, account?: Pick<IDedicatedAccount, 'consent'> | null) => ({
  id: b._id.toString(),
  label: b.label,
  serviceId: b.serviceId,
  provider: b.provider,
  accountNumber: b.account,
  /** The name the provider gave for this account when it was saved, e.g. the meter's owner. */
  customerName: b.customerName ?? null,
  product: b.product ?? null,
  meterType: b.meterType ?? null,
  planCode: b.planCode ?? null,
  /** Buy this bill automatically when money lands in its account number. */
  autoPay: b.autoPay,
  /** null until the user opts in (POST /:id/virtual-account with the accepted terms). */
  virtualAccount: b.virtualAccount?.accountNumber
    ? { bankName: b.virtualAccount.bankName, accountNumber: b.virtualAccount.accountNumber, accountName: b.virtualAccount.accountName }
    : null,
  ...(account?.consent && { termsAccepted: { version: account.consent.termsVersion, at: account.consent.acceptedAt.toISOString() } }),
  createdAt: b.createdAt.toISOString(),
});

async function load(userId: string, id: string) {
  const b = await BeneficiaryModel.findOne({ _id: id, user: userId, archivedAt: null });
  if (!b) throw notFound('Beneficiary not found');
  return b;
}

export const BeneficiariesService = {
  async list(userId: string) {
    const items = await BeneficiaryModel.find({ user: userId, archivedAt: null }).sort({ createdAt: -1 });
    return items.map((b) => toBeneficiaryDto(b));
  },

  async get(userId: string, id: string) {
    const b = await load(userId, id);
    return toBeneficiaryDto(b, await DedicatedAccountModel.findOne({ beneficiary: b._id }).select('consent'));
  },

  /**
   * Saves a bill account, but only one the provider recognises: the meter, smart card, Smile
   * email or JAMB profile is checked with VTpass first, as a bill would be, and the owner's name
   * kept. `verified` skips that for an account a successful payment has just proven.
   */
  async create(userId: string, input: CreateBeneficiaryInput, verified?: { account: string; customerName?: string | undefined }) {
    const provider = Catalog.resolveProvider(input.serviceId, input.provider);
    const checked = verified ?? (await verifyBillAccount(input.serviceId, provider, input.account, { meterType: input.meterType, planCode: input.planCode }));
    const account = checked.account;
    const customerName = verified ? verified.customerName : 'customer' in checked ? checked.customer?.name : undefined;
    let b: BeneficiaryDoc;
    try {
      b = await BeneficiaryModel.create({ ...input, provider: provider.code, account, ...(customerName && { customerName }), user: userId });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('You already saved this account', 'DUPLICATE_BENEFICIARY');
      throw err;
    }
    // No account number until the user opts in and accepts the auto-pay terms.
    return toBeneficiaryDto(b);
  },

  async update(userId: string, id: string, changes: UpdateBeneficiaryInput) {
    const b = await load(userId, id);
    if (changes.autoPay && !b.virtualAccount?.accountNumber) {
      throw unprocessable('Opt in to auto-pay first: accept the terms to get an account number', 'OPT_IN_REQUIRED');
    }
    const { planCode, ...rest } = changes;
    Object.assign(b, rest);
    if (planCode !== undefined) b.planCode = planCode ?? undefined;
    await b.save();
    return toBeneficiaryDto(b);
  },

  /**
   * Archived, not deleted: past activity keeps pointing at it. Its account number stays
   * live — people may have saved it — but transfers into it now only top up the wallet.
   */
  async archive(userId: string, id: string) {
    const b = await load(userId, id);
    b.archivedAt = new Date();
    b.autoPay = false;
    await b.save();
  },

  /**
   * Opt in to a permanent account number with auto-pay. Needs the user to accept the
   * current auto-pay terms; the consent is stored with the account. Calling again (e.g.
   * after turning auto-pay off) just turns auto-pay back on.
   */
  async optIn(userId: string, id: string, input: OptInInput, meta: { ip?: string; userAgent?: string }) {
    const b = await load(userId, id);
    if (input.termsVersion !== env.AUTOPAY_TERMS_VERSION) {
      throw conflict('The auto-pay terms have changed. Please review and accept the latest version', 'TERMS_OUTDATED');
    }
    if (!SERVICES[b.serviceId].available) throw unprocessable(`${SERVICES[b.serviceId].name} payments are coming soon`, 'SERVICE_UNAVAILABLE');
    const consent = { termsVersion: input.termsVersion, acceptedAt: new Date(), ...meta };
    const account = await CollectionsService.issue({ userId, purpose: 'beneficiary', beneficiary: { id: b.id, label: b.label }, consent });
    // Re-accepting (e.g. a newer terms version) is recorded too.
    if (account.consent?.termsVersion !== consent.termsVersion || !b.autoPay) {
      await DedicatedAccountModel.updateOne({ _id: account._id }, { consent });
    }
    b.virtualAccount = { ...toAccountDto(account), customerCode: account.customerCode };
    b.autoPay = true;
    await b.save();
    return toBeneficiaryDto(b, { ...account.toObject(), consent });
  },

  /**
   * Runs once a bill succeeds, so a failed bill never saves a bad account. The payment is
   * already done: an account they'd saved before just gets linked.
   */
  async saveFromBill(transactionId: string) {
    const tx = await TransactionModel.findById(transactionId);
    // Mongoose always hydrates this nested path, so it's the label that says they asked.
    if (!tx?.saveBeneficiary?.label || !tx.bill) return;
    const { serviceId, provider, account, product, meterType, planCode, customerName } = tx.bill;
    const userId = tx.user.toString();
    // The bill was just delivered to this account, so it's proven: no second VTpass check.
    const beneficiaryId = await this.create(
      userId,
      {
        label: tx.saveBeneficiary.label,
        serviceId,
        provider,
        account,
        ...(product && { product }),
        ...(meterType && { meterType }),
        ...(planCode && { planCode }),
      },
      { account, customerName },
    ).then(
      (b) => b.id,
      async (err) => {
        if ((err as AppError).code !== 'DUPLICATE_BENEFICIARY') throw err;
        return (await BeneficiaryModel.findOne({ user: userId, serviceId, account, archivedAt: null }))?.id as string | undefined;
      },
    );
    await TransactionModel.updateOne({ _id: tx._id, beneficiary: null }, { beneficiary: beneficiaryId });
  },

  terms: () => ({ version: env.AUTOPAY_TERMS_VERSION, url: env.AUTOPAY_TERMS_URL }),

  async autoPay(b: BeneficiaryDoc, available: number) {
    const service = SERVICES[b.serviceId];
    if (!service.available) return;
    const planBased = isPlanBased(b.serviceId, b.product);
    let amount: number | undefined;
    if (!planBased) {
      const target = { scope: 'bill' as const, serviceId: b.serviceId, provider: b.provider };
      // Whole naira, as vending requires.
      amount = Math.floor((await ChargesService.maxAmountWithin(target, available)) / 100) * 100;
      if (amount <= 0) return;
    } else if (!b.planCode) {
      return;
    }
    const quote = await BillsService.quote(b.user.toString(), {
      kind: 'bill',
      serviceId: b.serviceId,
      provider: b.provider,
      account: b.account,
      amount,
      product: b.product ?? 'airtime',
      planCode: b.planCode,
      meterType: b.meterType ?? 'prepaid',
      beneficiaryId: b.id,
      autoApply: true,
    });
    if (quote.total > available) return; // e.g. the TV package costs more than was sent
    await BillsService.purchase(b.user.toString(), quote.id, { system: true });
  },
};
