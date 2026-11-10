# Modo funcional — integración y criterios de jugabilidad

Base de auditoría: `frontier/development`. Esta hoja de control describe **qué se tiene que observar en una partida real**; la existencia de código y pruebas unitarias no equivale a aceptación de jugabilidad.

## Reglas innegociables

- `geopoliticsFunctional` solo tiene efecto con `geopolitics=true` y una partida `Singleplayer`; debe comenzar apagado.
- Clásico y Geopolítica normal deben conservar el comportamiento original, incluido el guardado.
- La IA existente no debe utilizar ninguna nueva unidad que todavía no tenga comportamiento e integración validados. La especificación inicial solo le da la capital.
- No se considera funcional una estructura o unidad que solo pueda crearse desde `setup()` o mediante dinero infinito: debe ser accesible desde los controles reales y aplicar el costo de oro.
- Toda mecánica debe conservar el estado después de guardar/restaurar, incluidos órdenes, mejoras y retiradas.
- No modificar los IDs empaquetados existentes, el servidor ni el protocolo de multiplayer.

## Estado de auditoría del 10 de noviembre de 2026

| Etapa | Código en rama | Pruebas identificadas | Aceptación manual |
| --- | --- | --- | --- |
| 0: flag + Palacio | Sí | `FunctionalGeopoliticsCapital.test.ts` | Pendiente |
| 1: Astillero + taller | Sí | `FunctionalShipyard.test.ts`, `FunctionalGeopoliticsIntegration.test.ts` | Pendiente |
| 2: Bismarck | Sí | `FunctionalBismarck.test.ts`, `FunctionalGeopoliticsIntegration.test.ts`, `client/NavalStatusPanel.test.ts` | Pendiente |
| 3: Tsar Bomba | No | Ninguna exclusiva | No disponible |
| 4: aeródromo + tres aviones | No | Ninguna exclusiva | No disponible |

Las pruebas añadidas para integración naval están sujetas al resultado de GitHub Actions; no dar por aprobada ninguna verificación que siga pendiente o haya fallado.

## Circuitos funcionales obligatorios

### 0. Capital

1. Iniciar una partida funcional con humano y varias naciones.
2. Confirmar una capital por país en el spawn definitivo y que sea distinguible del castillo.
3. Confirmar que no aparezca como construcción, no pueda venderse ni transferirse mediante negociación exacta.
4. Conquistar su tile con tropas normales; el conquistador obtiene el territorio restante; el eliminado sale de tratados y coaliciones; la cuenta regresiva se reinicia.
5. Comprobar que un bombardeo o explosión no la elimine directamente.
6. Guardar antes y después de una conquista, restaurar y continuar.

### 1. Astillero + barco taller

1. Construir astillero en litoral válido, pagando oro y esperando construcción.
2. Abrir la ficha mediante clic/táctil y comprar por separado las cuatro líneas (mercantes, transportes, casco, daño), hasta nivel 3.
3. Verificar diferencias medibles en velocidad mercante, capacidad de transporte, salud y daño, para barcos previos y nuevos; comprobar que las mejoras no se acumulan entre varios astilleros y que no mejoran al taller.
4. Verificar marcas visuales y controles en zoom medio y bajo.
5. Comprar un taller; comprobar su 5× integridad, tamaño y selección, que repara hasta tres barcos cercanos y que no se regenera en mar abierto.
6. Bajar su salud del 50%; comprobar regreso a puerto accesible, reparación y retorno a su puesto. Si no hay puerto, no debe quedar bloqueado.

### 2. Bismarck

1. Comprar desde el menú naval pagando 10.000.000 y ejecutar Shift+B.
2. Seleccionarlo individualmente y en grupo, moverlo por agua, mostrar destino, salud y retirada en el HUD.
3. Comprar mejoras en astillero y observar que se aplican realmente al Bismarck.
4. Simular 1 vs. 2 y 1 vs. 3 warships; comprobar el balance exigido.
5. Provocar menos de 40% de integridad; verificar retirada a puerto o taller, reparación y recuperación de órdenes sin bucles.
6. Guardar con el barco en movimiento, en combate y retirándose; restaurar.

### 3. Tsar Bomba (no implementada)

1. Aparecer solo con flag, costar 20.000.000 y poder dispararse desde el flujo nuclear.
2. Debe usar radio x2 del hidrógeno (con protección del rendimiento), sin cambiar el radio de armas clásicas.
3. Debe ser interceptable por SAM y cubierta por IronDome con prioridad/consistencia explícitas.
4. Aparecer en lista de Nukes, estadísticas, efectos, sonidos, alertas y guardados.
5. Pruebas deterministas de detonación, interceptación, defensa, snapshot y mapa grande.

### 4. Aeródromo, aviones y antiaérea (no implementada)

1. Construir aeródromo y comprar avión de ataque a tierra, bombardero y caza con oro real.
2. Poder seleccionar, ordenar objetivo y regreso; diferenciar modelos y equipos a todos los zooms.
3. Ataque: pérdida de población calibrada al HUD sin cambiar dueño de tiles; bombardero: entre cuatro y seis impactos pequeños alineados; caza: solo combate aire-aire.
4. Medir combustible en todos; al agotarse perder el avión; aterrizar en aeródromo o taller propio, máximo cuatro aeronaves por taller y recarga correcta.
5. SAM puede interceptar aeronaves enemigas pero conserva prioridad ante amenazas nucleares; cúpula solo protege las bombas definidas.
6. Rendimiento: visualización instanciada, sin draw call extra por avión; sombras, estelas, animación y daño sin bloqueo de render.
7. Guardar con aviones volando, repostando y regresando; restaurar sin duplicados ni combustible alterado.

## Puerta de calidad para cada entrega

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build-dev`.
- `npm test` y pruebas de simulación/snapshot en los cuatro niveles de dificultad.
- Comparación con el flag apagado, con Geopolítica normal y con Clásico.
- Test de interacción en móvil y escritorio; perfil de rendimiento en mapa grande.
- Sesión de juego manual desde el menú, con economía no infinita, hasta la victoria.

**Criterio de salida:** No declarar las cinco fases `jugables` hasta que las cinco existan, superen los tests pertinentes y una partida completa sea verificada manualmente.
