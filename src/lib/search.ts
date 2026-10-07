// Búsqueda difusa del catálogo, compartida por toda la app.
//
// scoreMatch y selectAutomaticMatch mantienen paridad con routing.py.
// Las sugerencias son tolerantes; las acciones automáticas exigen confianza.

import type { Product } from './types';
import { getProductConceptResolver, type ProductIdentity } from './productConcept';

type Searchable = ProductIdentity & { name: string; aliases?: string[] };
type ScoredMatch<T> = { it: T; score: number; source: 'canonical' | 'alias'; text: string };

/** minúsculas + sin acentos/diacríticos. */
export const norm = (s: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');

/** ¿Aparecen los caracteres de `needle` en orden dentro de `hay`? */
const isSubsequence = (needle: string, hay: string): boolean => {
  const chars = [...needle];
  let i = 0;
  for (const char of hay) {
    if (char === chars[i]) i++;
  }
  return i === chars.length;
};

// Orden por puntos Unicode, igual que las cadenas de Python.
const compareText = (left: string, right: string): number => {
  const a = [...left];
  const b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (diff) return diff;
  }
  return a.length - b.length;
};

/** Puntúa cómo de bien casa `name` con la consulta `q` (ya normalizados).
 *  Mayor = mejor. -1 = no casa.
 *  5 exacto · 4 empieza por · 3 contiene · 2 todas las palabras · 1 subsecuencia
 *
 *  El 5 (exacto) es lo que evita que "pan" acabe en "panceta": sin él ambos
 *  empataban a 4 (los dos empiezan por "pan") y ganaba el orden del catálogo. */
export const scoreMatch = (name: string, q: string): number => {
  if (name === q) return 5;
  if (name.startsWith(q)) return 4;
  if (name.includes(q)) return 3;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => name.includes(w))) return 2;
  if (isSubsequence(q.replace(/\s+/g, ''), name)) return 1;
  return -1;
};

/** Ordena los que casan, del mejor al peor. A igual puntuación gana el nombre
 *  MÁS CORTO: es el más parecido a lo pedido. */
export function rankScoredMatches<T extends Searchable>(items: T[], query: string): ScoredMatch<T>[] {
  const q = norm(query.trim());
  if (!q) return [];
  return items
    .map((it) => {
      const canonical = norm(it.name);
      let best: ScoredMatch<T> = { it, score: scoreMatch(canonical, q), source: 'canonical', text: canonical };
      for (const alias of Array.isArray(it.aliases) ? it.aliases : []) {
        if (typeof alias !== 'string') continue;
        const text = norm(alias).trim();
        if (!text) continue;
        const score = scoreMatch(text, q);
        if (score > best.score || (score === best.score && best.source === 'alias' && compareText(text, best.text) < 0)) {
          best = { it, score, source: 'alias', text };
        }
      }
      return best;
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => {
      const order = b.score - a.score || Number(a.source === 'alias') - Number(b.source === 'alias')
        || [...norm(a.it.name)].length - [...norm(b.it.name)].length;
      if (order) return order;
      const left = `${norm(a.it.name)}\0${a.it.id ?? ''}`;
      const right = `${norm(b.it.name)}\0${b.it.id ?? ''}`;
      return compareText(left, right);
    });
}

export function rankMatches<T extends Searchable>(items: T[], query: string): T[] {
  return rankScoredMatches(items, query).map((x) => x.it);
}

/** Los alias solo permiten acciones con coincidencia exacta y única. */
export function selectAutomaticMatch<T extends Searchable>(items: T[], query: string): T | null {
  const ranked = rankScoredMatches(items, query);
  const best = ranked[0];
  if (!best) return null;
  const peers = ranked.filter((m) => m.score === best.score && (best.score !== 5 || m.source === best.source));
  const concept = getProductConceptResolver(items);
  const canonical = concept(best.it);
  if (!canonical || peers.some((candidate) => concept(candidate.it) !== canonical)) return null;
  if (best.score === 5) return canonical;
  const q = norm(query.trim());
  if (best.source === 'canonical' && best.score === 4 && [...q].length >= 3 && /\s/.test(best.text.charAt(q.length))
    && !ranked.some((candidate) => candidate.score >= 3 && concept(candidate.it) !== canonical)) return canonical;
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Busca en `pool` el producto del catálogo cuyo nombre aparezca DENTRO de
 *  `scannedName`, y devuelve el más específico (el nombre más largo que casa).
 *
 *  La dirección importa: al escanear, el nombre viene largo y con marca ("Maíz
 *  dulce Hacendado 3x140g") mientras que el del catálogo es corto ("Maíz
 *  dulce"). Buscar el catálogo dentro del escaneado es lo que funciona; al revés
 *  no casa nada.
 *
 *  Se exige que encaje por PALABRAS completas: sin eso, "Panceta ahumada"
 *  contendría "pan" y heredaría la categoría del pan. */
export function findSimilarProduct(
  scannedName: string,
  pool: Product[],
  allowedCategories?: Set<string>,
): Product | null {
  const hay = norm(scannedName).trim();
  if (hay.length < 3) return null;

  let best: Product | null = null;
  let bestLen = 0;
  for (const p of pool) {
    if (allowedCategories && !allowedCategories.has(p.categoryId)) continue;
    const n = norm(p.name).trim();
    if (!n) continue;
    if (n.length <= bestLen) continue;          // ya tenemos uno más específico
    const re = new RegExp(`(^|\\s)${escapeRe(n)}($|\\s)`);
    if (!re.test(hay)) continue;
    best = p;
    bestLen = n.length;
  }
  return best;
}
