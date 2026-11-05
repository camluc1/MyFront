# Campañas terrestres orientadas a objetivos

## Problema y cambio

Un objetivo de captura identificaba una instalación o yacimiento concreto, pero la ofensiva solo recibía el país propietario. Ahora las campañas terrestres de las naciones en singleplayer transmiten también la casilla elegida. La cola de conquista suma una preferencia suave por proximidad (0,25 por casilla de distancia Manhattan); conserva terreno, antigüedad de la cola, variación determinista y las reglas originales de combate. No es un planificador de rutas perfecto ni evita automáticamente defensas.

Después de lanzar ataques terrestres de campaña se registra la mejor distancia del borde propio al objetivo. Tres lanzamientos sin al menos tres casillas de mejora durante 90 segundos permiten reconsiderar el objetivo y bloquean esa misma opción durante 60 segundos. Militaristas e imperialistas esperan 120 segundos. La distancia usa el mejor avance histórico de esa campaña: perder y recuperar el mismo terreno no renueva la paciencia. Esperar tropas sin lanzar ataques no cuenta como insistencia fallida. El contador no empieza mientras una flota está viajando.

Se conservan la selección entre opciones de valor similar, las doctrinas, las reservas, las prioridades de defensa, la consolidación tras capturar, las rutas y mecánicas navales, la economía y la valoración de recursos a nivel 1. Los ataques ya desplegados no se cancelan por reconsiderar un objetivo. Siguen vigentes las causas previas de invalidez y el vencimiento general de los planes; este cambio no pretende resolver todos los cambios rápidos de intención.

El objetivo direccional del ataque se guarda en snapshots versión 2; los ataques de versiones anteriores migran con objetivo nulo. La memoria de progreso del plan es opcional para aceptar partidas guardadas anteriores. Las órdenes normales de jugadores y tribus no reciben esta preferencia.

## Verificación

- 172 pruebas aprobadas y una omitida de generación de fixtures, en ocho archivos: ataques, escenarios y lógica de combate, comportamiento de IA, objetivos, snapshots básicos, partidas guardadas históricas y naciones.
- Pruebas nuevas: avance hacia la casilla elegida con igual ejército e igual cantidad de terreno conquistado; reservas; espera sin ataques; reconsideración y cooldown; progreso real frente a reconquista repetida; paciencia por doctrina; continuación determinista al guardar/cargar.
- Typecheck completo y lint de los archivos modificados aprobados.
- Dos simulaciones de diez minutos, World, Hard, 72 naciones, 400 tribus, dos minutos de paz, sin humanos ni recursos infinitos. Semillas `review-infrastructure-01` y `review-infrastructure-02`. Base anterior: `bc027521aee7eb0b45bdaa15247b959d3535626b`.

| Medición                                      | Semilla 01 antes | Semilla 01 después | Semilla 02 antes | Semilla 02 después |
| --------------------------------------------- | ---------------: | -----------------: | ---------------: | -----------------: |
| Captura del objetivo seguida de consolidación |               64 |                102 |               68 |                 90 |
| Cambio captura → captura antes de un minuto   |               76 |                 50 |               57 |                 43 |
| Ataques a aliados                             |                0 |                  0 |                0 |                  0 |

Estas son observaciones de dos trayectorias completas que divergen a partir del cambio, no una prueba estadística de mejor balance o diversión. La prueba controlada de avance permite atribuir la dirección de la ofensiva al cambio; los resultados agregados de partida no aíslan todos sus efectos. Falta evaluación humana de la sensación de juego.

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
