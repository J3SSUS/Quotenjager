function qjTab(name){
  document.querySelectorAll('.bet-tab').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.bet-panel').forEach(function(p){
    p.hidden = (p.getAttribute('data-panel') !== name);
  });
}
function route(){
  var path = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('.page').forEach(function(p){
    p.hidden = (p.id !== 'route-' + path);
  });
  document.querySelectorAll('nav a[data-route]').forEach(function(a){
    a.classList.toggle('active', a.getAttribute('data-route') === path);
  });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

// ---- Supabase-backed rendering (Home) ----

var LOADING_HTML = '<div class="placeholder-note">Loading…</div>';

function emptyStateHtml(message) {
  return '<div class="placeholder-note">' + escapeHtml(message) + '</div>';
}

function errorStateHtml() {
  return '<div class="placeholder-note">Could not load the data. Please try again later.</div>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function confidenceOf(row) {
  return row.pick === 'over' ? row.y_prob : 1 - row.y_prob;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
}

// kickoff_utc es el timestamp local del scraper guardado tal cual (no UTC real,
// ver SPEC 07 Decisions) — se parsea el string a mano en vez de `new Date()`,
// que reinterpretaría la 'Z'/offset como UTC real y correría la hora al
// convertir al huso horario del navegador.
function formatKickoff(kickoffUtc) {
  if (!kickoffUtc) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(kickoffUtc);
  if (!m) return kickoffUtc;
  var year = +m[1], month = +m[2], day = +m[3], hour = m[4], minute = m[5];
  var weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return weekday + ' · ' + hour + ':' + minute;
}

function halftimeFeatureHtml(m) {
  var pickLabel = m.pick === 'over' ? 'Over' : 'Under';
  var goalsPhrase = m.pick === 'over' ? '2 or more goals' : 'fewer than 2 goals';
  return (
    '<div class="feature" style="margin-top:0;">' +
    '<div>' +
    '<div class="live"><span class="pulse"></span>Halftime</div>' +
    '<div class="teams">' + escapeHtml(m.team_home) + ' <span class="vs">vs</span> ' + escapeHtml(m.team_away) + '</div>' +
    '<div class="meta">' + m.home_goals_1ht + '–' + m.away_goals_1ht + '</div>' +
    '<div class="verdict">The model sees a <b>' + m.confidence_pct + '% probability</b> of ' + goalsPhrase + ' in the second half.</div>' +
    '</div>' +
    '<div class="flip">' +
    '<div class="pct">' + m.confidence_pct + '%</div>' +
    '<div class="lbl">' + pickLabel + ' 1.5</div>' +
    '</div>' +
    '</div>'
  );
}

function halftimeCardHtml(m) {
  var badgeClass = m.pick === 'over' ? 'over' : 'under';
  var badgeLabel = m.pick === 'over' ? 'Over 1.5' : 'Under 1.5';
  return (
    '<div class="card">' +
    '<div class="live-tag"><span class="pulse"></span>Halftime</div>' +
    '<div class="matchup">' + escapeHtml(m.team_home) + ' <span class="vs">vs</span> ' + escapeHtml(m.team_away) + '</div>' +
    '<div class="score">' + m.home_goals_1ht + '–' + m.away_goals_1ht + ' at halftime</div>' +
    '<div class="pick-row">' +
    '<span class="badge ' + badgeClass + '">' + badgeLabel + '</span>' +
    '<span class="conf">' + m.confidence_pct + '%</span>' +
    '</div>' +
    '</div>'
  );
}

function lockedCardHtml(m) {
  return (
    '<div class="card locked">' +
    '<div class="matchup">' + escapeHtml(m.team_home) + ' <span class="vs">vs</span> ' + escapeHtml(m.team_away) + '</div>' +
    '<div class="score">' + escapeHtml(formatKickoff(m.kickoff_utc)) + '</div>' +
    '<div class="pick-row"><span class="lockmsg">🔒 pick at halftime</span></div>' +
    '</div>'
  );
}

function streakIconHtml(correct) {
  return '<i class="' + (correct ? 'y' : 'n') + '">' + (correct ? '✓' : '✕') + '</i>';
}

function historyRowHtml(r) {
  var badgeClass = r.pick === 'over' ? 'over' : 'under';
  var badgeLabel = r.pick === 'over' ? 'Over 1.5' : 'Under 1.5';
  var confidencePct = Math.round(confidenceOf(r) * 100);
  var resultColor = r.correct ? 'var(--over)' : 'var(--under)';
  var resultMark = r.correct ? '✓' : '✕';
  return (
    '<div class="history-row">' +
    '<div class="hteams">' + escapeHtml(r.team_home) + ' <span style="color:var(--text-dim);font-weight:400;">vs</span> ' + escapeHtml(r.team_away) + '</div>' +
    '<div class="hscore">' + r.home_goals_final + '–' + r.away_goals_final + ' final · HT ' + r.home_goals_1ht + '–' + r.away_goals_1ht + ' · 2H ' + r.home_goals_2ht + '–' + r.away_goals_2ht + '</div>' +
    '<div class="badge ' + badgeClass + '">' + badgeLabel + ' · ' + confidencePct + '%</div>' +
    '<div class="hresult" style="color:' + resultColor + ';">' + resultMark + '</div>' +
    '</div>'
  );
}

async function renderHalftimeSection() {
  var featureEl = document.getElementById('halftime-feature');
  var gridEl = document.getElementById('halftime-grid');
  featureEl.innerHTML = LOADING_HTML;
  gridEl.innerHTML = '';
  try {
    var matches = await window.qjData.getHalftimeMatches();
    if (!matches.length) {
      featureEl.innerHTML = '';
      gridEl.innerHTML = emptyStateHtml('No matches at halftime right now.');
      return;
    }
    featureEl.innerHTML = halftimeFeatureHtml(matches[0]);
    gridEl.innerHTML = matches.slice(1, 4).map(halftimeCardHtml).join('');
  } catch (e) {
    featureEl.innerHTML = errorStateHtml();
    gridEl.innerHTML = '';
  }
}

async function renderUpcomingHome() {
  var gridEl = document.getElementById('upcoming-grid-home');
  gridEl.innerHTML = LOADING_HTML;
  try {
    var matches = await window.qjData.getUpcomingMatches(3);
    gridEl.innerHTML = matches.length
      ? matches.map(lockedCardHtml).join('')
      : emptyStateHtml('No upcoming matches right now.');
  } catch (e) {
    gridEl.innerHTML = errorStateHtml();
  }
}

async function renderHistorialSection() {
  var recordTopEl = document.getElementById('record-top-home');
  var miniStatsEl = document.getElementById('mini-stats-home');
  var rowsEl = document.getElementById('history-rows-home');
  var heroMatchesEl = document.getElementById('hero-matches-predicted');
  var heroAccuracyEl = document.getElementById('hero-accuracy');

  recordTopEl.innerHTML = LOADING_HTML;
  miniStatsEl.innerHTML = '';
  rowsEl.innerHTML = '';

  try {
    var results = await Promise.all([window.qjData.getTrackRecord(), window.qjData.getModelLog()]);
    var track = results[0];
    var fullLog = results[1];

    heroMatchesEl.textContent = track.matches_predicted;
    heroAccuracyEl.textContent = track.accuracy_pct + '%';

    if (!track.matches_predicted) {
      recordTopEl.innerHTML = '';
      rowsEl.innerHTML = emptyStateHtml('No settled matches yet.');
      return;
    }

    recordTopEl.innerHTML =
      '<div class="record-big">' + track.accuracy_pct + '<span>% accuracy<br>' + track.matches_predicted + ' matches</span></div>' +
      '<div class="streak">' + track.last10.slice().reverse().map(streakIconHtml).join('') + '</div>';

    var avgConfidencePct = Math.round(average(fullLog.map(confidenceOf)) * 100);
    var highConfidenceRows = fullLog.filter(function (r) { return confidenceOf(r) > 0.75; });
    var highConfidenceAccuracy = highConfidenceRows.length
      ? Math.round((highConfidenceRows.filter(function (r) { return r.correct; }).length / highConfidenceRows.length) * 100) + '%'
      : '—';

    miniStatsEl.innerHTML =
      '<div class="mini-stat"><div class="mv">' + avgConfidencePct + '%</div><div class="ml">Average confidence</div></div>' +
      '<div class="mini-stat"><div class="mv">' + track.streak_len + '</div><div class="ml">Correct picks in a row</div></div>' +
      '<div class="mini-stat"><div class="mv">' + highConfidenceAccuracy + '</div><div class="ml">Accuracy when the pick is above 75%</div></div>';

    rowsEl.innerHTML = fullLog.length
      ? fullLog.slice(0, 3).map(historyRowHtml).join('')
      : emptyStateHtml('No settled matches yet.');
  } catch (e) {
    recordTopEl.innerHTML = errorStateHtml();
    miniStatsEl.innerHTML = '';
    rowsEl.innerHTML = '';
  }
}

function renderHome() {
  renderHalftimeSection();
  renderUpcomingHome();
  renderHistorialSection();
}

// ---- Supabase-backed rendering (Model page) ----

function formatMatchDate(kickoffUtc) {
  if (!kickoffUtc) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(kickoffUtc);
  if (!m) return kickoffUtc;
  var year = +m[1], month = +m[2], day = +m[3];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function modelBannerHtml(track) {
  return (
    '<div class="mb-left">' +
    '<div class="mb-eyebrow">Model in production</div>' +
    '<div class="mb-model">' + escapeHtml(track.bundle_tag || '—') + '</div>' +
    '<div class="mb-sub">Binary classification · Over/Under 1.5 goals in the 2nd half · ~30 1st-half variables</div>' +
    '</div>' +
    '<div class="mb-right">' +
    '<div class="mb-stat"><div class="mb-num">' + track.accuracy_pct + '%</div><div class="mb-lbl">2026–27 accuracy</div></div>' +
    '<div class="mb-stat"><div class="mb-num">' + track.matches_predicted + '</div><div class="mb-lbl">Matches predicted</div></div>' +
    '<div class="mb-form"><div class="mb-lbl">Last 10</div><div class="streak">' +
    track.last10.slice().reverse().map(streakIconHtml).join('') +
    '</div></div>' +
    '</div>'
  );
}

function modelRowHtml(r) {
  var badgeClass = r.pick === 'over' ? 'over' : 'under';
  var badgeLabel = r.pick === 'over' ? 'Over 1.5' : 'Under 1.5';
  var confidencePct = Math.round(confidenceOf(r) * 100);
  var resultColor = r.correct ? 'var(--over)' : 'var(--under)';
  var resultLabel = r.correct ? '✓ Correct' : '✕ Missed';
  return (
    '<div class="model-row">' +
    '<div class="mr-head">' +
    '<div class="mr-meta">' + escapeHtml(formatMatchDate(r.kickoff_utc)) + '</div>' +
    '<div class="mr-teams">' + escapeHtml(r.team_home) + ' <span class="vs">vs</span> ' + escapeHtml(r.team_away) + '</div>' +
    '<div class="mr-half">Halftime ' + r.home_goals_1ht + '–' + r.away_goals_1ht + '</div>' +
    '</div>' +
    '<div class="mr-pred"><span class="badge ' + badgeClass + '">' + badgeLabel + ' · ' + confidencePct + '%</span></div>' +
    '<div class="mr-result">' +
    '<div class="hscore">Final ' + r.home_goals_final + '–' + r.away_goals_final + '</div>' +
    '<div class="hresult" style="color:' + resultColor + ';">' + resultLabel + '</div>' +
    '</div>' +
    '<details class="mr-vars"><summary>See 1st-half variables</summary>' +
    '<div class="placeholder-note">Coming soon — per-match 1st-half variables aren\'t available yet.</div>' +
    '</details>' +
    '</div>'
  );
}

async function renderModelPage() {
  var bannerEl = document.getElementById('model-banner');
  var listEl = document.getElementById('model-list');
  bannerEl.innerHTML = LOADING_HTML;
  listEl.innerHTML = LOADING_HTML;
  try {
    var results = await Promise.all([window.qjData.getTrackRecord(), window.qjData.getModelLog()]);
    var track = results[0];
    var log = results[1];

    bannerEl.innerHTML = modelBannerHtml(track);
    listEl.innerHTML = log.length ? log.map(modelRowHtml).join('') : emptyStateHtml('No settled matches yet.');
  } catch (e) {
    bannerEl.innerHTML = errorStateHtml();
    listEl.innerHTML = errorStateHtml();
  }
}

renderHome();
renderModelPage();
