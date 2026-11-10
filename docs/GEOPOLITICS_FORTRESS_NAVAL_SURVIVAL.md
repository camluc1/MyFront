# Geopolítica — fortificaciones, supervivencia diplomática y revisión naval

## Alcance y arquitectura

Implementación en `frontier/development`; todos los sistemas nuevos tienen guardas de Geopolítica (Singleplayer). Classic conserva sus reglas. La conquista terrestre utiliza el mismo algoritmo y prioridades de siempre, para humano y nación. No se agrega una segunda IA de conquista ni barcos escolta.

### Castillo: decisiones, economía y consecuencias

- El jugador selecciona su castillo sobre el mapa o mediante su marcador contextual. La ficha reúne estado, alcance, costo, tiempo restante y ayuda.
- Tres estados son **Normal**, **Resistencia extrema** y **Recuperación**. Recuperación no es una compra: sucede automáticamente después de los 60 segundos activos.
- Resistencia extrema cuesta 150.000 de oro; dura 600 ticks y requiere 1.200 ticks adicionales para volver a estar disponible (10 ticks/segundo). La defensa normal sigue disponible incluso durante la recuperación.
- Solo se aplica a casillas que ya están en el rango del castillo, sobre las reglas normales de combate: +35% al desgaste del atacante y +25% al costo temporal de conquista, **sin alterar la prioridad de casillas**.
- Los castillos solapados no multiplican estas bonificaciones entre sí. Una captura o transferencia apaga la bonificación anterior; evita heredar mejoras temporales gratis.
- `CastleDefenseExecution` valida dueño, tipo, construcción, eliminación, disponibilidad de oro, cooldown y modo. Los humanos envían `castle_defense` por `Transport`; las naciones utilizan exactamente `tryActivateCastleDefense` y pagan el mismo costo.
- La IA solo activa si un ataque real amenaza una fortaleza y cumple la reserva económica. Una nación tiene una única decisión de fortificar por ciclo de evaluación.
- El estado temporal vive en `UnitImpl`, se guarda en snapshots con migración desde la versión anterior y viaja por actualizaciones compactas reutilizando ranuras numéricas exclusivas del tipo SAM sin aumentar el stride de red.
- El HUD actualiza los contadores desde `game.ticks()`, no con temporizadores locales; ofrece indicadores sobre el edificio, animación de pulso con reducción de movimiento y ficha táctil.
- Los precios progresivos de nuevos castillos ($500.000, $1.000.000, $1.500.000, etc.) y la Cúpula de Hierro ($8.000.000) quedan sin modificaciones.

### Diplomacia de supervivencia

- Reutiliza `Geopolitics.initiate`, el destinatario que verdaderamente está atacando y el mecanismo existente de ofertas/contraofertas/compensación/paz.
- `survivalPeaceGold` escala la compensación según presión militar y diferencia de fuerza; el 100% solo es posible con presión extrema y riesgo de eliminación territorial, no en una escaramuza.
- La aceptación permanece voluntaria y se ejecuta por la lógica diplomática existente. No se toca la selección de casillas ni la física de conquista.
- La ficha de oferta explica la situación de supervivencia; persisten controles antispam, límites por pareja y guardado de la oferta.

### Naval y presentación

- `VesselMotion` mantiene su ruta marítima y velocidad simulada; evita saltos angulares al asignar por primera vez una ruta desde un rumbo anterior.
- El icono de destino `MoveIndicatorPass` converge con suavizado y una pequeña señal central; ambos desaparecen tras la confirmación. Se libera el buffer GPU al desmontar.
- La ficha de estado naval reutiliza `UnitSelectionEvent` para mostrar flota/buque, integridad, destino, experiencia y combate, sin duplicar controles de desplazamiento ni añadir nuevas unidades.

## Validación

El quality gate de desarrollo ejecuta: TypeScript integral; compilación Vite; validación GLSL Ultra; pruebas de castillo, economía, cable compacto, diplomacia, HUD y trayectoria naval. Las pruebas de snapshots verifican recuperación exacta. La revisión real de interfaz en navegador y partidas largas sigue siendo obligatoria antes de publicar; compilar no demuestra excelencia visual ni balance definitivo.

## Restricciones

El factor defensivo (1,35 y 1,25) es un valor de balance inicial. Después de observar partidas humanas, medir cuánto tarda un ataque comparable con y sin fortificación, oro gastado, uso por IA y si desincentiva guerras. No tocar Classic ni el algoritmo de conquista para equilibrar una decisión del castillo.
