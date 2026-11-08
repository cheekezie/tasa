import 'i18next';

import en from '@/locales/en.json';

// Types `t()` against the English file: unknown keys and missing interpolation values fail to compile.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
