/**
 * Everything Tela needs from its bill provider (VTpass). Amounts are integer kobo on this
 * side of the interface; the adapter converts.
 */

/**
 * `unknown` = we couldn't tell whether anything was vended (timeout, 5xx, odd code). The
 * money stays held until a requery answers — refunding an unknown risks paying twice.
 * `not_found` = the provider has no record of the request (requery only). Safe to refund
 * once enough time has passed that the original request can't still be in flight.
 */
export type VendOutcome = 'delivered' | 'pending' | 'failed' | 'unknown' | 'not_found';

export type VendResult = {
  outcome: VendOutcome;
  /** The provider's own transaction id. */
  providerTransactionId?: string;
  /** Electricity token or exam PIN, prefix stripped. */
  token?: string;
  units?: string;
  /** Multi-PIN products (WAEC result checker, Spectranet). */
  pins?: { pin: string; serial?: string }[];
  /** What the provider actually took from our wallet, kobo (face value minus commission). */
  cost?: number;
  code?: string;
  message?: string;
};

export type PlanOption = {
  code: string;
  name: string;
  amount: number;
  /** Set when one provider sells several products: the VTpass serviceID this plan is sold under. */
  serviceID?: string;
};

export type VerifiedCustomer = {
  name: string;
  address?: string;
  detail?: { label: string; value: string };
  /** TV: shown beside the package choice when VTpass returns it. */
  currentPlan?: string;
  /** Electricity: the disco's minimum for this meter, kobo. */
  minAmount?: number;
  /** Smile: the account id to pay into (the user enters their email). */
  billersCode?: string;
};

export type VendRequest = {
  requestId: string;
  serviceID: string;
  billersCode?: string;
  variationCode?: string;
  /** Kobo, whole naira. */
  amount?: number;
  /** Customer phone (for airtime: the number to top up). */
  phone: string;
  subscriptionType?: 'change';
  quantity?: number;
};

export type BillerWebhook =
  | { kind: 'transaction'; requestId: string }
  | { kind: 'variations'; serviceID?: string };

export interface BillerGateway {
  readonly name: 'vtpass';
  /** A request id the provider accepts; generate it immediately before `vend`. */
  newRequestId(now?: Date): string;
  plans(serviceID: string): Promise<PlanOption[]>;
  verifyMeter(serviceID: string, meterNumber: string, meterType: 'prepaid' | 'postpaid'): Promise<VerifiedCustomer>;
  verifySmartCard(serviceID: string, smartCardNumber: string): Promise<VerifiedCustomer>;
  verifySmile(serviceID: string, email: string): Promise<VerifiedCustomer & { billersCode: string }>;
  verifyJamb(serviceID: string, profileId: string, planCode?: string): Promise<VerifiedCustomer>;
  vend(req: VendRequest): Promise<VendResult>;
  requery(requestId: string): Promise<VendResult>;
  /** Our prepaid balance with the provider, kobo. */
  balance(): Promise<number>;
  parseWebhook(rawBody: string): BillerWebhook | null;
}
