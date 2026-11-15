# Dani Fútbol Tracker

Aplicación independiente del Rivas Fútbol Club C, Primera Juvenil grupo 9, 2026/27. No está afiliada a RFFM.

## Datos y estado

`data/snapshot.json` contiene solamente equipos, calendario, resultados y clasificación agregada. `checked_at` es la última consulta correcta de la fuente. `as_of` es la fecha del último resultado disponible del Rivas. No son equivalentes. `consistency_note` advierte si la tabla y los marcadores disponibles difieren. Nunca se rellena un marcador ausente a partir de la clasificación.

La primera consulta real realizada el 15/11/2026 obtuvo 18 equipos y 306 partidos, con nueve resultados del Rivas y diez partidos jugados en la tabla. Esta diferencia se muestra expresamente. No se presenta como un resultado confirmado de J10.

`data/sync_status.json` registra el último intento. Ante un error se conserva el snapshot y su fecha anterior. Las correcciones de resultados ya confirmados exigen revisión manual.

## Publicación

El contenido de esta carpeta va en la raíz de `main`. Configurar GitHub Pages como **Deploy from a branch → main → / (root)**. URL prevista (solo válida tras verificar el despliegue): https://jorgehidalgomartinez.github.io/dani-tracker/

El workflow `.github/workflows/actualizar-rffm.yml` programa consultas a las **06:23 y 18:23 UTC**. En Madrid, actualmente 07:23 y 19:23; en horario de verano 08:23 y 20:23. GitHub puede retrasar las ejecuciones y desactivar cron en repositorios públicos sin actividad durante 60 días.

El workflow incluye pruebas Python, verificación sintáctica JavaScript y pruebas de interfaz en 1440×1000 y 390×844. Tras guardar una copia pública solicita expresamente una reconstrucción de Pages: los commits con GITHUB_TOKEN por sí solos no generan esa reconstrucción. Revisar que el paso de reconstrucción y el despliegue de Pages terminan correctamente.

**Estado de publicación:** pendiente de autenticación y verificación en GitHub. La existencia del workflow no demuestra que esté habilitado o ejecutado.

## Consulta responsable de RFFM

El recolector consulta únicamente `/robots.txt`, `/competicion/calendario` y `/competicion/clasificaciones`, con dos consultas programadas al día y una pausa entre las páginas. El robots.txt consultado el 15/11/2026 permite esas rutas y prohíbe `/fichaequipo/`, `/fichajugador/` y `/acta-partido/`; no se consultan estas últimas. No se sortean bloqueos, autenticación ni límites de acceso. El código falla si no puede verificar robots.txt.

El permiso técnico de robots.txt no es una licencia de reutilización. No se ha podido acreditar una autorización expresa de reutilización automatizada ni una API contractual de RFFM. Si se necesita esa garantía, solicitar permiso o una exportación autorizada a la Federación/club. Si cambia la web o bloquea la consulta, mantener la última copia y usar una carga manual revisada de datos agregados o una fuente autorizada. No activar rutas alternativas para eludir un bloqueo.

Los identificadores de competición se fijan en `scripts/sync_rffm.py` y deben revisarse para otra temporada. Las páginas usan `__NEXT_DATA__.props.pageProps`; su estructura no es un contrato estable.

## Módulos

Resumen y evolución por jornada; calendario con filtros; clasificación; comparativa estadística de 17 rivales, forma y enfrentamientos cuando hay resultados; simulador Poisson experimental de victoria/empate/derrota con ajuste local. No está calibrado ni incluye bajas, alineaciones o táctica. Es una estimación estadística, no un dato oficial ni una recomendación de apuesta.

El seguimiento personal registra manualmente convocatorias, titularidades, minutos y goles. Muestra cocientes observados, **sin probabilidades futuras de convocatoria o titularidad**.

## Privacidad

No hay datos personales precargados ni historiales de jugadores en los archivos públicos. El nombre de la aplicación no constituye un perfil personal.

Las anotaciones manuales usan `localStorage`. **No hay autenticación ni cifrado**, no se sincronizan entre dispositivos, pueden borrarse al limpiar el navegador y pueden leerlas otras aplicaciones del **mismo origen** `https://jorgehidalgomartinez.github.io`, incluso en otras carpetas. La ruta `/dani-tracker/` no crea aislamiento de seguridad. Cualquier persona con acceso al perfil del navegador puede verlas. Para aislamiento y acceso seguro entre dispositivos se necesita un origen dedicado y un backend autenticado; no está implementado.

El frontend solo solicita JSON público al mismo origen y no envía los registros. Las copias privadas JSON/CSV se descargan en el dispositivo: no subirlas al repositorio ni a Pages. El JSON permite restauración en otro dispositivo. `file://` y HTTPS tienen almacenes diferentes.

## Verificación local

```sh
python -m unittest discover -s tests -v
node --check assets/app.js
pip install playwright==1.62.0
python -m playwright install chromium
python tests/browser_smoke.py
```

`python tests/browser_smoke.py URL` permite repetir el recorrido sobre la web publicada en un contexto efímero con registros sintéticos. Nunca modifica datos del servidor.

Las pruebas del parser usan una fotografía histórica fija y un calendario **sintético**, exclusivamente dentro de tests. Ese calendario no se publica como dato actualizado. El navegador de pruebas necesita permisos de ejecución y sockets locales; si el entorno los restringe, la comprobación debe realizarse en GitHub Actions y en la web publicada antes de dar por finalizada la tarea.
