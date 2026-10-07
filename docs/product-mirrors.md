# Productos que comparten concepto

`Product.mirrorOf?: Product['id']` identifica otra ubicación del mismo concepto. El destino debe existir en el mismo catálogo y ser canónico, sin `mirrorOf`. Se permiten varios mirrors por destino, con nombres, categorías, tiendas, iconos y unidades distintos. No se permiten referencias a sí mismo, destinos ausentes, cadenas, ciclos ni IDs duplicados.

`exportProducts` valida la colección completa antes de proyectar los campos del backend. Conserva `mirrorOf` y no copia alias entre productos ni exporta metadatos de investigación. El helper `mk` acepta el ID completo del destino como séptimo argumento opcional, después de los alias.

El exportador conserva la ruta histórica para los seis seeds existentes sin mirrors: el español ya contiene ocho IDs repetidos. No se renombran IDs persistidos en este cambio. Cualquier catálogo que introduzca `mirrorOf` pasa obligatoriamente por la validación estricta. Resolver esos duplicados antiguos requiere una decisión de compatibilidad separada; no sirven como destinos válidos de mirrors en ejecución.

Si la colección consultada contiene IDs repetidos, el matcher no elige automáticamente esas filas. En el seed español sin normalizar, «Vino de málaga» y «Vino dulce málaga» antes elegían dos filas diferentes del ID `vino-malaga`; ahora no resuelven automáticamente. Las sugerencias explícitas siguen disponibles. Los otros siete IDs repetidos ya empataban por nombre.

Las sugerencias siguen clasificando cada fila por separado. Un clic conserva exactamente la fila seleccionada, incluida su categoría y unidad. Para acciones automáticas, primero se conserva la prioridad de nombre exacto sobre alias exacto y después se comprueba que las mejores filas representan un único destino canónico válido. Se devuelve ese producto canónico, aunque tenga otro nombre. Conceptos independientes con el mismo nombre o alias siguen siendo ambiguos.

Un prefijo automático debe seguir siendo un prefijo de palabras completas del nombre, tener al menos tres caracteres y carecer de otro concepto con puntuación de tres o más. Un mirror del mismo concepto no crea competencia; una referencia inválida relevante sí impide resolver. Las coincidencias débiles por subsecuencia no invalidan un prefijo seguro. Los alias solo permiten resolución automática exacta.

El resolver necesita la colección completa para validar el destino. En Python, `resolve` pasa esa colección a `select_automatic_match`; una llamada directa puede facilitarla como tercer argumento. Si una vista filtrada solo contiene el mirror y no su destino, la resolución automática devuelve `null`/`None`. Las sugerencias y su selección explícita siguen disponibles; nunca se inserta automáticamente un producto oculto de otro tipo de tienda.

El enrutado automático usa la categoría y restricciones del producto canónico. La existencia de un mirror no constituye una preferencia por su tienda. No se añaden reglas de voz, locales ni datos de ningún país.
