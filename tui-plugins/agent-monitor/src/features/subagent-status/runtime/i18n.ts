export type Locale = 'en' | 'es';

const translations = {
  en: {
    subagents: 'Subagents',
    active: 'Active',
    recent: 'Recent',
    noSubagentsYet: 'No subagents yet',
    run: 'run',
    done: 'done',
    err: 'err',
    syncing: '⟳ syncing...',
    subagents_snapshot: 'Subagents snapshot',
  },
  es: {
    subagents: 'Subagentes',
    active: 'Activos',
    recent: 'Recientes',
    noSubagentsYet: 'Todavía no hay subagentes',
    run: 'act',
    done: 'listo',
    err: 'err',
    syncing: '⟳ sincronizando...',
    subagents_snapshot: 'Subagentes snapshot',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['en'];

let cachedLocale: Locale | undefined;

export const detectSystemLocale = (): Locale => {
  const envLocale =
    process.env.LANG ?? process.env.LC_ALL ?? process.env.LANGUAGE ?? Intl.DateTimeFormat().resolvedOptions().locale;
  const normalized = envLocale.toLowerCase();
  if (normalized.startsWith('es')) return 'es';
  return 'en';
};

export const getLocale = (): Locale => {
  if (!cachedLocale) cachedLocale = detectSystemLocale();
  return cachedLocale;
};

/** Exposed for testability — reset the cached locale between tests. */
export const resetLocale = (): void => {
  cachedLocale = undefined;
};

export const t = (key: TranslationKey): string => {
  return translations[getLocale()][key] ?? translations.en[key];
};
