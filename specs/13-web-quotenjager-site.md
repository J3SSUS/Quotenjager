# SPEC 13 — Sitio web estático "Second Half" (repo quotenjager)

> **Status:** Aprobado
> **Depends on:** SPEC 07 (persistencia Supabase), SPEC 12 (acceso de lectura pública)
> **Date:** 2026-09-27
> **Objective:** Portar el HTML/CSS de la plantilla Artifact "Second Half" a un sitio estático
> en el repo `quotenjager`, cableando a Supabase (vía `matches_unified`/`matches`/
> `predictions` con la anon key de SPEC 12) todo lo que hoy tiene dato real, y dejando el
> resto (jornada, variables engineered, apuestas, gráficas de evaluación) con los valores de
> ejemplo actuales de la plantilla hasta que existan sus propios specs.

---

## Por qué este spec existe

La plantilla "Second Half" (Artifact) tiene sus 5 vistas con valores hardcodeados. SPEC 12 ya
resuelve el acceso de lectura pública a Supabase; este spec cablea la UI a esos datos para
todo lo que **ya existe** en el esquema actual, sin esperar a los entregables pendientes
(`matchday`, `match_features`, simulación de apuestas, artefactos estáticos de evaluación —
ver `specs/ideas/second-half-frontend.md`).

**Corrección encontrada al escribir este spec:** el Artifact tiene una inconsistencia — el
texto del nav está en inglés ("Model", "Bets", "Upcoming", "How it works") pero los `href`
apuntan a rutas en español (`#/modelo`, `#/apuestas`, `#/proximos`, `#/como-funciona`). Este
spec corrige eso: las rutas pasan a `/model`, `/bets`, `/upcoming`, `/how-it-works`.

---

## Scope

**In:**

- Repo `quotenjager`: `index.html` + `styles.css` + `app.js` + `supabase-client.js`, portando
  1:1 el HTML/CSS del Artifact "Second Half" (sin framework, sin build step) — layout,
  tipografía, paleta, dark mode y comportamiento responsive ya resueltos en la plantilla,
  incluidas sus media queries mobile.
- `supabase-client.js`: inicializa `@supabase/supabase-js` (vía CDN) con `SUPABASE_URL` y la
  anon key de SPEC 12, y expone funciones de query puntuales (`getUpcomingMatches`,
  `getHalftimeMatches`, `getTrackRecord`, `getModelLog`, `getHeroStats`) — sin ORM ni capa de
  abstracción adicional.
- **Home (`/`)**:
  - "At halftime" — partidos con `matches.status = 'predicted'` (con pick) mostrados con
    marcador 1ra mitad desde `matches_unified` y el pick derivado de `predictions.y_prob`
    (umbral 0.5, ver Decisions). `status in ('live','ht_scraped')` se muestra como "próximo"
    con candado hasta que llegue a `predicted` (decisión confirmada).
  - "Próximos" — `status in ('scheduled','odds_scraped')`, ordenados por `kickoff_utc`
    ascendente, sin agrupar por jornada (se agrega cuando exista `matches.matchday`).
  - "Historial" / track record — `status in ('finished','resolved')`, comparando el pick
    (`y_prob >= 0.5`) contra el outcome real (`home_goals_2ht + away_goals_2ht >= 2` desde
    `matches_unified`). Accuracy acumulada, racha, y hero stats ("N partidos predichos",
    "accuracy acumulado") se calculan sobre este mismo conjunto.
- **Model (`/model`)**:
  - Banner: `model_version`/`bundle_tag` vigente (el de `predicted_at` más reciente por
    partido — hoy resuelve a `dagshub-v1`), accuracy acumulada y racha de los últimos 10
    (mismo cálculo que el track record de Home).
  - Listado de partidos: equipos, marcador, pick, resultado — todo real, igual que el
    historial de Home pero sin límite de "últimos 3".
  - Detalle "ver variables de 1ra mitad" por partido: placeholder de "próximamente" (no
    números inventados) — ver Decisions.
- **Upcoming (`/upcoming`)**: mismo query que la sección de Home, sin el límite de 3 tarjetas
  — el listado completo de `scheduled`/`odds_scraped` ordenado por `kickoff_utc`.
- **Bets (`/bets`)** y **How it works (`/how-it-works`)**: quedan **100% estáticas**, con el
  contenido de ejemplo actual del Artifact sin cablear a Supabase — dependen de entregables
  que no existen (simulación de apuestas, artefactos de evaluación).
- Workflow de GitHub Actions (`deploy-pages.yml`) que publica `quotenjager` a GitHub Pages en
  cada push a `main`.
- Manejo de fecha/hora: `kickoff_utc` se muestra tal cual viene de Supabase (timestamp local
  del scraper, no UTC real — ver SPEC 07 Decisions), sin conversión de zona horaria en JS que
  asumiría incorrectamente que es UTC.

**Out of scope (para specs futuros):**

- Columna `matches.matchday` y agrupación por jornada en `/upcoming`/`/model`.
- Tabla `match_features` y el detalle real de variables *engineered* por partido.
- Toda la simulación de apuestas (`/bets`) con datos reales.
- Artefactos estáticos de evaluación (ROC-AUC, calibración, SHAP) en `/how-it-works`.
- Calibración/threshold real del modelo (se usa 0.5 fijo, ver Decisions).
- Cualquier escritura desde el frontend (todo es `SELECT`, ya cubierto por SPEC 12).
- Analytics, SEO, testing automatizado de UI.

---

## Data model

No se agregan tablas a Supabase (eso es SPEC 12). Lo que se fija acá es la estructura del
repo `quotenjager` y el contrato de las funciones de acceso a datos.

### Estructura del repo

```
quotenjager/
├── index.html          # las 5 rutas (#/, #/model, #/bets, #/upcoming, #/how-it-works),
│                        # mismo router hash-based que ya trae el Artifact, con los href/id
│                        # corregidos a inglés (ver "Por qué este spec existe")
├── styles.css           # CSS portado 1:1 del Artifact
├── config.js             # constantes públicas: SUPABASE_URL, SUPABASE_ANON_KEY,
│                        # PREDICTION_THRESHOLD = 0.5, OU_LINE_2HT = 1.5
├── supabase-client.js    # inicializa el cliente + las funciones de query de abajo
├── app.js                # lee el hash, llama a supabase-client.js, rellena el DOM
└── .github/workflows/deploy-pages.yml
```

### Funciones de `supabase-client.js`

```js
// matches con status in ('scheduled','odds_scraped'), ordenados por kickoff_utc asc.
// Devuelve: [{ match_id, team_home, team_away, kickoff_utc, league_code }]
async function getUpcomingMatches(limit)

// matches con status='predicted': marcador 1ra mitad + pick derivado de y_prob.
// Devuelve: [{ match_id, team_home, team_away, home_goals_1ht, away_goals_1ht,
//              y_prob, pick: 'over'|'under', confidence_pct }]
async function getHalftimeMatches()

// matches con status in ('finished','resolved'): marcador final + pick + acierto.
// Devuelve: [{ match_id, team_home, team_away, home_goals_2ht, away_goals_2ht,
//              total_goals_2ht, y_prob, pick, outcome: 'over'|'under', correct: bool,
//              predicted_at }], ordenado por predicted_at desc.
async function getModelLog(limit)

// Agregación sobre getModelLog(): accuracy acumulada, racha, matches_predicted.
// Devuelve: { accuracy_pct, matches_predicted, last10: [bool, ...], streak_len }
async function getTrackRecord()
```

Todas hacen `select` directo sobre `matches_unified`/`matches`/`predictions` con la anon key
de SPEC 12 — sin backend intermedio, sin caché de servidor. El "más reciente por partido"
(elegir `bundle_tag` cuando hay más de una predicción) se resuelve con `order by predicted_at
desc` + tomar la primera fila por `match_id` en JS (Supabase REST no tiene `DISTINCT ON`
expuesto vía PostgREST sin una vista dedicada, y no amerita crear una para esto).

---

## Implementation plan

1. **Scaffold del repo** (`index.html`, `styles.css`) — copiar el HTML/CSS del Artifact "Second
   Half" tal cual (layout, fuentes, paleta, dark mode, media queries responsive), conservando
   el router hash-based, pero corrigiendo sus `href`/`data-route`/`id="route-..."` internos de
   `#/modelo`, `#/apuestas`, `#/proximos`, `#/como-funciona` a `#/model`, `#/bets`,
   `#/upcoming`, `#/how-it-works`. Sistema queda funcional con datos de ejemplo en este paso
   (equivalente al Artifact actual, con rutas ya corregidas).

2. **`config.js`** — constantes públicas: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (obtenidas de
   SPEC 12), `PREDICTION_THRESHOLD = 0.5`, `OU_LINE_2HT = 1.5`.

3. **`supabase-client.js`** — implementar `getUpcomingMatches`, `getHalftimeMatches`,
   `getModelLog`, `getTrackRecord` (contrato de la sección Data model), usando
   `@supabase/supabase-js` vía CDN (`<script type="module">`, sin bundler).

4. **Cablear Home (`/`)**: reemplazar los bloques hardcodeados de "At halftime" (3 tarjetas),
   "Próximos" (3 tarjetas) y "Historial" (últimas 3 filas + hero stats + racha) por llamadas a
   las funciones de paso 3. Estado de carga simple (placeholder "Cargando…") y estado vacío
   ("No hay partidos en este momento") para cuando una sección no tiene filas.

5. **Cablear Model (`/model`)**: banner con `model_version`/accuracy/racha desde
   `getTrackRecord()`, listado completo desde `getModelLog()` (sin límite de 3). El
   desplegable "ver variables de 1ra mitad" de cada fila muestra el placeholder de
   "próximamente" confirmado (no números inventados).

6. **Cablear Upcoming (`/upcoming`)**: mismo `getUpcomingMatches()` sin límite, reemplazando
   el listado de ejemplo por matchday.

7. **Dejar intactas Bets (`/bets`) y How it works (`/how-it-works`)** — se copian tal cual del
   Artifact, sin tocar su HTML ni agregar llamadas a Supabase.

8. **`.github/workflows/deploy-pages.yml`** — build mínimo (no hay build real, solo copiar los
   archivos estáticos) + `actions/deploy-pages` en cada push a `main`.

9. **Checklist de verificación manual** (no hay suite de tests automatizados — proyecto sin
   backend ni framework de testing de UI):
   - Abrir el sitio publicado y confirmar que Home/Model/Upcoming muestran partidos reales de
     Supabase (no los de ejemplo).
   - Redimensionar a ancho de celular (o DevTools → responsive) y confirmar que ninguna
     sección rompe el layout ni produce scroll horizontal.
   - Confirmar que Bets y How it works siguen mostrando exactamente el contenido de ejemplo
     del Artifact, sin cambios.
   - Provocar un estado sin partidos en alguna sección (ej. fuera de temporada) y confirmar
     que se ve el estado vacío, no una sección rota o en blanco.

---

## Acceptance criteria

- [ ] El sitio publicado en GitHub Pages carga sin errores de consola y sin `401`/`403` al
      consultar Supabase (confirma que usa la anon key y las políticas de SPEC 12
      correctamente).
- [ ] Las rutas del nav son `/model`, `/bets`, `/upcoming`, `/how-it-works` (inglés,
      consistente con el texto visible) — no quedan `href`/`id` en español.
- [ ] La sección "At halftime" de Home muestra únicamente partidos con `status='predicted'`,
      con marcador 1ra mitad y pick reales — ningún dato del Artifact de ejemplo visible.
- [ ] La sección "Próximos" de Home y la página `/upcoming` completa muestran partidos con
      `status in ('scheduled','odds_scraped')` ordenados por `kickoff_utc` ascendente, sin
      encabezados de jornada.
- [ ] El track record de Home y el banner de `/model` muestran accuracy/racha calculados
      sobre partidos `finished`/`resolved` reales, no los porcentajes de ejemplo.
- [ ] `/model` lista partidos reales con marcador, pick y resultado; el desplegable de
      variables muestra el placeholder de "próximamente", nunca números inventados.
- [ ] `/bets` y `/how-it-works` son visualmente idénticas al Artifact original (mismo
      contenido de ejemplo, sin cablear).
- [ ] La página se ve correctamente en un viewport de celular (390px de ancho o similar): sin
      scroll horizontal, texto legible, tarjetas apiladas en una columna donde corresponde.
- [ ] Un partido con `status in ('live','ht_scraped')` aparece en "Próximos" con candado, no
      en "At halftime" sin datos.
- [ ] Si no hay ningún partido en una categoría (ej. temporada terminada), la sección
      correspondiente muestra un estado vacío explícito, no queda en blanco ni rompe el layout.

---

## Decisions

- **Sí:** HTML/CSS/JS plano, sin framework ni build step, portando el Artifact tal cual.
  Decisión del usuario en la conversación previa a este spec: cero curva de aprendizaje para
  alguien sin experiencia en frontend, y el diseño ya está resuelto visualmente.
- **No:** Next.js/React u otro framework. Ninguna ventaja real para 5 páginas de solo lectura,
  y contradice `architecture.md` §6.4 ("static site, no backend").
- **Sí:** corregir las rutas del nav a inglés (`/model`, `/bets`, `/upcoming`,
  `/how-it-works`), consistentes con el texto visible del nav. El Artifact original tenía el
  texto en inglés pero los `href` en español — inconsistencia detectada por el usuario al
  revisar este spec.
- **Sí:** `PREDICTION_THRESHOLD = 0.5` fijo en `config.js`. El bundle publicado no incluye
  threshold calibrado (SPEC 10); 0.5 es lo que ya asume la plantilla. Se reemplaza cuando
  exista un spec de calibración/threshold — queda como constante única, no hardcodeado en
  varios lugares, para que ese cambio futuro sea de una línea.
- **Sí:** el "modelo vigente" se resuelve tomando, por partido, la fila de `predictions` con
  `predicted_at` más reciente — no un `bundle_tag` fijo. Verificado contra los datos reales:
  hoy resuelve a `dagshub-v1` sin necesidad de hardcodearlo, y no requiere mantenimiento
  manual cuando se publique un modelo nuevo.
- **Sí:** partidos en `status in ('live','ht_scraped')` se muestran como "próximos" con
  candado, no como "en vivo sin datos". Decisión confirmada: evita una tarjeta vacía sin
  marcador ni pick en la sección más visible de la Home.
- **Sí:** el detalle "ver variables de 1ra mitad" en `/model` muestra un placeholder de
  "próximamente" en vez de números — decisión confirmada explícitamente para no mezclar datos
  reales del partido (equipos, marcador) con valores inventados en la misma tarjeta.
- **Sí:** `/bets` y `/how-it-works` quedan 100% estáticas, sin ninguna llamada a Supabase.
  Ambas dependen de entregables que no existen todavía (simulación de apuestas, artefactos de
  evaluación) — cablearlas parcialmente sería peor que dejarlas explícitamente de ejemplo.
- **No:** conversión de zona horaria sobre `kickoff_utc` en JS. SPEC 07 documenta que esa
  columna guarda el timestamp local del scraper tal cual, sin conversión real a UTC — tratarlo
  como UTC en el frontend introduciría un corrimiento de horario incorrecto.
- **No:** agrupar `/upcoming` por semana calendario como aproximación a jornada. Decisión
  confirmada: se lista plano por `kickoff_utc` hasta que exista `matches.matchday`, sin una
  aproximación intermedia que después haya que deshacer.
- **No:** tests automatizados de UI (Playwright/Cypress) en este spec. Sin backend propio y sin
  lógica de negocio compleja del lado del cliente, el checklist manual del implementation plan
  cubre el riesgo real a este tamaño de proyecto; se reconsidera si el sitio crece.

---

## Risks

| Riesgo | Mitigación |
|---|---|
| El tier gratuito de Supabase pausa proyectos inactivos fuera de temporada — la web se quedaría sin datos en vivo | Ya documentado como riesgo aceptado en `architecture.md` §7; la web degrada mostrando el último estado conocido (historial/próximos ya cacheados por el navegador) en vez de un error duro. |
| Sin caché ni CDN propio, cada visita dispara varias queries directas a Supabase — un pico de tráfico podría acercarse a límites del tier gratuito | Volumen esperado bajo (sitio de portfolio); se revisa si se vuelve un problema real, no se resuelve preventivamente en este spec. |
| Si Supabase no responde (outage, rate limit), las secciones quedan en estado "Cargando…" indefinidamente | El implementation plan exige también un estado de error explícito ("No se pudo cargar la información"), no solo loading/vacío — a verificar en el checklist manual. |
| `kickoff_utc` no es UTC real (timestamp local del scraper sin zona documentada, SPEC 07) — la hora mostrada podría no coincidir exactamente con la hora real del partido | Riesgo heredado, ya aceptado en SPEC 07; se muestra tal cual sin fabricar una conversión que introduciría un error distinto. |
| Elegir "el más reciente por `predicted_at`" como modelo vigente podría mezclar predicciones de dos bundles si corrieran solapados en el futuro | Hoy no ocurre (solo `dagshub-v1` activo); si en el futuro conviven dos bundles en paralelo, este criterio deja de ser suficiente y hay que revisarlo — no bloqueante ahora. |

---

## What is **not** in this spec

- Columna `matches.matchday` y agrupación por jornada.
- Tabla `match_features` y el detalle real de las variables *engineered* por partido.
- Simulación de apuestas con datos reales (`/bets`).
- Artefactos estáticos de evaluación (ROC-AUC, calibración, SHAP) en `/how-it-works`.
- Calibración/threshold real del modelo.
- Tests automatizados de UI.

Cada uno de estos, cuando se aborde, va en su propio spec.
