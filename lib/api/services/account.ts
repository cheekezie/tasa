import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { kobo } from '@/lib/money';

import { request } from '../client';
import { toAccount, toActivityItem, toFunding } from '../mappers';
import {
  BankAccountDto,
  ContactInput,
  LookupDto,
  OtpSentDto,
  ProfileDto,
  RecipientInput,
  TransactionDto,
  UpdateProfileInput,
  WalletDto,
} from '../types';

// Slow networks and a phone camera's output: give it longer than an ordinary request.
export const UPLOAD_TIMEOUT_MS = 60_000;

/** A picked photo as an upload. Expo's fetch can't send `{ uri, name, type }`: it needs a real file. */
/** One image file, as `name`, the way the API's multipart endpoints read it on every platform. */
export async function appendImage(form: FormData, name: string, uri: string) {
  if (Platform.OS === 'web') form.append(name, await (await fetch(uri)).blob());
  else form.append(name, new File(uri) as unknown as Blob);
}

export async function imageForm(uri: string) {
  const form = new FormData();
  if (Platform.OS === 'web') form.append('file', await (await fetch(uri)).blob());
  else form.append('file', new File(uri) as unknown as Blob);
  return form;
}

export const accountService = {
  getMe: () => request<ProfileDto>('/me').then(toAccount),

  updateMe: (changes: UpdateProfileInput) =>
    request<ProfileDto>('/me', { method: 'PATCH', body: changes }),

  async isUsernameAvailable(username: string) {
    const { available } = await request<{ available: boolean }>('/me/username-available', {
      query: { username },
    });
    return available;
  },

  setBvn: (bvn: string) => request<ProfileDto>('/me/bvn', { method: 'POST', body: { bvn } }),

  setPin: (pin: string, currentPin?: string) =>
    request('/me/pin', { method: 'PUT', body: { pin, currentPin } }),

  async uploadAvatar(uri: string) {
    await request('/me/avatar', { method: 'POST', body: await imageForm(uri), timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  removeAvatar: () => request('/me/avatar', { method: 'DELETE' }),

  /** Whether bill payments ask for the PIN. Needs the PIN either way. */
  setBillPin: (enabled: boolean, pin: string) =>
    request('/me/pin/bills', { method: 'POST', body: { enabled, pin } }),

  /** Forgotten PIN, step 1: a code to the phone or email on the account. */
  requestPinReset: () => request<OtpSentDto>('/me/pin/reset/otp', { method: 'POST' }),

  /** Step 2. The new PIN works straight away. */
  resetPin: (code: string, pin: string) =>
    request('/me/pin/reset', { method: 'POST', body: { code, pin } }),

  /**
   * Permanent. `forfeit` is the small balance the user agreed to give up, exactly as
   * shown to them; the API refuses if it no longer matches, and says what else is in the way.
   */
  closeAccount: (pin: string, forfeit = kobo(0)) =>
    request('/me', {
      method: 'DELETE',
      body: { pin, forfeitAmount: forfeit > 0 ? forfeit : undefined },
    }),

  requestContactCode: (contact: ContactInput) =>
    request('/me/contacts/otp', { method: 'POST', body: contact }),

  verifyContact: (contact: ContactInput, code: string) =>
    request<ProfileDto>('/me/contacts/verify', { method: 'POST', body: { ...contact, code } }),

  addPushToken: (token: string) =>
    request('/me/push-tokens', { method: 'POST', body: { token } }),

  removePushToken: (token: string) =>
    request('/me/push-tokens', { method: 'DELETE', body: { token } }),

  lookupUser: (recipient: RecipientInput) =>
    request<LookupDto>('/users/lookup', { method: 'POST', body: recipient }),
};

export const walletService = {
  getWallet: () => request<WalletDto>('/wallet'),

  /** The user's permanent account number; returns the same one every time. */
  issueAccount: () => request<BankAccountDto>('/wallet/account', { method: 'POST' }),

  /** Credits to the permanent account since `since`: that money arrives with no reference. */
  getAccountCredits: (since: string) =>
    request<TransactionDto[]>('/wallet/account/credits', { query: { since } }).then((items) =>
      items.map(toActivityItem),
    ),

  startFunding: (quoteId: string) =>
    request<TransactionDto>('/wallet/fundings', { method: 'POST', body: { quoteId } }).then(
      toFunding,
    ),

  /** While pending, this also asks the payment provider, so a missed webhook can't strand it. */
  getFunding: (reference: string) =>
    request<TransactionDto>(`/wallet/fundings/${encodeURIComponent(reference)}`).then(toFunding),
};
