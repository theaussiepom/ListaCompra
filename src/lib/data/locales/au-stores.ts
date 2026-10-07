import type { Store } from '../../types';

// Solo las nueve tiendas activas del contrato AU v2.
export const STORES_AU: Store[] = [
  {"id": "au-woolworths","name": "Woolworths","typeId": "supermercado","icon": {"kind": "emoji","value": "🛒"},"brand": {"bg": "#236B35","fg": "#FFFFFF","initials": "W"},"enabled": true},
  {"id": "au-coles","name": "Coles","typeId": "supermercado","icon": {"kind": "emoji","value": "🛒"},"brand": {"bg": "#B91C1C","fg": "#FFFFFF","initials": "C"},"enabled": true},
  {"id": "au-aldi","name": "ALDI","typeId": "supermercado","icon": {"kind": "emoji","value": "🛒"},"brand": {"bg": "#153A73","fg": "#FFFFFF","initials": "AL"},"enabled": true},
  {"id": "au-iga","name": "IGA","typeId": "supermercado","icon": {"kind": "emoji","value": "🛒"},"brand": {"bg": "#B4202B","fg": "#FFFFFF","initials": "IGA"},"enabled": true},
  {"id": "au-butcher","name": "Butcher","typeId": "carniceria","icon": {"kind": "emoji","value": "🥩"},"brand": {"bg": "#8B2730","fg": "#FFFFFF"},"enabled": true},
  {"id": "au-bakery","name": "Bakery","typeId": "panaderia","icon": {"kind": "emoji","value": "🥖"},"brand": {"bg": "#88551F","fg": "#FFFFFF"},"enabled": true},
  {"id": "au-seafood-shop","name": "Seafood shop","typeId": "pescaderia","icon": {"kind": "emoji","value": "🐟"},"brand": {"bg": "#176085","fg": "#FFFFFF"},"enabled": true},
  {"id": "au-chemist-warehouse","name": "Chemist Warehouse","typeId": "farmacia","icon": {"kind": "emoji","value": "💊"},"brand": {"bg": "#A52425","fg": "#FFFFFF","initials": "CW"},"enabled": true},
  {"id": "au-bunnings","name": "Bunnings","typeId": "ferreteria","icon": {"kind": "emoji","value": "🔧"},"brand": {"bg": "#125C51","fg": "#FFFFFF","initials": "B"},"enabled": true},
];
