# Mejoras de análisis de partida y oportunidades estratégicas

## Implementación

- El historial conserva los ingresos por fuente en cada muestra de diez segundos, para todos los países registrados. El panel compara los países seleccionados y muestra cantidades y porcentajes. La extracción se resta del agregado de trabajo antes de presentarla por separado. Las muestras antiguas sin desglose se identifican como no disponibles.
- La clasificación incluye todos los países, supervivientes por territorio y eliminados por orden inverso de eliminación. Muestra puesto/total, minuto y autor cuando hubo un evento de conquista registrado. Otros finales usan la primera muestra sin territorio, marcada como aproximada. Los supervivientes tienen posiciones provisionales: el orden no significa que todos hayan sido eliminados.
- El gráfico tiene colores estables por identidad, rejilla, zoom temporal con rueda y botones. Las mismas vistas sirven durante y después de la partida.
- El mínimo de cámara usa la menor relación entre viewport y mapa: al alejar al máximo, entra todo el mapa sin recortar ni deformar. Los ejes que caben quedan centrados; los ejes ampliados conservan límites de desplazamiento. La vista general se reajusta al cambiar de pantalla u orientación. El espacio exterior muestra un fondo azul oscuro con degradado y cuadrícula cartográfica estáticos en el mismo pase del terreno, sin texturas ni draw calls adicionales. El shader sí procesa los píxeles de esos márgenes; no se promete costo cero ni FPS idénticos sin medir en el dispositivo del jugador.
- En singleplayer las donaciones militares registran el impacto real sobre las tropas previas del receptor. Una ayuda que duplica su ejército puede aplazar una decisión de traición con hasta 20% de probabilidad por evaluación; una ayuda del 3% aporta hasta 0,6%. La influencia desaparece en tres minutos de simulación. Se conserva solo la mayor ayuda restante por donante: las donaciones diminutas no suman protección ni renuevan una ayuda importante. No hay inmunidad permanente. Las decisiones militares y doctrinas existentes se conservan.

## Reporte de variedad estratégica

Este diagnóstico procede de lectura del código y de las auditorías existentes; no constituye una prueba humana de diversión.

1. **Economía y objetivos de conquista no siempre comunican su valor al jugador.** NationObjectives valora recursos por retorno de producción y activos de ciudad/fábrica/puerto. La nueva comparación permite investigar qué fuentes realmente sostienen a los rivales. Antes de cambiar rendimientos, medir qué inversiones elige un humano y cuánto tardan en devolver su costo.
2. **Las decisiones territoriales tienen un incentivo persistente.** EngineConfig relaciona territorio y capacidad, costos y velocidad de ataque. Es razonable que expandirse sea central, pero debe medirse si un desarrollo compacto o un acceso naval ofrece ventajas suficientes frente a continuar conquistando. No hay evidencia suficiente para modificar esos incentivos ahora.
3. **Las alternativas navales ya existen, pero su acceso puede llegar tarde.** La IA tiene comprobaciones de rutas y desembarcos. Revisar en partidas humanas el tiempo entre detectar un objetivo marítimo, financiar su acceso y capturarlo; si para entonces deja de ser útil, corregir ese cuello de botella antes de agregar unidades.
4. **Variedad de ganadores no equivale a variedad de estrategias humanas.** La auditoría existente registra ganadores variados. Falta registrar decisiones humanas comparables: posición inicial, primera inversión, primer conflicto, ingreso por fuente, accesos navales y momento de pérdida de competitividad. Comparar partidas del mismo jugador en distintas geografías.
5. **La ayuda puede aportar continuidad a alianzas sin dominar la guerra.** El ajuste es deliberadamente acotado. Medir frecuencia de traiciones y duración de alianzas con y sin ayuda; verificar que no frene globalmente la expansión.

Orden recomendado de investigación: observar decisiones con el nuevo historial; comparar expansión inmediata con desarrollo y salida marítima; identificar inversiones dominantes o inútiles; ajustar únicamente costos, tiempos o información del sistema responsable, con comparación de partidas. No agregar misiones, crisis, reputación global ni una segunda IA.

## Límites de validación

El control automatizado de tipos y la compilación de producción pasan. Pruebas de historial, panel, cámara, donaciones y restauración verifican la integración. Una prueba de NationAllianceBehavior sobre exceso de alianzas falla también con la implementación anterior de ese comportamiento. La revisión humana de legibilidad y jugabilidad sigue siendo necesaria; la compilación no la reemplaza.
