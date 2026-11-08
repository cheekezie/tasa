import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import pcm from '@/locales/pcm.json';

export type Language = 'en' | 'pcm';

export const languages: { value: Language; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'pcm', label: 'Nigerian Pidgin', native: 'Pidgin' },
];

/** Keys within one section of locales/en.json, e.g. KeysOf<'settings'> → 'settings.dark' | … */
export type KeysOf<Section extends keyof typeof en> =
  `${Section}.${keyof (typeof en)[Section] & string}`;

/** Every key in locales/en.json, as a dotted path. */
type LeafKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : LeafKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = LeafKeys<typeof en>;

/**
 * What screens call. i18next's own `t` type is too heavy for a locale this size (the compiler
 * gives up with "excessively deep"), so this keeps the part that matters: unknown keys don't compile.
 */
export type Translate = (key: TranslationKey, options?: Record<string, unknown>) => string;

export const resources = {
  en: { translation: en },
  // `satisfies` makes TypeScript flag any key missing from the Pidgin file.
  pcm: { translation: pcm satisfies typeof en },
} as const;

/** The phone's language if we support it, otherwise English. */
export function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'pcm' ? 'pcm' : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
