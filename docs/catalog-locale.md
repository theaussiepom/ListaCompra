# Identidad del catálogo compartido

`catalogLocale` pertenece al snapshot del share. `locale` sigue siendo el idioma de interfaz de cada dispositivo. Cambiar el idioma o país de Home Assistant no cambia un catálogo ya fijado. No hay selector de migración entre catálogos; `setLocale` solo cambia la interfaz.

La primera lectura, escritura o acción de voz fija el catálogo si falta. Se inspeccionan IDs de productos y tiendas en listas, preferencias, uso, iconos, tiendas modificadas, tarjetas y restricciones de productos. Una preferencia local existente se acepta si concuerda con esas referencias. El cliente envía esa preferencia como `legacyLocale` únicamente para la inicialización; no puede cambiar una identidad compartida ya fijada.

Si aparecen referencias de varios catálogos, se conserva una preferencia compatible; sin ella se elige el primero en el orden estable de locales existentes. Los objetos referenciados de otros seeds permanecen disponibles sin renombrar ni remapear IDs. Para un share vacío sin evidencia se usa el resolver actual del servidor de HA. Fuera de HA, la inicialización usa el resolver del navegador. Los seis locales y sus reglas no cambian.

Los snapshots incluyen categorías personalizadas, uso, iconos y productos de otros seeds que todavía se utilizan. El catálogo exporta el orden opcional de las tiendas para distinguir valores originales de cambios locales. La ausencia de `customCategories` identifica snapshots anteriores a estos metadatos: se preserva información local que aquellos clientes no enviaban. Los snapshots actuales incluyen el campo incluso vacío, de modo que las eliminaciones explícitas siguen funcionando. El servidor también conserva los campos nuevos omitidos por clientes antiguos.

Los cambios locales se registran y guardan de forma síncrona en `localSync`, que nunca se envía al servidor. Las revisiones pendientes se conservan al recargar y en las copias por share, incluidas colecciones vacías y eliminaciones de listas. Una colección modificada localmente (productos, tiendas, categorías, preferencias, uso o iconos) prevalece completa hasta que el servidor confirma la revisión enviada; las listas se protegen por ID. Los campos sin cambios pendientes aceptan el contenido remoto. La identidad del catálogo remoto siempre manda, independientemente de esas revisiones. La confirmación de un envío no borra cambios posteriores y avanza la marca de contenido confirmado para rechazar lecturas anteriores que lleguen tarde.

El servidor usa la mayor marca temporal entre share y snapshot para rechazar escrituras antiguas y responder a los POST ignorados, también al cargar datos de versiones anteriores. Las altas por voz avanzan ambas marcas de forma monótona, aunque el reloj del servidor esté atrasado.

Un fallo de lectura inicial mantiene activos el sondeo y los eventos de recuperación, pero ningún envío se permite hasta obtener el snapshot autorizado. Los fallos o rechazos de escritura mantienen los cambios pendientes y obligan a leer de nuevo antes del siguiente envío. Parar o reiniciar la sincronización invalida las respuestas del ciclo anterior, incluso dentro del mismo share.

Las tiendas conocidas se recuperan del seed actual por ID; una mera referencia no se guarda como tienda personalizada. Se conservan los cambios explícitos, tarjetas, desactivación y orden; las tiendas sin edición explícita reciben los nombres, iconos y tipos actuales. El servidor normaliza las copias antiguas sin cambios y usa el tipo actual para decidir la ruta.

Los estados anteriores a `localSync` no contienen evidencia suficiente para distinguir todos los metadatos locales nunca enviados de valores remotos ya confirmados. Se conservan las reglas de compatibilidad y referencias antiguas, pero no se infieren revisiones pendientes para todo el catálogo. La protección explícita de cambios y eliminaciones empieza en la primera mutación guardada con esta versión.

Al cambiar de share se espera al envío pendiente y a la lectura del destino. Un fallo conserva el estado actual. Las respuestas tardías del share anterior no se aplican al nuevo. Los estados locales se guardan por share durante la transición para conservar cambios que aún no se hubieran enviado. La acción de borrar datos locales también elimina esas copias.

La migración es aditiva y se repite sin cambiar un catálogo fijado. No reconstruye objetos desconocidos cuyos datos ya se hubieran perdido: mantiene sus referencias, pero solo puede recuperar objetos presentes en el estado o en los registros de seeds existentes. No implementa una migración explícita entre catálogos.

## Validación

- `npm run export:catalog`
- `node --import tsx --test tests/*.test.mjs`
- `pytest tests/ -q`
- `npm run check`
- `npm run build:ha`

Las pruebas comparten fixtures de inferencia TS/Python, ejercitan persistencia local y del servicio con un almacenamiento HA aislado, y ejecutan los módulos Svelte compilados para comprobar el ciclo de sincronización. La validación con varios usuarios en una instalación real de Home Assistant sigue siendo una comprobación de aceptación del despliegue.
