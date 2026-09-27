# SPEC 12 — Acceso de lectura pública a Supabase para la web (quotenjager)

> **Status:** Implementado
> **Depends on:** SPEC 07 (persistencia Supabase)
> **Date:** 2026-09-27
> **Objective:** Habilitar políticas RLS de solo lectura (`SELECT`) para el rol `anon` en las
> 10 tablas y la vista existentes de Supabase, y documentar el contrato de queries que el
> repo `quotenjager` va a usar contra la anon key — sin exponer ninguna capacidad de
> escritura al público.
> **Ejecución:** Claude Code aplica la migración directo contra Supabase vía MCP
> (`mcp__supabase__*`), igual que SPEC 07. El repo `quotenjager` (spec 2, aparte) asume esto
> como precondición ya resuelta — no repite ni redefine políticas.

---

## Por qué este spec existe

Verificado contra el proyecto real: las 10 tablas (`leagues`, `seasons`, `teams`,
`stat_types`, `bookmakers`, `market_selections`, `matches`, `match_stats`, `match_odds`,
`predictions`) ya tienen RLS **habilitado**, pero **cero políticas** (`select * from
pg_policies where schemaname='public'` devuelve vacío). RLS habilitado sin políticas bloquea
todo acceso para cualquier rol que no sea `service_role` — hoy, ni siquiera con la anon key se
podría leer un solo dato migrado.

`diagrams/architecture.md` §6.4 ya asume "reading Supabase directly via its REST API with an
anon key and read-only RLS policies", y SPEC 07 dejó explícito que ese detalle "se resuelve
con el spec de la web". Este es ese spec.

---

## Scope

**In:**

- Migración SQL (`supabase/migrations/0008_web_read_policies.sql`) que agrega, para las 10
  tablas existentes, una política `SELECT` para el rol `anon` — hoy ninguna tiene política,
  así que están 100% bloqueadas pese a tener RLS habilitado.
- `GRANT SELECT` sobre la vista `matches_unified` (no `v_match_results` — esa vista nunca se
  implementó; la real, de `0006_matches_unified_view.sql`, es más completa: expone marcador,
  ~90 columnas de stats 1ra/2da mitad y cuotas en formato ancho, con nombres de equipo ya
  resueltos) para `anon` — las vistas necesitan permiso de objeto explícito además de las
  políticas de las tablas base.
- Confirmar/otorgar `GRANT USAGE ON SCHEMA public TO anon` si no está ya concedido por default
  de Supabase.
- Todas las columnas de todas las tablas quedan expuestas — sin restricción por columna
  (decisión explícita: "normal que se exponga todos los valores").
- Verificación con la anon key real: al menos un `SELECT` exitoso por tabla vía REST API
  (`curl` contra `{SUPABASE_URL}/rest/v1/...`), y confirmar que un intento de `INSERT` con la
  misma key falla (prueba negativa de que solo se abrió lectura).
- Documentar en este spec el contrato de columnas por tabla/vista que va a consumir
  `quotenjager` (referencia para su propio spec, no repetido allá).

**Out of scope (para specs futuros):**

- Restricciones a nivel de columna o de fila (ej. ocultar partidos de una liga, filtrar por
  fecha) — no hay ningún caso de uso hoy que lo pida.
- Política para el rol `authenticated` — no hay sistema de auth ni usuarios logueados
  planeados para la web.
- Cualquier política de escritura (`INSERT`/`UPDATE`/`DELETE`) para `anon`/`authenticated` —
  las únicas escrituras siguen siendo vía `service_role` desde los workflows de GitHub Actions
  (SPEC 11), que ya bypassea RLS por diseño de Supabase.
- Rate limiting o protección contra abuso de la API pública — se documenta como riesgo
  aceptado, no se implementa control adicional en este spec.
- El código del frontend que consume estas queries — spec propio del repo `quotenjager`.

---

## Data model

No se agregan tablas ni columnas. Lo que se introduce son las políticas RLS mismas y el
contrato de lectura que documentan.

### Políticas (una por tabla, mismo patrón)

```sql
alter table public.<tabla> enable row level security; -- ya está habilitado, se deja explícito por idempotencia
create policy "anon_select_<tabla>" on public.<tabla>
  for select
  to anon
  using (true);
```

Aplica sin modificación a las 10 tablas listadas en Scope. Para la vista:

```sql
grant select on public.matches_unified to anon;
```

`using (true)` en las 10 — no hay condición de fila porque no hay ningún dato a ocultar
(decisión: se expone todo). Si en el futuro hace falta ocultar algo, se vuelve una condición
real en la política, no un cambio de forma.

### Contrato de lectura (referencia para el spec de `quotenjager`)

| Tabla/vista | Columnas expuestas | Para qué la usa la web |
|---|---|---|
| `matches_unified` (vista) | `match_id`, `league_code`, `season_label`, `team_home`, `team_away`, `match_date`, `kickoff_utc`, ~90 columnas `{home,away}_{stat}_{1ht,2ht}` (incluye `home_goals_1ht`/`away_goals_1ht`/`home_goals_2ht`/`away_goals_2ht` para el marcador), `b365_odds_{home,draw,away}`, `ou15_{casa}_{over,under}_{1ht,2ht,ft}` | **Fuente principal de la web**: marcador parcial/final, variables crudas 1ra mitad, cuotas — todo en una sola query por partido, sin pivotear a mano |
| `matches` | todas (`match_id`, `league_code`, `season_label`, `home_team_id`, `away_team_id`, `match_date`, `kickoff_utc`, `status`, `created_at`, `updated_at`, `kickoff_seen_at`) | filtrar por `status` (en vivo/próximo/finalizado) — `matches_unified` no expone `status` |
| `teams` | `id`, `name`, `slug` | resolver nombres si se necesita fuera de `matches_unified` |
| `leagues`, `seasons` | todas | filtrar por liga/temporada activa |
| `match_stats`, `match_odds` | todas | acceso al detalle largo si `matches_unified` no alcanza (ej. otras casas de apuestas fuera de las 6 pivoteadas) |
| `bookmakers`, `market_selections`, `stat_types` | todas | resolver nombres/tipos legibles de las FKs de las tablas largas |
| `predictions` | todas (`match_id`, `bundle_tag`, `source_run_id`, `model_version`, `y_prob`, `predicted_at`) | pick + confianza, eligiendo por `predicted_at` más reciente por partido |

### Valores de conexión (para `quotenjager`)

Obtenidos vía `mcp__supabase__get_project_url` / `get_publishable_keys` (paso 3 del
implementation plan). Son públicos por diseño — van directo en `config.js` del frontend, no
son secreto:

- `SUPABASE_URL` = `https://nfrespwqvcvgecswtfkc.supabase.co`
- `SUPABASE_ANON_KEY` = `sb_publishable_WcKlkhaO-SsrKTCEud496w_5-jb7fZ6` (publishable key
  moderna — Supabase la recomienda sobre la legacy anon key JWT para apps nuevas, rotación
  independiente y mejor seguridad; la legacy JWT sigue activa como fallback si hiciera falta).

---

## Implementation plan

1. **`supabase/migrations/0008_web_read_policies.sql`** — las 10 políticas `anon_select_*`
   más el `grant select on matches_unified to anon` y el `grant usage on schema public to
   anon` (confirmando si ya existía). Verificación: `select count(*) from pg_policies where
   schemaname='public'` = 10.

2. **Aplicar la migración vía `mcp__supabase__apply_migration`** contra el proyecto real
   (mismo patrón de ejecución que SPEC 07).

3. **Obtener `SUPABASE_URL` y la anon key** vía `mcp__supabase__get_project_url` /
   `get_publishable_keys`, y documentarlas en este spec como referencia para `quotenjager`
   (son públicas por diseño, no son secreto).

4. **Prueba positiva**: un `curl` por tabla/vista contra
   `{SUPABASE_URL}/rest/v1/<tabla>?select=*&limit=1` con header `apikey: <anon_key>` devuelve
   `200` y al menos una fila (para las que ya tienen datos migrados) o `[]` con `200` (para
   las que hoy tienen 0 filas, si aplica) — nunca `401`/`403`.

5. **Prueba negativa**: un `curl -X POST` contra cualquier tabla con la misma anon key
   devuelve `401`/`403` (sin política de escritura, RLS lo bloquea) — confirma que la lectura
   pública no abrió accidentalmente escritura.

6. **Actualizar `diagrams/architecture.md` §6.4**: hoy dice genéricamente "read-only RLS
   policies"; se agrega la referencia a este spec como el que las define concretamente.

7. **Actualizar la nota de "Out of scope" de SPEC 07** ("RLS por columna para la web
   estática... se resuelve con el spec de la web") para apuntar a `specs/12-web-supabase-
   read-access.md`.

---

## Acceptance criteria

- [ ] `select count(*) from pg_policies where schemaname='public'` devuelve 10 (una política
      `anon_select_*` por tabla).
- [ ] `select has_table_privilege('anon', 'public.matches_unified', 'select')` devuelve
      `true`.
- [ ] Un `curl` con la anon key real contra `{SUPABASE_URL}/rest/v1/matches?select=*&limit=1`
      devuelve HTTP 200 (no 401/403).
- [ ] Lo mismo para las 9 tablas restantes y para `matches_unified` — los 10 devuelven HTTP
      200 con la anon key.
- [ ] Un `curl -X POST` con la anon key contra `{SUPABASE_URL}/rest/v1/matches` (intentando
      insertar una fila) devuelve HTTP 401/403 — confirma que no se abrió escritura.
- [ ] **Pendiente** — Los workflows de GitHub Actions (SPEC 11), que usan `service_role`,
      siguen escribiendo sin cambios. Esta migración no otorga ni revoca nada sobre
      `service_role` (que conserva `bypassrls` por defecto en Supabase, sin depender de
      políticas RLS), así que no debería romper nada — pero no se corrió ningún workflow real
      para confirmarlo end-to-end. Verificar en el primer run real posterior a este merge.
- [ ] `diagrams/architecture.md` §6.4 referencia `specs/12-web-supabase-read-access.md`.
- [ ] SPEC 07 apunta a `specs/12-web-supabase-read-access.md` en su nota de "Out of scope".

---

## Decisions

- **Sí:** políticas `SELECT` idénticas (`using (true)`) para las 10 tablas, sin restricción
  por fila ni columna. Decisión explícita del usuario: "normal que se exponga todos los
  valores" — no hay ningún dato en el esquema que amerite ocultarse (todo es información
  pública de partidos, cuotas y predicciones).
- **No:** restricciones por columna (ej. ocultar `source_run_id`/`model_version` de
  `predictions`). Descartado por la misma decisión de arriba.
- **Sí:** la migración vive en `bundesliga-project/supabase/migrations/`, no en el repo
  `quotenjager`. El schema y su ciclo de vida (incluidas las políticas de acceso) son
  propiedad de este repo; `quotenjager` solo consume la anon key, nunca declara ni modifica
  políticas. Decisión explícita del usuario.
- **Sí:** ejecutar la migración yo mismo vía MCP (`mcp__supabase__apply_migration`), igual que
  SPEC 07 — consistencia de proceso, y el usuario ya lo pidió así.
- **No:** política para el rol `authenticated`. No hay ningún flujo de login planeado; agregar
  esa política sería exponer una capacidad sin caso de uso.
- **No:** rate limiting o protección adicional contra abuso de la API pública en este spec. Es
  el mismo nivel de exposición que cualquier API REST pública de solo lectura; se documenta
  como riesgo aceptado, no se resuelve acá.
- **Sí (corrección en revisión, 2026-09-27):** el `grant select` es sobre `matches_unified`,
  no sobre `v_match_results`. Verificado contra `supabase/migrations/0006_matches_unified_
  view.sql`: esa vista nunca se implementó tal como la describía SPEC 07 en su diseño
  original; lo que sí existe es `matches_unified`, más completa (marcador + ~90 columnas de
  stats + cuotas en formato ancho, con nombres de equipo ya resueltos).

---

## Risks

| Riesgo | Mitigación |
|---|---|
| Exponer 100% de las columnas por `SELECT` público significa que cualquiera puede leer el detalle completo de partidos, cuotas y predicciones (incluido `source_run_id`/`model_version`) | Riesgo aceptado explícitamente por decisión del usuario — no hay dato sensible en el esquema, todo es información pública de partidos/apuestas. |
| Sin rate limiting propio, un scraping agresivo de la API pública podría acercarse a los límites del tier gratuito de Supabase | Supabase ya aplica límites de conexión/tasa a nivel de plataforma en el tier free; se acepta como mitigación suficiente para el volumen esperado de un sitio de portfolio. Revisar si el tráfico real lo justifica. |
| `matches_unified` es una vista no materializada sobre un `GROUP BY`/`JOIN` de tablas largas — leerla con alta frecuencia desde el frontend podría ser más lento que leer una tabla directa | Mismo riesgo ya identificado en SPEC 07 para su vista original: si el rendimiento no alcanza, se promueve a vista materializada sin cambiar el contrato de columnas que consume `quotenjager`. |
| Un cambio futuro a `matches_unified` (nuevo stat_code, nueva casa de apuestas) requiere regenerar la vista a mano (`MAX(CASE...)` explícito por columna, sin pivot dinámico) | Ya documentado como limitación conocida en el comentario de `0006_matches_unified_view.sql`; no es un riesgo nuevo de este spec. |

---

## What is **not** in this spec

- Restricciones por columna o por fila en las políticas RLS.
- Política de lectura para el rol `authenticated`.
- Cualquier política de escritura para roles públicos.
- Rate limiting / protección contra abuso de la API.
- El código del frontend (`quotenjager`) que consume estas queries — spec propio.
