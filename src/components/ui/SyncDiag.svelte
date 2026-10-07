<script lang="ts">
  import { t } from '$lib/i18n/ui.svelte';
  // Panel de sincronización con Home Assistant.
  //  - Muestra la identidad (usuario/person. de HA) y el estado de la sync.
  //  - Permite cambiar entre listas (shares) a las que perteneces.
  //  - Si eres admin de HA: crear / editar miembros / borrar listas compartidas.
  //
  // Sin login ni passphrase: la identidad la aporta HA. Fuera de HA (dev local)
  // el panel indica "modo local".

  import {
    syncStatus, switchShare, refreshShares,
    listUsers, createShare, updateShare, deleteShare,
    type HAUser,
  } from '$lib/sync.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let error = $state('');
  let working = $state(false);

  // Formulario de creación / edición de share (solo admin).
  let managing = $state(false);
  let users = $state<HAUser[]>([]);
  let editingId = $state<string | null>(null); // null = creando
  let shareName = $state('');
  let selectedMembers = $state<Set<string>>(new Set());

  const ago = $derived(
    syncStatus.lastSyncAt
      ? `${Math.round((Date.now() - syncStatus.lastSyncAt) / 1000)}s`
      : '—',
  );

  const activeShare = $derived(
    syncStatus.shares.find((s) => s.id === syncStatus.activeShareId),
  );

  async function openManager(shareId: string | null) {
    error = '';
    working = true;
    try {
      users = await listUsers();
      editingId = shareId;
      if (shareId) {
        const s = syncStatus.shares.find((x) => x.id === shareId);
        shareName = s?.name ?? '';
        selectedMembers = new Set(s?.members ?? []);
      } else {
        shareName = '';
        selectedMembers = new Set();
      }
      managing = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }

  function toggleMember(userId: string) {
    const next = new Set(selectedMembers);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    selectedMembers = next;
  }

  async function saveShare() {
    error = '';
    working = true;
    try {
      const members = [...selectedMembers];
      if (editingId) {
        await updateShare(editingId, { name: shareName.trim(), members });
      } else {
        await createShare(shareName.trim() || t('sync.defaultShareName'), members);
      }
      managing = false;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }

  async function removeShare(id: string) {
    if (!confirm(t('sync.confirmRemoveShare'))) return;
    working = true;
    try {
      await deleteShare(id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 grid place-items-center p-4"
  style="background: rgba(0,0,0,.5)" onclick={onClose} role="presentation">
  <div class="card-elev w-full max-w-md p-6 space-y-4 pop-in max-h-[90vh] overflow-y-auto [scrollbar-gutter:stable]"
    onclick={(e) => e.stopPropagation()} role="presentation">

    <header class="flex items-start justify-between">
      <h2 class="text-lg font-bold">🏠 {t('sync.title')}</h2>
      <button onclick={onClose} class="text-2xl leading-none text-muted hover:text-current">×</button>
    </header>

    {#if !syncStatus.inHA}
      <!-- Fuera de HA: modo local -->
      <div class="rounded-xl bg-[var(--bg)] p-3 text-sm space-y-1.5"
        style="border: 1px solid var(--border);">
        <p>📴 <strong>{t('sync.localMode')}</strong></p>
        <p class="text-muted">{t('sync.notInHA')}</p>
      </div>

    {:else if managing}
      <!-- Gestor de listas compartidas (admin) -->
      <div class="space-y-3">
        <p class="text-sm font-semibold">
          {editingId ? t('sync.editShare') : t('sync.newShare')}
        </p>
        <input bind:value={shareName} placeholder={t('sync.sharePlaceholder')}
          class="w-full rounded-xl border px-4 py-2.5 bg-transparent"
          style="border-color: var(--border);" />

        <p class="text-xs font-semibold uppercase tracking-wider text-muted">{t('sync.members')}</p>
        <ul class="space-y-1 max-h-52 overflow-y-auto">
          {#each users as u (u.user_id)}
            <li>
              <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bg)] cursor-pointer">
                <input type="checkbox" checked={selectedMembers.has(u.user_id)}
                  onchange={() => toggleMember(u.user_id)} />
                {#if u.person?.picture}
                  <img src={u.person.picture} alt="" class="size-6 rounded-full object-cover" />
                {:else}
                  <span class="size-6 rounded-full grid place-items-center text-xs"
                    style="background: var(--accent); color: white;">
                    {(u.person?.name ?? u.name).slice(0, 1).toUpperCase()}
                  </span>
                {/if}
                <span class="text-sm">{u.person?.name ?? u.name}</span>
                {#if u.is_admin}<span class="text-[10px] text-muted ml-auto">{t('sync.admin')}</span>{/if}
              </label>
            </li>
          {/each}
        </ul>

        {#if error}<p class="text-sm text-red-500">{error}</p>{/if}

        <div class="flex gap-2">
          <button onclick={saveShare} disabled={working}
            class="flex-1 rounded-xl py-2.5 font-semibold text-white disabled:opacity-50 transition"
            style="background: var(--accent);">
            {working ? '…' : t('product.save')}
          </button>
          <button onclick={() => (managing = false)}
            class="rounded-xl border px-4 py-2.5 font-medium hover:bg-[var(--bg)] transition"
            style="border-color: var(--border);">{t('common.cancel')}</button>
        </div>
      </div>

    {:else}
      <!-- Estado + selección de lista -->
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted">{t('sync.user')}</dt>
        <dd class="font-medium truncate flex items-center gap-2">
          {#if syncStatus.user?.person?.picture}
            <img src={syncStatus.user.person.picture} alt="" class="size-6 rounded-full object-cover" />
          {/if}
          {syncStatus.user?.person?.name ?? syncStatus.user?.name ?? '—'}
          {#if syncStatus.isAdmin}<span class="text-[10px] text-muted">{t('sync.admin')}</span>{/if}
        </dd>

        <dt class="text-muted">{t('sync.state')}</dt>
        <dd>
          {#if syncStatus.enabled && syncStatus.connected && syncStatus.authoritative}
            <span style="color:#22c55e">🟢 {t('sync.synced')}</span>
          {:else if syncStatus.enabled}
            <span style="color:#0ea5e9">🟡 {t('sync.connecting')}</span>
          {:else}
            <span style="color:#f59e0b">⚠️ {t('sync.inactive')}</span>
          {/if}
        </dd>

        <dt class="text-muted">{t('sync.activeList')}</dt>
        <dd class="font-medium">{activeShare?.name ?? '—'}</dd>

        <dt class="text-muted">{t('sync.lastSync')}</dt>
        <dd>{ago === '—' ? '—' : t('sync.ago', { t: ago })}</dd>

        {#if syncStatus.lastError}
          <dt class="text-muted">{t('sync.warning')}</dt>
          <dd class="text-red-500 text-xs break-all">{syncStatus.lastError}</dd>
        {/if}
      </dl>

      <!-- Selector de listas -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-muted">{t('sync.yourLists')}</span>
          <button onclick={() => refreshShares()} class="text-xs text-muted hover:underline">↻</button>
        </div>
        <ul class="space-y-1">
          {#each syncStatus.shares as s (s.id)}
            <li class="flex items-center gap-2 rounded-lg border px-3 py-2"
              style="border-color: var(--border);">
              <button onclick={() => switchShare(s.id)}
                disabled={s.id === syncStatus.activeShareId}
                class="flex-1 text-left text-sm truncate hover:underline disabled:no-underline disabled:font-semibold">
                {s.id === syncStatus.activeShareId ? '➤ ' : ''}{s.name}
                {#if s.members.length > 1}
                  <span class="text-xs text-muted">· {t('sync.people', { n: s.members.length })}</span>
                {/if}
              </button>
              {#if syncStatus.isAdmin && !s.id.startsWith('personal:')}
                <button onclick={() => openManager(s.id)}
                  class="text-muted hover:text-current text-sm" title={t('product.edit')}>✏️</button>
                <button onclick={() => removeShare(s.id)}
                  class="text-muted hover:text-red-500 text-sm" title={t('store.delete')}>🗑️</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>

      {#if syncStatus.isAdmin}
        <button onclick={() => openManager(null)} disabled={working}
          class="w-full rounded-xl py-2.5 font-semibold text-white disabled:opacity-50 transition"
          style="background: var(--accent);">
          {working ? '…' : t('sync.newShareBtn')}
        </button>
      {:else}
        <p class="text-xs text-muted">
          {t('sync.sharesAdminNote')}
        </p>
      {/if}

      {#if error}<p class="text-sm text-red-500">{error}</p>{/if}

      <details class="rounded-xl border p-3" style="border-color: var(--border);">
        <summary class="cursor-pointer text-sm font-medium">{t('sync.eventLog', { n: syncStatus.log.length })}</summary>
        <pre class="mt-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-tight"
          style="color: var(--fg-muted)">{syncStatus.log.join('\n') || t('sync.noEvents')}</pre>
      </details>
    {/if}
  </div>
</div>
