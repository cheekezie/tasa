import type { KeyboardTypeOptions } from 'react-native';

import { ServiceId } from '@/constants/theme';
import i18n from '@/lib/i18n';

type AccountRule = {
  keyboardType: KeyboardTypeOptions;
  /** Example shown in the empty field. Functions are resolved in the current language. */
  placeholder: string | (() => string);
  /** Cleans user input before validating and saving. */
  normalize: (value: string) => string;
  /** Applied as they type. Normalising first means a pasted +234 number survives the limit. */
  limit?: (value: string) => string;
  validate: (value: string) => string | null;
};

const digitsOnly = (value: string) => value.replace(/\D/g, '');
const alphanumeric = (value: string) => value.replace(/[^a-z0-9]/gi, '').toUpperCase();

const digitRange =
  (min: number, max: number, nounKey: 'errors.meterNoun' | 'errors.smartCardNoun') =>
  (value: string) => {
    if (value.length >= min && value.length <= max) return null;
    const noun = i18n.t(nounKey);
    return min === max
      ? i18n.t('errors.digits', { noun, min })
      : i18n.t('errors.digitsRange', { noun, min, max });
  };

// Lenient on purpose: catch typos without rejecting real numbers from providers we haven't
// special-cased. The provider is the source of truth when the bill is actually paid.
const rules: Record<ServiceId, AccountRule> = {
  electricity: {
    keyboardType: 'number-pad',
    placeholder: '45098273614',
    normalize: digitsOnly,
    validate: digitRange(10, 13, 'errors.meterNoun'),
  },
  airtime: {
    keyboardType: 'phone-pad',
    placeholder: '08012345678',
    normalize: (value) => {
      const digits = digitsOnly(value);
      return digits.startsWith('234') ? `0${digits.slice(3)}` : digits;
    },
    limit: (value) => rules.airtime.normalize(value).slice(0, 11),
    validate: (value) =>
      /^0[789][01]\d{8}$/.test(value) ? null : i18n.t('errors.phone'),
  },
  tv: {
    keyboardType: 'number-pad',
    placeholder: '7034567890',
    normalize: digitsOnly,
    validate: digitRange(10, 11, 'errors.smartCardNoun'),
  },
  water: {
    keyboardType: 'default',
    placeholder: () => i18n.t('placeholders.water'),
    normalize: alphanumeric,
    validate: (value) => (value.length >= 6 && value.length <= 15 ? null : i18n.t('errors.water')),
  },
  internet: {
    keyboardType: 'default',
    placeholder: () => i18n.t('placeholders.internet'),
    // Smile accounts are identified by the customer's email.
    normalize: (value) => (value.includes('@') ? value.trim().toLowerCase() : alphanumeric(value)),
    validate: (value) => {
      if (value.includes('@')) return validateEmail(value);
      return value.length >= 6 && value.length <= 15 ? null : i18n.t('errors.internet');
    },
  },
  jamb: {
    keyboardType: 'default',
    placeholder: () => i18n.t('placeholders.jamb'),
    normalize: alphanumeric,
    validate: (value) => (value.length >= 8 && value.length <= 14 ? null : i18n.t('errors.jamb')),
  },
};

export function accountRule(serviceId: ServiceId) {
  const rule = rules[serviceId];
  return {
    ...rule,
    placeholder: typeof rule.placeholder === 'function' ? rule.placeholder() : rule.placeholder,
  };
}

/** Returns the cleaned value and an error message, if any. */
export function checkAccountNumber(serviceId: ServiceId, raw: string) {
  const rule = rules[serviceId];
  const value = rule.normalize(raw);
  return { value, error: value ? rule.validate(value) : i18n.t('errors.required') };
}

/** Lowercases and strips a leading @ so "@Ada_1" and "ada_1" are the same handle. */
export function normalizeUsername(raw: string) {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function validateUsername(value: string) {
  if (!value) return i18n.t('errors.required');
  if (value.length < 3 || value.length > 20) return i18n.t('errors.usernameLength');
  if (!/^[a-z0-9_]+$/.test(value)) return i18n.t('errors.usernameChars');
  return null;
}

export function validateEmail(value: string) {
  if (!value) return null; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? null : i18n.t('errors.email');
}

export function validateBvn(value: string) {
  if (!value) return null; // optional until the user adds it
  return /^\d{11}$/.test(value) ? null : i18n.t('errors.bvn');
}

/** Normalises and validates what was typed as a sign-in contact. */
export function checkContact(channel: 'phone' | 'email', raw: string) {
  if (channel === 'phone') {
    const { value, error } = checkAccountNumber('airtime', raw);
    return { channel, value, error };
  }
  const value = raw.trim().toLowerCase();
  return { channel, value, error: value ? validateEmail(value) : i18n.t('errors.required') };
}

/** True when the text reads as a phone number rather than a username. */
export function looksLikePhone(query: string) {
  return /^\+?[\d\s-]+$/.test(query.trim());
}
