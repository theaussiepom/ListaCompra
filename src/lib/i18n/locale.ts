// Idioma/región de Home Assistant → locale del catálogo + bandera.
//
// HA nos pasa `language` (p.ej. "en", "de") y `country` (p.ej. "US", "GB") desde
// el wrapper del panel. Con eso decidimos:
//  - qué catálogo de tiendas/productos cargar (seed localizado), y
//  - qué bandera mostrar junto al selector de tema.

export type Locale = 'es' | 'en' | 'us' | 'fr' | 'de' | 'br' | 'au';

export const LOCALES: Locale[] = ['es', 'en', 'us', 'fr', 'de', 'br', 'au'];

/** Catálogo por defecto cuando el idioma no es ninguno de los soportados.
 *  Inglés y no español: el proyecto nace en Euskadi, pero se publica en HACS
 *  para todo el mundo y un italiano o un neerlandés no espera ver Mercadona. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Mapea idioma+país al locale de catálogo soportado. */
export function resolveLocale(language?: string, country?: string): Locale {
  const lang = (language ?? '').toLowerCase().split('-')[0];
  const cc = (country ?? '').toUpperCase();
  if (lang === 'de') return 'de';
  if (lang === 'fr') return 'fr';
  if (lang === 'pt') return 'br';
  if (lang === 'en') return cc === 'AU' ? 'au' : cc === 'US' ? 'us' : 'en';
  // Lenguas cooficiales de España: el catálogo español es el que les sirve.
  // Sin esto caerían al DEFAULT_LOCALE inglés, que para un HA en euskera sería
  // absurdo (este proyecto nace precisamente en Euskadi).
  if (lang === 'es' || lang === 'eu' || lang === 'ca' || lang === 'gl') return 'es';
  return DEFAULT_LOCALE;
}

/** Locale a partir de la etiqueta de idioma del navegador ("en-US" → 'us').
 *  Se usa fuera de Home Assistant (la demo web), donde no hay idioma de HA que
 *  consultar y antes se caía siempre al catálogo español. */
export function resolveLocaleFromBrowser(tag?: string): Locale {
  const raw = tag ?? (typeof navigator === 'undefined' ? '' : navigator.language);
  const [lang = '', region = ''] = (raw ?? '').split('-');
  return resolveLocale(lang, region);
}

/** Emoji de bandera a partir de un código de país ISO de 2 letras. */
export function countryToFlag(cc?: string): string {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6; // 🇦
  const base = 'A'.charCodeAt(0);
  const up = cc.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - base, A + up.charCodeAt(1) - base);
}

// Bandera por idioma cuando HA no reporta país.
const LANG_FLAG: Record<string, string> = {
  es: '🇪🇸', en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', pt: '🇧🇷',
  nl: '🇳🇱', pl: '🇵🇱', ca: '🇪🇸', eu: '🇪🇸', gl: '🇪🇸',
};

/** Bandera que representa el idioma/país de HA (país si está, si no idioma). */
export function localeFlag(language?: string, country?: string): string {
  const byCountry = countryToFlag(country);
  if (byCountry) return byCountry;
  const lang = (language ?? '').toLowerCase().split('-')[0];
  return LANG_FLAG[lang] ?? '🌐';
}

export const LOCALE_LABEL: Record<Locale, string> = {
  es: 'España', en: 'UK', us: 'USA', fr: 'France', de: 'Deutschland', br: 'Brasil', au: 'Australia',
};

// Bandera del catálogo cargado (locale efectivo). Fiable aunque HA no reporte
// país: siempre coincide con las tiendas/productos que se están mostrando.
export const LOCALE_FLAG: Record<Locale, string> = {
  es: '🇪🇸', en: '🇬🇧', us: '🇺🇸', fr: '🇫🇷', de: '🇩🇪', br: '🇧🇷', au: '🇦🇺',
};
