<script lang="ts">
  // Recorta una imagen (la foto de un producto o el logo de una tienda) para
  // quitar el entorno que sale alrededor. Pensado para el dedo: arrastrar dentro
  // mueve el recuadro, las esquinas lo redimensionan, y arrastrar fuera dibuja
  // uno nuevo.
  //
  // El recuadro se guarda en FRACCIONES de la imagen (0..1), no en píxeles, para
  // no depender del tamaño en pantalla; al confirmar se mapea a la resolución
  // real y se recorta ahí.

  import { t } from '$lib/i18n/ui.svelte';
  import { canvasToStorableDataUrl } from '$lib/image';

  let { src, onDone, onClose }: {
    src: string;
    onDone: (dataUrl: string) => void;
    onClose: () => void;
  } = $props();

  let imgEl: HTMLImageElement | null = $state(null);
  let natural = $state({ w: 0, h: 0 });

  // Recuadro en fracciones de la imagen. Empieza cubriendo el 80% central.
  let box = $state({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

  const MIN = 0.08;            // lado mínimo del recorte (fracción)
  const HANDLE_HIT = 22;       // px: radio para "agarrar" una esquina con el dedo

  type Mode =
    | { kind: 'move'; px: number; py: number; box: typeof box }
    | { kind: 'resize'; cx: 0 | 1; cy: 0 | 1 }
    | { kind: 'draw'; ox: number; oy: number }
    | null;
  let mode: Mode = null;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  /** Punto del puntero → fracción [0..1] dentro de la imagen renderizada. */
  function toFrac(e: PointerEvent): { fx: number; fy: number } {
    const r = imgEl!.getBoundingClientRect();
    return {
      fx: clamp01((e.clientX - r.left) / r.width),
      fy: clamp01((e.clientY - r.top) / r.height),
    };
  }

  /** ¿El puntero cae sobre una esquina del recuadro? Devuelve cuál. */
  function cornerAt(e: PointerEvent): { cx: 0 | 1; cy: 0 | 1 } | null {
    const r = imgEl!.getBoundingClientRect();
    const corners: { cx: 0 | 1; cy: 0 | 1 }[] = [
      { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 0, cy: 1 }, { cx: 1, cy: 1 },
    ];
    for (const c of corners) {
      const px = r.left + (box.x + c.cx * box.w) * r.width;
      const py = r.top + (box.y + c.cy * box.h) * r.height;
      if (Math.hypot(e.clientX - px, e.clientY - py) <= HANDLE_HIT) return c;
    }
    return null;
  }

  function onDown(e: PointerEvent) {
    if (!imgEl) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const corner = cornerAt(e);
    const { fx, fy } = toFrac(e);
    if (corner) {
      mode = { kind: 'resize', cx: corner.cx, cy: corner.cy };
    } else if (fx >= box.x && fx <= box.x + box.w && fy >= box.y && fy <= box.y + box.h) {
      mode = { kind: 'move', px: fx, py: fy, box: { ...box } };
    } else {
      // Fuera del recuadro: se dibuja uno nuevo desde aquí.
      mode = { kind: 'draw', ox: fx, oy: fy };
      box = { x: fx, y: fy, w: 0, h: 0 };
    }
  }

  function onMove(e: PointerEvent) {
    if (!mode || !imgEl) return;
    const { fx, fy } = toFrac(e);
    if (mode.kind === 'move') {
      const nx = clamp01(mode.box.x + (fx - mode.px));
      const ny = clamp01(mode.box.y + (fy - mode.py));
      box = {
        ...box,
        x: Math.min(nx, 1 - box.w),
        y: Math.min(ny, 1 - box.h),
      };
    } else if (mode.kind === 'resize') {
      // El vértice opuesto queda fijo; el agarrado sigue al dedo.
      const ax = mode.cx === 0 ? box.x + box.w : box.x;
      const ay = mode.cy === 0 ? box.y + box.h : box.y;
      const x = Math.min(ax, fx), y = Math.min(ay, fy);
      box = { x, y, w: Math.abs(fx - ax), h: Math.abs(fy - ay) };
    } else {
      const x = Math.min(mode.ox, fx), y = Math.min(mode.oy, fy);
      box = { x, y, w: Math.abs(fx - mode.ox), h: Math.abs(fy - mode.oy) };
    }
  }

  function onUp() {
    // Descarta recortes accidentales minúsculos: vuelve al 80% central.
    if (box.w < MIN || box.h < MIN) box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    mode = null;
  }

  function confirm() {
    if (!imgEl || !natural.w) return;
    const sx = Math.round(box.x * natural.w);
    const sy = Math.round(box.y * natural.h);
    const sw = Math.max(1, Math.round(box.w * natural.w));
    const sh = Math.max(1, Math.round(box.h * natural.h));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);
    onDone(canvasToStorableDataUrl(canvas));   // redimensiona ≤1024 y comprime
  }

  // Estilo del recuadro: borde + máscara oscura fuera (truco del box-shadow).
  const style = $derived(
    `left:${box.x * 100}%; top:${box.y * 100}%; width:${box.w * 100}%; height:${box.h * 100}%;`,
  );
</script>

<div class="fixed inset-0 z-[80] grid place-items-center p-4"
  style="background: rgba(0,0,0,.9)" role="presentation">
  <div class="w-full max-w-md space-y-3">
    <p class="text-xs text-white/80 text-center">{t('crop.hint')}</p>

    <div class="relative mx-auto select-none" style="touch-action: none; width: fit-content;">
      <img bind:this={imgEl} {src} alt="" draggable="false"
        onload={(e) => { const i = e.currentTarget as HTMLImageElement; natural = { w: i.naturalWidth, h: i.naturalHeight }; }}
        class="block max-w-full rounded-lg" style="max-height: 60vh;" />

      <!-- Capa que recibe los gestos, exactamente sobre la imagen. -->
      <div class="absolute inset-0" style="touch-action: none;"
        onpointerdown={onDown} onpointermove={onMove}
        onpointerup={onUp} onpointercancel={onUp} role="presentation">
        <div class="absolute border-2 border-white"
          style="{style} box-shadow: 0 0 0 9999px rgba(0,0,0,.55);">
          {#each [[0, 0], [1, 0], [0, 1], [1, 1]] as [cx, cy]}
            <span class="absolute size-4 rounded-full bg-white border border-black/30"
              style="left:{cx * 100}%; top:{cy * 100}%; transform: translate(-50%,-50%);"></span>
          {/each}
        </div>
      </div>
    </div>

    <div class="flex items-center justify-center gap-4">
      <button onclick={onClose}
        class="rounded-full border px-4 py-2 text-sm text-white"
        style="border-color: rgba(255,255,255,.4);">{t('scan.cancel')}</button>
      <button onclick={confirm}
        class="rounded-full px-5 py-2 text-sm font-semibold text-white"
        style="background: var(--accent);">✂️ {t('crop.apply')}</button>
    </div>
  </div>
</div>
