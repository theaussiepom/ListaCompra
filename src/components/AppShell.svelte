<script lang="ts">
  // Wrapper raíz: hidrata el store y decide si mostrar el setup inicial o
  // la app. La identidad la aporta Home Assistant (el usuario logueado en HA):
  // cuando la app corre dentro del panel de HA, la sync se activa sola.

  import { onMount } from 'svelte';
  import { app } from '$lib/stores/app.svelte';
  import { clearState } from '$lib/storage';
  import ProfileSetup from './auth/ProfileSetup.svelte';
  import StoreGrid from './list/StoreGrid.svelte';
  import ListView from './list/ListView.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import SyncDiag from './ui/SyncDiag.svelte';
  import DefaultStores from './ui/DefaultStores.svelte';
  import Flag from './ui/Flag.svelte';
  import MenuButton from './ui/MenuButton.svelte';
  import { syncStatus, hydrateAuth, stopSync } from '$lib/sync.svelte';
  import { resolveLocale, resolveLocaleFromBrowser, LOCALE_LABEL, DEFAULT_LOCALE } from '$lib/i18n/locale';
  import { t } from '$lib/i18n/ui.svelte';

  let showDiag = $state(false);
  let showDefaults = $state(false);

  // Locale efectivo (catálogo cargado) → determina la bandera SVG mostrada.
  const activeLocale = $derived(app.state.catalogLocale ?? DEFAULT_LOCALE);
  // Falso hasta resolver la identidad de HA; evita que parpadee el ProfileSetup
  // en el panel antes de saber quién es el usuario logueado.
  let ready = $state(false);

  // Routing por hash (SPA de una sola página): así funciona igual servido como
  // estático dentro del panel de HA (aiohttp no sirve subdirectorios) y en GH
  // Pages, y las tiendas creadas en runtime no necesitan página pre-generada.
  let hash = $state('');
  const activeStoreId = $derived.by(() => {
    const m = hash.match(/^#\/lista\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  });

  onMount(async () => {
    app.hydrate();
    applyTheme(app.state.profile?.theme ?? 'system');

    hash = location.hash;
    window.addEventListener('hashchange', () => { hash = location.hash; });

    // Obtiene el token de HA (si estamos en el panel), identidad, shares y
    // arranca la sync. Fuera de HA queda en modo local puro.
    await hydrateAuth();

    const displayLocale = syncStatus.inHA
      ? resolveLocale(syncStatus.haLanguage, syncStatus.haCountry)
      : resolveLocaleFromBrowser();
    app.setLocale(displayLocale);
    app.initializeCatalog(displayLocale);

    // Dentro de HA la identidad es el usuario/person. logueado: no pedimos
    // nombre, autocompletamos (y lo refrescamos) el perfil con ese person.
    if (syncStatus.inHA && syncStatus.user) {
      const name = syncStatus.user.person?.name ?? syncStatus.user.name ?? 'Usuario';
      if (!app.state.profile) {
        app.state.profile = { username: name, theme: 'system', createdAt: Date.now() };
        app.persistLocalOnly();
      } else if (app.state.profile.username !== name) {
        app.state.profile = { ...app.state.profile, username: name };
        app.persistLocalOnly();
      }
    }

    ready = true;
  });

  function applyTheme(t: 'light' | 'dark' | 'system') {
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  $effect(() => {
    if (app.state.profile?.theme) applyTheme(app.state.profile.theme);
  });

  /** Borra los datos locales de este navegador. Si la sync con HA está activa,
   *  los datos siguen en Home Assistant y se recuperan al recargar. */
  function signOut() {
    if (!confirm(t('nav.signOutConfirm'))) return;
    try { stopSync(); } catch {}
    clearState();
    location.reload();
  }
</script>

{#if !app.hydrated}
  <div class="min-h-screen grid place-items-center text-muted">{t('common.loading')}</div>
{:else if !app.state.profile}
  <!-- Sin perfil: dentro de HA se autocompleta (no llega aquí). Fuera de HA
       esperamos a resolver la identidad antes de pedir nombre. -->
  {#if ready}
    <ProfileSetup />
  {:else}
    <div class="min-h-screen grid place-items-center text-muted">{t('common.loading')}</div>
  {/if}
{:else if activeStoreId}
  <!-- Vista de una tienda (routing por hash #/lista/<id>) -->
  <main class="mx-auto max-w-3xl px-4 py-6">
    <ListView storeId={activeStoreId} />
  </main>
{:else}
  <main class="mx-auto max-w-5xl px-4 py-6">
    <header class="flex items-center justify-between mb-6 gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <MenuButton />
        <div class="min-w-0">
        <h1 class="text-2xl font-bold">🛒 Tu Compra</h1>
        <p class="text-sm text-muted truncate">{t('nav.greeting', { name: app.state.profile.username })}</p>
        <button onclick={() => (showDiag = true)}
          title={t('sync.status')}
          class="mt-1 inline-flex items-center gap-1 text-xs rounded-full border px-2 py-1 hover:bg-[var(--bg)] transition"
          style="border-color: var(--border);">
          <span class="size-2 rounded-full"
            style={syncStatus.enabled && syncStatus.connected && syncStatus.authoritative
              ? 'background:#22c55e; box-shadow: 0 0 6px #22c55e;'
              : syncStatus.enabled
                ? 'background:#0ea5e9;'
                : syncStatus.lastError
                  ? 'background:#ef4444;'
                  : 'background:#94a3b8;'}></span>
          {syncStatus.enabled && syncStatus.connected && syncStatus.authoritative
            ? t('sync.on')
            : syncStatus.enabled || syncStatus.inHA
              ? `${t('sync.on')}…`
              : t('sync.local')}
        </button>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button onclick={() => (showDefaults = true)} title={t('nav.defaultStores')}
          class="rounded-full border px-3 py-2 text-sm hover:bg-[var(--bg)] transition"
          style="border-color: var(--border);">🎯</button>
        <button onclick={signOut} title={t('nav.signOut')}
          class="rounded-full border px-3 py-2 text-sm hover:bg-[var(--bg)] transition"
          style="border-color: var(--border);">🚪</button>
        <ThemeToggle />
        <!-- La bandera refleja el catálogo cargado, venga de HA o del navegador:
             fuera de HA también hay cultura activa, y ocultarla ahí hacía parecer
             que la demo no tenía idioma. -->
        <span title={t('nav.catalogHint', { label: LOCALE_LABEL[activeLocale] })}>
          <Flag locale={activeLocale} />
        </span>
      </div>
    </header>
    <StoreGrid />
  </main>

  {#if showDiag}
    <SyncDiag onClose={() => (showDiag = false)} />
  {/if}
  {#if showDefaults}
    <DefaultStores onClose={() => (showDefaults = false)} />
  {/if}
{/if}
