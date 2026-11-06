# FRONTIER: revisión del inicio, configuración y catálogo de mapas

Revisión de código sobre `frontier/development`, 6 de noviembre de 2026.

## Hallazgos y cambios

- El inicio reutilizaba el feed de partidas públicas de OpenFront: tarjetas rotativas, jugadores, cuenta regresiva y botones Crear/Ranked/Unirse. Ahora el inicio de FRONTIER muestra tarjetas estables del catálogo destacado, Solo, Tutorial y favoritos. No abre el feed de lobbies al iniciar.
- Al elegir una tarjeta se carga el modal individual y se pasa el mapa mediante `open({ map })`. El modal valida que sea un mapa público del catálogo y utiliza el mismo manejador que el selector interno. El jugador puede ajustar dificultad y opciones antes de iniciar; tocar una tarjeta no inicia la simulación.
- Los favoritos comparten `map-favorites` con el selector de mapas existente. Las estrellas actualizan ambos accesos y notifican al inicio; también se escuchan cambios de almacenamiento de otras pestañas.
- El briefing FRONTIER / Campaign configuration pasa a una columna derecha sticky en escritorio. Mapa, dificultad, bots y naciones se actualizan con el estado de la configuración. En pantallas pequeñas se apila debajo de los controles. El mapa aleatorio se identifica como tal.
- El renderer multijugador anterior se conserva como método separado para evitar mezclar la conversión del inicio con una eliminación de sistemas de red de todo el proyecto. No es el renderer predeterminado de FRONTIER.

## Catálogo contrastado

| Fuente / resultado | Cantidad |
| --- | ---: |
| Entradas de `Maps.gen.ts` | 136 |
| Carpetas con `resources/maps/*/manifest.json` | 136 |
| Mapas listados (`!hidden`) | 135 |
| Ocultos | 1: Tutorial |
| Recursos sin registro | 0 |
| Registros sin carpeta de recursos | 0 |

`MapPicker` utiliza `listedMaps` y permite acceder a destacados, todos, vista terrestre y favoritos. Los siete mapas regionales de FRONTIER son accesos rápidos, no el catálogo completo. Tutorial se mantiene fuera del selector general y se abre con su botón propio. No se agregaron mapas inexistentes ni se habilitó Tutorial como partida convencional.

## Alcance y límites

Se revisaron el flujo del menú principal, la carga diferida del modal individual, la selección de mapa, el briefing, los favoritos y la correspondencia entre catálogo y recursos. No equivale a una auditoría exhaustiva de IA, combate, economía, rendimiento o balance, ni a jugar una partida completa en cada mapa.

El repositorio conserva otros sistemas del producto original (cuentas, guardados remotos, anuncios, matchmaking y metadatos que describen multijugador). Convertir todo el producto en una distribución estrictamente sin red requiere una revisión independiente de esos puntos. Estos cambios resuelven el inicio y la selección individual solicitados; no afirman eliminar todas las llamadas de red de la aplicación.

## Validación

Pruebas de tarjetas, favoritos persistentes, apertura con mapa e ignorar mapas inválidos; pruebas existentes de inicio individual y partidas guardadas; consistencia del catálogo y recursos; regresión de las reglas de red y del renderer multijugador conservado. Verificación TypeScript, lint de archivos modificados y compilación Vite. No se hizo una verificación visual en navegador ni una partida completa.
