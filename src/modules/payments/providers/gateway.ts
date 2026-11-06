/**
 * Everything Tela needs from its collection provider (SaySwitch). Bill vending is a
 * separate provider — see modules/bills/providers. Amounts are always integer kobo on
 * this side of the interface; the adapter converts to the provider's units.
 */
export type CollectionAccount = { accountNumber: string; bankName: string; accountName: string };

export type GatewayStatus = {
  status: 'success' | 'pending' | 'failed';
  /** What the payer actually sent, kobo. Never trust a webhook body for this. */
  amountPaid: number;
  /** The provider's own collection fee, kobo, when it reports one. */
  providerFee?: number;
  providerReference?: string;
  /**
   * The SaySwitch customer the payment belongs to. Each dedicated account is one customer,
   * so this — from SaySwitch's own answer, not a webhook body — says whose account it was.
   */
  customerCode?: string;
  message?: string;
};

export type WebhookNotice = {
  kind: 'transaction' | 'payout';
  outcome: 'successful' | 'failed';
  /** Our reference for checkout/transfer collections; the provider's for dedicated accounts. */
  reference: string;
  /** Present when the money landed in a dedicated (beneficiary) account. */
  accountNumber?: string;
  /**
   * SaySwitch's fee on this collection or payout, kobo. The body is signed, so this is
   * trustworthy as a cost figure; amounts to credit and outcomes still come from `verify`.
   */
  fee?: number;
  /** Hint only; attribution uses `verify`'s customerCode. */
  customerCode?: string;
};

/**
 * What a bank payout came to. Only `success` and `failed` are final; `not_found` means SaySwitch
 * has no record of the reference, which is only safe to treat as failed once enough time has
 * passed that a request still in flight can't land; `unknown` is a timeout or a 5xx.
 */
export type PayoutResult = {
  outcome: 'success' | 'failed' | 'pending' | 'not_found' | 'unknown';
  /** SaySwitch's own fee for the payout, kobo, when it reports one. */
  providerFee?: number;
  message?: string;
};

export type PayoutRequest = {
  /** Ours. Sent once per payout and used for every status check. */
  reference: string;
  /** Kobo: what reaches the account. */
  amount: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  narration: string;
};

export type Customer = { firstName: string; lastName: string; email: string; phone: string };

export interface PaymentGateway {
  readonly name: 'sayswitch';
  /** A one-time bank account for exactly this reference and amount. */
  collectByTransfer(p: { reference: string; amount: number; customer: Customer }): Promise<CollectionAccount>;
  /** Authoritative status — always called before money is credited. */
  verify(reference: string): Promise<GatewayStatus>;
  /** A permanent account for one customer (beneficiary auto-pay). */
  createDedicatedAccount(customer: Customer): Promise<CollectionAccount & { customerCode: string }>;

  /** Every bank we can name an account at. */
  listBanks(): Promise<{ code: string; name: string }[]>;
  /** The name a bank holds for this account. Throws ACCOUNT_NOT_FOUND when there's no such account. */
  resolveAccount(bankCode: string, accountNumber: string): Promise<string>;

  /** Sends money from our SaySwitch balance to a bank account. Never throws: a failure is an outcome. */
  payout(p: PayoutRequest): Promise<PayoutResult>;
  /** Authoritative payout status, by our reference. */
  payoutStatus(reference: string): Promise<PayoutResult>;

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(rawBody: string): WebhookNotice | null;
}
