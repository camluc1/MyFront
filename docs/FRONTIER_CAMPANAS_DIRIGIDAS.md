# Campañas terrestres orientadas a objetivos

## Problema y cambio

Un objetivo de captura identificaba una instalación o yacimiento concreto, pero la ofensiva solo recibía el país propietario. Ahora las campañas terrestres de las naciones en singleplayer transmiten también la casilla elegida. La cola de conquista suma una preferencia suave por proximidad (0,25 por casilla de distancia Manhattan); conserva terreno, antigüedad de la cola, variación determinista y las reglas originales de combate. No es un planificador de rutas perfecto ni evita automáticamente defensas.

Después de lanzar ataques terrestres de campaña se registra la mejor distancia del borde propio al objetivo. Tres lanzamientos sin al menos tres casillas de mejora durante 90 segundos permiten reconsiderar el objetivo y bloquean esa misma opción durante 60 segundos. Militaristas e imperialistas esperan 120 segundos. La distancia usa el mejor avance histórico de esa campaña: perder y recuperar el mismo terreno no renueva la paciencia. Esperar tropas sin lanzar ataques no cuenta como insistencia fallida. El contador no empieza mientras una flota está viajando.

Se conservan la selección entre opciones de valor similar, las doctrinas, las reservas, las prioridades de defensa, las rutas y mecánicas navales, la economía y la valoración de recursos a nivel 1. Los ataques ya desplegados no se cancelan por reconsiderar un objetivo. Siguen vigentes las causas previas de invalidez y el vencimiento general de los planes; este cambio no pretende resolver todos los cambios rápidos de intención.

El objetivo direccional del ataque se guarda en snapshots versión 2; los ataques de versiones anteriores migran con objetivo nulo. La memoria de progreso del plan es opcional para aceptar partidas guardadas anteriores. Las órdenes normales de jugadores y tribus no reciben esta preferencia.

## Continuidad de conquista: preferencia corregida

Capturar una instalación no debe forzar la consolidación ni poner fin a la guerra. La instalación es un objetivo táctico para debilitar al rival, especialmente útil cuando las fuerzas están parejas; eliminar al país sigue siendo una posibilidad que decide la situación militar.

Al capturar la casilla elegida se conserva al mismo rival como objetivo y se elimina la casilla ya completada y su memoria de progreso. No se reinicia el plazo general de la campaña, no se reduce la ofensiva por haber logrado esa captura y no se impone una cadena de ciudades o instalaciones. Las reglas existentes de reservas, amenazas, acceso, alianzas y reevaluación siguen aplicando. No se ha revertido toda la IA a una versión de OpenFront: esta corrección restaura la continuidad ofensiva en ese aspecto concreto.

Una amenaza urgente todavía puede exigir defenderse, incluso en el mismo momento de una captura. El rival muerto o convertido en aliado deja de ser un objetivo válido. Los ataques en curso no se detienen al capturar el premio.

Verificación de esta corrección: 79 pruebas distintas aprobadas entre objetivos, ataques de IA y snapshots de naciones (77 iniciales y dos casos nuevos adicionales). Incluye continuación del ataque al mismo enemigo tras la captura, defensa frente a una amenaza simultánea y eliminación del rival. Typecheck completo y lint aprobados. Las dos simulaciones de diez minutos con las mismas semillas también aprobaron: hubo 95 capturas de objetivo en cada una; 92 y 90 conservaron inmediatamente un objetivo ofensivo. Las otras ocho transiciones pasaron por la evaluación normal (defensa u otro objetivo), no por una pausa obligatoria tras capturar. Cero ataques a aliados. Estas simulaciones no sustituyen la evaluación humana del balance.

## Verificación histórica de la primera implementación

- 172 pruebas aprobadas y una omitida de generación de fixtures, en ocho archivos: ataques, escenarios y lógica de combate, comportamiento de IA, objetivos, snapshots básicos, partidas guardadas históricas y naciones.
- Pruebas nuevas: avance hacia la casilla elegida con igual ejército e igual cantidad de terreno conquistado; reservas; espera sin ataques; reconsideración y cooldown; progreso real frente a reconquista repetida; paciencia por doctrina; continuación determinista al guardar/cargar.
- Typecheck completo y lint de los archivos modificados aprobados.
- Dos simulaciones de diez minutos, World, Hard, 72 naciones, 400 tribus, dos minutos de paz, sin humanos ni recursos infinitos. Semillas `review-infrastructure-01` y `review-infrastructure-02`. Base anterior: `bc027521aee7eb0b45bdaa15247b959d3535626b`.

| Medición                                      | Semilla 01 antes | Semilla 01 después | Semilla 02 antes | Semilla 02 después |
| --------------------------------------------- | ---------------: | -----------------: | ---------------: | -----------------: |
| Captura del objetivo seguida de consolidación |               64 |                102 |               68 |                 90 |
| Cambio captura → captura antes de un minuto   |               76 |                 50 |               57 |                 43 |
| Ataques a aliados                             |                0 |                  0 |                0 |                  0 |

Estos resultados pertenecen a la primera implementación, antes de quitar la consolidación automática. No describen el comportamiento de la revisión de continuidad de conquista. Son observaciones de dos trayectorias completas que divergen a partir del cambio, no una prueba estadística de mejor balance o diversión. La prueba controlada de avance permite atribuir la dirección de la ofensiva al cambio; los resultados agregados de partida no aíslan todos sus efectos. Falta evaluación humana de la sensación de juego.

## Comparación económica descriptiva (sin rebalancear)

Porcentaje del ingreso acumulado de los supervivientes al minuto diez; extracción se descuenta de trabajo para evitar doble conteo.

| Fuente                   | Semilla 01 antes | Semilla 01 después | Semilla 02 antes | Semilla 02 después |
| ------------------------ | ---------------: | -----------------: | ---------------: | -----------------: |
| Comercio marítimo        |           55,1 % |             48,0 % |           53,3 % |             49,0 % |
| Agricultura y extracción |           21,9 % |             24,0 % |           23,6 % |             22,8 % |

El comercio sigue siendo la principal fuente en estas muestras. Esto no compara rentabilidad por inversión ni demuestra inviabilidad de naciones interiores: hay sesgo de supervivencia, geografía y conquistas. No justifica cambiar puertos, barcos ni rutas. El audit ahora registra ingresos por país y minuto y el objetivo anterior para permitir comparaciones posteriores sin confundir finalización, renovación y cambio de plan.

## Reproducir las simulaciones

```bash
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=review-infrastructure-01,review-infrastructure-02 OBJECTIVE_AUDIT_MINUTES=10 OBJECTIVE_AUDIT_BOTS=400 OBJECTIVE_AUDIT_PEACE_MINUTES=2 OBJECTIVE_AUDIT_DIFFICULTY=Hard OBJECTIVE_AUDIT_OUTPUT=/tmp/frontier-campaign-review.json npx vitest run tests/NationObjectiveSimulation.test.ts
```
