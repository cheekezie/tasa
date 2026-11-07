import { request } from '../client';
import { toAccount } from '../mappers';
import { clearTokens, getTokens, saveTokens } from '../tokens';
import { ContactInput, OtpSentDto, SessionDto } from '../types';

export type Channel = ContactInput['type'];

export const authService = {
  /** Sends a code by SMS or email. The same call covers sign-in and sign-up. */
  requestOtp: (contact: ContactInput) =>
    request<OtpSentDto>('/auth/otp', { method: 'POST', body: contact, auth: false }),

  /** Creates the account the first time a phone or email is used, then saves the session. */
  async verifyOtp(contact: ContactInput, code: string) {
    const session = await request<SessionDto>('/auth/otp/verify', {
      method: 'POST',
      body: { ...contact, code },
      auth: false,
    });
    await saveTokens(session);
    return { isNewUser: session.isNewUser, account: toAccount(session.user) };
  },

  /** Best effort: the device forgets the session even if the server can't be reached. */
  async logout() {
    const refreshToken = getTokens()?.refreshToken;
    await clearTokens();
    if (!refreshToken) return;
    await request('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(
      () => {},
    );
  },
};
