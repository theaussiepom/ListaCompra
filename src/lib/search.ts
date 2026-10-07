// Búsqueda difusa del catálogo, compartida por toda la app.
//
// scoreMatch y selectAutomaticMatch mantienen paridad con routing.py.
// Las sugerencias son tolerantes; las acciones automáticas exigen confianza.

import type { Product } from './types';

/** minúsculas + sin acentos/diacríticos. */
export const norm = (s: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');

/** ¿Aparecen los caracteres de `needle` en orden dentro de `hay`? */
const isSubsequence = (needle: string, hay: string): boolean => {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
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
export function rankScoredMatches<T extends { name: string; id?: string }>(items: T[], query: string) {
  const q = norm(query.trim());
  if (!q) return [];
  return items
    .map((it) => ({ it, score: scoreMatch(norm(it.name), q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => {
      const order = b.score - a.score || norm(a.it.name).length - norm(b.it.name).length;
      if (order) return order;
      const left = `${norm(a.it.name)}\0${a.it.id ?? ''}`;
      const right = `${norm(b.it.name)}\0${b.it.id ?? ''}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

export function rankMatches<T extends { name: string; id?: string }>(items: T[], query: string): T[] {
  return rankScoredMatches(items, query).map((x) => x.it);
}

/** Solo exactos únicos o prefijos de palabra completa sin competidores léxicos. */
export function selectAutomaticMatch<T extends { name: string; id?: string }>(items: T[], query: string): T | null {
  const ranked = rankScoredMatches(items, query);
  const best = ranked[0];
  if (!best || ranked[1]?.score === best.score) return null;
  if (best.score === 5) return best.it;
  const q = norm(query.trim());
  if (best.score === 4 && q.length >= 3 && /\s/.test(norm(best.it.name).charAt(q.length))
    && !ranked.slice(1).some((candidate) => candidate.score >= 3)) return best.it;
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
