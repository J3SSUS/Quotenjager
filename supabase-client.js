import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// matches con status in ('scheduled','odds_scraped'), ordenados por kickoff_utc asc.
// Devuelve: [{ match_id, team_home, team_away, kickoff_utc, league_code }]
async function getUpcomingMatches(limit) {
  let query = supabase
    .from('matches')
    .select('match_id, kickoff_utc')
    .in('status', ['scheduled', 'odds_scraped'])
    .order('kickoff_utc', { ascending: true });
  if (typeof limit === 'number') query = query.limit(limit);

  const { data: matches, error } = await query;
  if (error) throw error;
  if (!matches.length) return [];

  const ids = matches.map((m) => m.match_id);
  const { data: unified, error: unifiedError } = await supabase
    .from('matches_unified')
    .select('match_id, team_home, team_away, kickoff_utc, league_code')
    .in('match_id', ids);
  if (unifiedError) throw unifiedError;

  const byId = Object.fromEntries(unified.map((u) => [u.match_id, u]));
  return ids.map((id) => byId[id]).filter(Boolean);
}

// matches con status='predicted': marcador 1ra mitad + pick derivado de y_prob.
// Devuelve: [{ match_id, team_home, team_away, home_goals_1ht, away_goals_1ht,
//              y_prob, pick: 'over'|'under', confidence_pct }]
async function getHalftimeMatches() {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('match_id')
    .eq('status', 'predicted');
  if (error) throw error;
  if (!matches.length) return [];

  const ids = matches.map((m) => m.match_id);
  const [{ data: unified, error: unifiedError }, { data: preds, error: predsError }] = await Promise.all([
    supabase
      .from('matches_unified')
      .select('match_id, team_home, team_away, home_goals_1ht, away_goals_1ht, kickoff_utc')
      .in('match_id', ids),
    supabase
      .from('predictions')
      .select('match_id, y_prob, predicted_at')
      .in('match_id', ids)
      .order('predicted_at', { ascending: false }),
  ]);
  if (unifiedError) throw unifiedError;
  if (predsError) throw predsError;

  const latestPredByMatch = latestByMatchId(preds);
  const unifiedById = Object.fromEntries(unified.map((u) => [u.match_id, u]));

  return ids
    .map((id) => {
      const u = unifiedById[id];
      const p = latestPredByMatch[id];
      if (!u || !p) return null;
      const pick = p.y_prob >= PREDICTION_THRESHOLD ? 'over' : 'under';
      const confidence = pick === 'over' ? p.y_prob : 1 - p.y_prob;
      return {
        match_id: id,
        team_home: u.team_home,
        team_away: u.team_away,
        home_goals_1ht: u.home_goals_1ht,
        away_goals_1ht: u.away_goals_1ht,
        kickoff_utc: u.kickoff_utc,
        y_prob: p.y_prob,
        pick,
        confidence_pct: Math.round(confidence * 100),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.kickoff_utc) - new Date(a.kickoff_utc));
}

// matches con status in ('finished','resolved'): marcador final + pick + acierto.
// Devuelve: [{ match_id, team_home, team_away, home_goals_2ht, away_goals_2ht,
//              total_goals_2ht, y_prob, pick, outcome: 'over'|'under', correct: bool,
//              predicted_at }], ordenado por predicted_at desc.
async function getModelLog(limit) {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('match_id')
    .in('status', ['finished', 'resolved']);
  if (error) throw error;
  if (!matches.length) return [];

  const ids = matches.map((m) => m.match_id);
  const [{ data: unified, error: unifiedError }, { data: preds, error: predsError }] = await Promise.all([
    supabase
      .from('matches_unified')
      .select('match_id, team_home, team_away, home_goals_2ht, away_goals_2ht')
      .in('match_id', ids),
    supabase
      .from('predictions')
      .select('match_id, y_prob, predicted_at')
      .in('match_id', ids)
      .order('predicted_at', { ascending: false }),
  ]);
  if (unifiedError) throw unifiedError;
  if (predsError) throw predsError;

  const latestPredByMatch = latestByMatchId(preds);
  const unifiedById = Object.fromEntries(unified.map((u) => [u.match_id, u]));

  const rows = ids
    .map((id) => {
      const u = unifiedById[id];
      const p = latestPredByMatch[id];
      if (!u || !p) return null;
      const totalGoals2ht = u.home_goals_2ht + u.away_goals_2ht;
      const pick = p.y_prob >= PREDICTION_THRESHOLD ? 'over' : 'under';
      const outcome = totalGoals2ht >= OU_LINE_2HT ? 'over' : 'under';
      return {
        match_id: id,
        team_home: u.team_home,
        team_away: u.team_away,
        home_goals_2ht: u.home_goals_2ht,
        away_goals_2ht: u.away_goals_2ht,
        total_goals_2ht: totalGoals2ht,
        y_prob: p.y_prob,
        pick,
        outcome,
        correct: pick === outcome,
        predicted_at: p.predicted_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.predicted_at) - new Date(a.predicted_at));

  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

// Agregación sobre getModelLog(): accuracy acumulada, racha, matches_predicted.
// Devuelve: { accuracy_pct, matches_predicted, last10: [bool, ...], streak_len }
async function getTrackRecord() {
  const rows = await getModelLog();
  const matchesPredicted = rows.length;
  const correctCount = rows.filter((r) => r.correct).length;
  const accuracyPct = matchesPredicted ? Math.round((correctCount / matchesPredicted) * 100) : 0;

  // rows viene ordenado predicted_at desc: last10[0] es el más reciente.
  const last10 = rows.slice(0, 10).map((r) => r.correct);
  let streakLen = 0;
  for (const correct of last10) {
    if (!correct) break;
    streakLen += 1;
  }

  return {
    accuracy_pct: accuracyPct,
    matches_predicted: matchesPredicted,
    last10,
    streak_len: streakLen,
  };
}

// Predicción más reciente por match_id, asumiendo `rows` ya viene ordenado
// por predicted_at desc (se queda con la primera aparición de cada match_id).
function latestByMatchId(rows) {
  const result = {};
  for (const row of rows) {
    if (!(row.match_id in result)) result[row.match_id] = row;
  }
  return result;
}

window.qjData = { getUpcomingMatches, getHalftimeMatches, getModelLog, getTrackRecord };
