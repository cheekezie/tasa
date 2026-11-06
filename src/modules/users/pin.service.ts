import bcrypt from 'bcryptjs';
import { AppError, forbidden, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { redis } from '../../lib/redis';
import { OtpService } from '../auth/otp.service';
import { UserModel, type IUser } from './models/user.model';

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 30 * 60;
const attemptsKey = (userId: string) => `pin:fail:${userId}`;

function assertStrong(pin: string) {
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '9876'].includes(pin)) {
    throw unprocessable('Choose a PIN that is harder to guess', 'WEAK_PIN');
  }
}

/** Suspended and closed accounts spend nothing, however fresh their access token. */
const assertActive = (user: Pick<IUser, 'status'> | null) => {
  if (user && user.status !== 'active') throw forbidden('This account cannot make payments. Contact support');
};

export const PinService = {
  async set(userId: string, pin: string, currentPin?: string) {
    const user = await UserModel.findById(userId).select('+pinHash');
    if (!user) throw unprocessable('Account not found', 'NOT_FOUND');
    if (user.pinHash) {
      if (!currentPin) throw unprocessable('Enter your current PIN to change it', 'PIN_REQUIRED');
      await this.verify(userId, currentPin);
    }
    assertStrong(pin);
    user.pinHash = await bcrypt.hash(pin, 10);
    await user.save();
  },

  /** Step 1 of a forgotten PIN: a code to the phone (or else email) on the account. */
  async requestReset(userId: string) {
    const user = await UserModel.findById(userId).select('phone email');
    if (!user) throw unprocessable('Account not found', 'NOT_FOUND');
    if (user.phone) return OtpService.send({ type: 'phone', value: user.phone }, 'pin_reset');
    return OtpService.send({ type: 'email', value: user.email! }, 'pin_reset');
  },

  /** Step 2. The new PIN works immediately; the account holder is told in case it wasn't them. */
  async reset(userId: string, code: string, pin: string) {
    assertStrong(pin);
    const user = await UserModel.findById(userId).select('+pinHash phone email');
    if (!user) throw unprocessable('Account not found', 'NOT_FOUND');
    await OtpService.verify(user.phone ? { type: 'phone', value: user.phone } : { type: 'email', value: user.email! }, code, 'pin_reset');
    user.pinHash = await bcrypt.hash(pin, 10);
    await user.save();
    await redis.del(attemptsKey(userId));
    bus.emit('pin.reset', { userId });
    return { hasPin: true };
  },

  /**
   * Bill payments only: the user may skip the PIN. Transfers, gifts and coupons always use
   * `verify`, because they move money to someone else.
   */
  async authorizeBill(userId: string, pin: string | undefined) {
    const user = await UserModel.findById(userId).select('status billPinEnabled');
    if (pin || user?.billPinEnabled !== false) return this.verify(userId, pin);
    assertActive(user);
  },

  /** Proves the PIN either way, so someone holding an open phone can't switch it off. */
  async setBillPin(userId: string, enabled: boolean, pin: string) {
    await this.verify(userId, pin);
    await UserModel.updateOne({ _id: userId }, { billPinEnabled: enabled });
    return { billPinEnabled: enabled };
  },

  /** For debits the system makes with no PIN: recurring bills and auto-pay. */
  async assertCanSpend(userId: string) {
    assertActive(await UserModel.findById(userId).select('status'));
  },

  /**
   * Gate for every debit. Five wrong tries lock PIN use for 30 minutes — sign-in still works,
   * so a locked-out user can still see their balance.
   */
  async verify(userId: string, pin: string | undefined) {
    if (!pin) throw unprocessable('Enter your transaction PIN', 'PIN_REQUIRED');
    const attempts = Number(await redis.get(attemptsKey(userId))) || 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new AppError(423, 'Too many wrong PIN attempts. Try again in 30 minutes', 'PIN_LOCKED');
    }
    const user = await UserModel.findById(userId).select('+pinHash status');
    assertActive(user);
    if (!user?.pinHash) throw unprocessable('Set a transaction PIN first', 'PIN_NOT_SET');
    if (await bcrypt.compare(pin, user.pinHash)) {
      if (attempts) await redis.del(attemptsKey(userId));
      return;
    }
    const failed = await redis.incr(attemptsKey(userId));
    await redis.expire(attemptsKey(userId), LOCK_SECONDS);
    const left = MAX_ATTEMPTS - failed;
    throw unprocessable(
      left > 0 ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left` : 'Too many wrong PIN attempts. Try again in 30 minutes',
      left > 0 ? 'PIN_INCORRECT' : 'PIN_LOCKED',
    );
  },
};
