import type { Category } from './types';
import { isFallbackCategory } from './categories';
import { DEFAULT_LOCALE, type Locale } from './i18n/locale';

const DISPLAY_LOCALES: Record<Locale, string> = {
  es: 'es-ES', en: 'en-GB', us: 'en-US', fr: 'fr-FR', de: 'de-DE', br: 'pt-BR', au: 'en-AU',
};

type NamedCategory = Pick<Category, 'id' | 'typeId' | 'name'>;

export function createListComparators(locale: Locale = DEFAULT_LOCALE) {
  const compareNames = new Intl.Collator(DISPLAY_LOCALES[locale], { sensitivity: 'base' }).compare;
  const byName = (a: { name: string }, b: { name: string }) => compareNames(a.name, b.name);
  const byCategory = (a?: NamedCategory, b?: NamedCategory) => {
    const aOther = !!a && isFallbackCategory(a);
    const bOther = !!b && isFallbackCategory(b);
    if (aOther !== bOther) return aOther ? 1 : -1;
    return compareNames(a?.name ?? '~', b?.name ?? '~');
  };
  return { compareNames, byName, byCategory };
}
