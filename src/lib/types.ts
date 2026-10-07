// Tipos centrales de la aplicación.
// El modelo es jerárquico: TipoTienda > Categoría > Producto, y
// cada Tienda concreta apunta a un TipoTienda (Eroski → Supermercado, etc.).

export type Unit = 'unidad' | 'kg' | 'g' | 'l' | 'ml' | 'paquete' | 'docena' | 'caja';

export type IconRef =
  | { kind: 'emoji'; value: string }            // p.ej. "🥩"
  | { kind: 'lucide'; value: string }           // p.ej. "ShoppingBag"
  | { kind: 'image'; value: string };           // dataURL o URL

/** Tipo de tienda (Supermercado, Farmacia, Carnicería, etc.) */
export interface StoreType {
  id: string;
  name: string;
  icon: IconRef;
}

/** Formatos de tarjeta de fidelización soportados (renderizables en pantalla). */
export type LoyaltyFormat = 'qr' | 'ean13' | 'ean8' | 'code128' | 'code39' | 'upca';

/** Tarjeta de fidelización de una tienda. Se guarda en la propia tienda, así que
 *  se sincroniza con la lista (compartida ⇒ visible por sus miembros) y entra en
 *  los backups de HA. Solo se almacena el código; se re-dibuja en pantalla. */
export interface LoyaltyCard {
  code: string;
  format: LoyaltyFormat;
}

/** Tienda concreta del usuario (Eroski, Mercadona, Lidl, ...) */
export interface Store {
  id: string;
  name: string;
  typeId: StoreType['id'];
  icon: IconRef;
  /** Color de fondo de la tarjeta (hex). Usado para evocar la identidad
   *  visual de cada cadena sin reproducir el logotipo (que es marca registrada). */
  brand?: { bg: string; fg: string; initials?: string };
  /** Orden manual en la home; menor = arriba */
  order?: number;
  /** Si es false, oculta la tienda sin borrarla */
  enabled?: boolean;
  /** True si el usuario la ha editado vía StoreEditor. refreshSeed
   *  no la sobreescribe con los valores del código si está marcada. */
  edited?: boolean;
  /** Tarjeta de fidelización de esta tienda (opcional). */
  loyalty?: LoyaltyCard;
}

/** Categoría dentro de un tipo de tienda */
export interface Category {
  id: string;
  name: string;
  typeId: StoreType['id'];
  icon: IconRef;
  order?: number;
}

/** Producto del catálogo (plantilla — no es una entrada de lista todavía) */
export interface Product {
  id: string;
  name: string;
  categoryId: Category['id'];
  /** Nombres alternativos para buscar el mismo producto, sin duplicar su ID. */
  aliases?: string[];
  /** Otra ubicación del mismo concepto; apunta directamente al producto canónico. */
  mirrorOf?: Product['id'];
  icon: IconRef;
  defaultUnit: Unit;
  /** Imagen personalizada subida por el usuario (dataURL) */
  photo?: string;
  /** Si está, el producto es EXCLUSIVO de esa tienda (marca propia: Hacendado
   *  en Mercadona, Eroski Basic…) y no aparece en las demás del mismo tipo.
   *  Sin este campo, el producto está disponible en todas las tiendas de su tipo. */
  storeId?: Store['id'];
  /** Código de barras con el que se dio de alta. Es la clave para reconocerlo
   *  al volver a escanearlo y NO duplicarlo. */
  barcode?: string;
}

/** Una línea de la lista de la compra de una tienda concreta */
export interface ListItem {
  id: string;                  // uuid
  productId: Product['id'];    // referencia al catálogo
  qty: number;
  unit: Unit;
  done: boolean;
  note?: string;
  addedAt: number;             // timestamp
  doneAt?: number;
}

/** Lista de la compra asociada a una tienda */
export interface ShoppingList {
  storeId: Store['id'];
  items: ListItem[];
  updatedAt: number;
}

/** Perfil de usuario local (nombre y tema de este dispositivo). La identidad
 *  para sincronizar la aporta Home Assistant (usuario logueado en HA). */
export interface UserProfile {
  username: string;
  companion?: boolean;         // true si username acaba en "@MOVIL"
  theme: 'light' | 'dark' | 'system';
  createdAt: number;
}

/** Estado completo persistido en LocalStorage */
export interface AppState {
  version: 1;
  profile?: UserProfile;
  storeTypes: StoreType[];     // catálogo (puede sobreescribir el seed)
  stores: Store[];
  categories: Category[];
  products: Product[];
  lists: Record<Store['id'], ShoppingList>;
  /** Frecuencia de uso por tienda y producto. Se incrementa cada vez que el
   *  usuario añade un producto a una lista. Sirve para mostrar "habituales"
   *  en la UI sin tener que listar todo el catálogo. */
  usage?: Record<Store['id'], Record<Product['id'], number>>;
  /** Tienda por defecto de cada TipoTienda. La usa el enrutado por voz
   *  (Assist → add_item): un producto implica un tipo de tienda; si hay varias
   *  tiendas de ese tipo, aquí se fija a cuál va. Lo gestiona el administrador. */
  defaultStores?: Record<StoreType['id'], Store['id']>;
  /** Locale del catálogo (tiendas/productos/idioma de nombres). Se deriva del
   *  idioma/país de Home Assistant, o del navegador fuera de él. Si el idioma no
   *  es ninguno de los soportados, DEFAULT_LOCALE ('en'). */
  locale?: 'es' | 'en' | 'us' | 'fr' | 'de' | 'br';
  /** Icono elegido por el usuario para un producto, incluidos los del seed.
   *
   *  Vive APARTE de `products` porque refreshSeed() reemplaza el seed entero en
   *  cada arranque (`[...seed.products, ...customProducts]`): si el icono se
   *  guardara en el Product, se perdería al recargar y al cambiar de idioma.
   *  Como capa de overrides, el seed sigue mandando en nombre y categoría, solo
   *  se pisa el icono, y borrar la entrada devuelve el original (el emoji del
   *  seed, o la foto que trajo Open Food Facts al escanear). */
  productIcons?: Record<Product['id'], IconRef>;
}
