<script lang="ts">
  // Bandera dibujada en SVG (no emoji): se ve igual en todos los sistemas,
  // incluido Windows, que NO renderiza los emojis de bandera.
  import { DEFAULT_LOCALE, type Locale } from '$lib/i18n/locale';
  let { locale = DEFAULT_LOCALE }: { locale?: Locale } = $props();
</script>

<svg viewBox="0 0 60 42" width="26" height="18" role="img" aria-label={locale}
  class="shadow-sm" style="border-radius: 4px; display: block;">
  <defs><clipPath id="flag-clip"><rect width="60" height="42" rx="5" /></clipPath></defs>
  <g clip-path="url(#flag-clip)">
    {#if locale === 'es'}
      <rect width="60" height="42" fill="#AA151B" />
      <rect y="10.5" width="60" height="21" fill="#F1BF00" />
    {:else if locale === 'fr'}
      <rect width="60" height="42" fill="#FFFFFF" />
      <rect width="20" height="42" fill="#0055A4" />
      <rect x="40" width="20" height="42" fill="#EF4135" />
    {:else if locale === 'de'}
      <rect width="60" height="14" fill="#000000" />
      <rect y="14" width="60" height="14" fill="#DD0000" />
      <rect y="28" width="60" height="14" fill="#FFCE00" />
    {:else if locale === 'en'}
      <rect width="60" height="42" fill="#012169" />
      <path d="M0,0 L60,42 M60,0 L0,42" stroke="#FFFFFF" stroke-width="8" />
      <path d="M0,0 L60,42 M60,0 L0,42" stroke="#C8102E" stroke-width="4" />
      <rect x="25" width="10" height="42" fill="#FFFFFF" />
      <rect y="16" width="60" height="10" fill="#FFFFFF" />
      <rect x="27" width="6" height="42" fill="#C8102E" />
      <rect y="18" width="60" height="6" fill="#C8102E" />
    {:else if locale === 'au'}
      <rect width="60" height="42" fill="#012169" />
      <defs><clipPath id="au-canton"><rect width="60" height="42" /></clipPath></defs>
      <g transform="scale(0.5)" clip-path="url(#au-canton)">
        <path d="M0,0 L60,42 M60,0 L0,42" stroke="#FFFFFF" stroke-width="8" />
        <path d="M0,0 L60,42 M60,0 L0,42" stroke="#C8102E" stroke-width="4" />
        <rect x="25" width="10" height="42" fill="#FFFFFF" />
        <rect y="16" width="60" height="10" fill="#FFFFFF" />
        <rect x="27" width="6" height="42" fill="#C8102E" />
        <rect y="18" width="60" height="6" fill="#C8102E" />
      </g>
      <polygon points="15.00,25.00 16.15,28.62 19.69,27.26 17.57,30.41 20.85,32.34 17.06,32.65 17.60,36.41 15.00,33.64 12.40,36.41 12.94,32.65 9.15,32.34 12.43,30.41 10.31,27.26 13.85,28.62" fill="#FFFFFF" />
      <polygon points="45.00,4.50 45.67,6.61 47.74,5.82 46.50,7.66 48.41,8.78 46.20,8.96 46.52,11.15 45.00,9.54 43.48,11.15 43.80,8.96 41.59,8.78 43.50,7.66 42.26,5.82 44.33,6.61" fill="#FFFFFF" />
      <polygon points="37.00,15.70 37.63,17.69 39.58,16.94 38.42,18.68 40.22,19.73 38.14,19.91 38.43,21.97 37.00,20.45 35.57,21.97 35.86,19.91 33.78,19.73 35.58,18.68 34.42,16.94 36.37,17.69" fill="#FFFFFF" />
      <polygon points="53.00,13.70 53.63,15.69 55.58,14.94 54.42,16.68 56.22,17.73 54.14,17.91 54.43,19.97 53.00,18.45 51.57,19.97 51.86,17.91 49.78,17.73 51.58,16.68 50.42,14.94 52.37,15.69" fill="#FFFFFF" />
      <polygon points="45.00,30.70 45.63,32.69 47.58,31.94 46.42,33.68 48.22,34.73 46.14,34.91 46.43,36.97 45.00,35.45 43.57,36.97 43.86,34.91 41.78,34.73 43.58,33.68 42.42,31.94 44.37,32.69" fill="#FFFFFF" />
      <polygon points="49.00,23.00 49.52,24.29 50.90,24.38 49.84,25.27 50.18,26.62 49.00,25.88 47.82,26.62 48.16,25.27 47.10,24.38 48.48,24.29" fill="#FFFFFF" />
    {:else if locale === 'us'}
      {#each Array.from({ length: 13 }) as _, i}
        <rect y={(i * 42) / 13} width="60" height={42 / 13} fill={i % 2 === 0 ? '#B22234' : '#FFFFFF'} />
      {/each}
      <rect width="27" height="22.6" fill="#3C3B6E" />
      {#each [4, 10, 16, 22] as cx}
        {#each [4, 10, 16] as cy}
          <circle {cx} {cy} r="1.1" fill="#FFFFFF" />
        {/each}
      {/each}
    {:else if locale === 'br'}
      <rect width="60" height="42" fill="#009C3B" />
      <polygon points="30,4 55,21 30,38 5,21" fill="#FFDF00" />
      <circle cx="30" cy="21" r="8.5" fill="#002776" />
    {/if}
  </g>
</svg>
