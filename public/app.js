let sessionId = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ---------- setup ----------
function addPlayer(name) {
  const box = $('player-inputs');
  if (box.children.length >= 6) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.maxLength = 20;
  inp.placeholder = `Player ${box.children.length + 1}`;
  if (name) inp.value = name;
  box.appendChild(inp);
}

async function init() {
  addPlayer(); addPlayer();
  try {
    const st = await (await fetch('/api/status')).json();
    const pill = $('brain-pill');
    pill.textContent = st.jevAvailable
      ? `Jev armed · ${st.scenarios} lures`
      : `Local brain · ${st.scenarios} lures`;
    pill.classList.add(st.jevAvailable ? 'jev' : 'local');
  } catch {
    const pill = $('brain-pill');
    pill.textContent = 'Local brain';
    pill.classList.add('local');
  }
  show('screen-setup');
}

async function startGame() {
  const names = [...document.querySelectorAll('#player-inputs input')]
    .map((i) => i.value.trim()).filter(Boolean);
  if (names.length < 2) {
    alert('Add at least 2 players.');
    return;
  }
  $('jev-log').innerHTML = '<p class="jev-empty">Jev is watching…</p>';
  show('screen-loading');
  try {
    const r = await api('/api/new', {
      players: names,
      rounds: $('rounds').value,
      company: $('company').value.trim(),
    });
    handleRound(r);
  } catch {
    show('screen-setup');
  }
}

// ---------- round ----------
function scenarioCard(r) {
  const body = escapeHtml(r.body).replace(/\n/g, '<br>');
  if (r.format === 'email') {
    return `<div class="scard email">
      <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
      <div class="mrow"><span>From:</span><b>${escapeHtml(r.from)}</b></div>
      <div class="mrow"><span>Subject:</span><b>${escapeHtml(r.subject)}</b></div>
      <div class="sbody">${body}</div></div>`;
  }
  if (r.format === 'sms') {
    return `<div class="scard sms">
      <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
      <div class="sms-from">${escapeHtml(r.from)}</div>
      <div class="sms-bubble">${body}</div></div>`;
  }
  if (r.format === 'call') {
    return `<div class="scard call">
      <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
      <div class="call-from">📞 Incoming call: <b>${escapeHtml(r.from)}</b></div>
      <div class="sbody transcript">${body}</div></div>`;
  }
  if (r.format === 'portal') {
    return `<div class="scard portal">
      <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
      <div class="urlbar">🔒 ${escapeHtml(r.from)}</div>
      <h4>${escapeHtml(r.subject)}</h4>
      <div class="sbody">${body}</div></div>`;
  }
  if (r.format === 'popup') {
    return `<div class="scard popup">
      <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
      <div class="dlg"><div class="dlg-title">${escapeHtml(r.subject)}</div>
      <div class="dlg-app">${escapeHtml(r.from)}</div>
      <div class="sbody">${body}</div></div></div>`;
  }
  return `<div class="scard physical">
    <div class="shead"><span class="sicon">${r.icon}</span><span class="svec">${escapeHtml(r.vectorName)}</span></div>
    <h4>${escapeHtml(r.subject)}</h4>
    <div class="scontext">${escapeHtml(r.from)}</div>
    <div class="sbody">${body}</div></div>`;
}

function handleRound(r) {
  if (!r || r.error) { show('screen-setup'); return; }
  sessionId = r.sessionId || sessionId;
  renderJev(r.jev || []);
  $('round-progress').textContent = `Round ${r.n} of ${r.total}`;
  $('scenario-card').innerHTML = scenarioCard(r);
  $('voter-label').innerHTML = `🗳️ <b>${escapeHtml(r.voter)}</b>, it's your call — trust it or report it?`;
  $('votes-progress').textContent = `${r.votesCast}/${r.votesTotal} votes locked`;
  show('screen-round');
}

async function vote(v) {
  const r = await api('/api/vote', { sessionId, vote: v });
  if (r.type === 'reveal') handleReveal(r);
  else handleRound(r);
}

// ---------- reveal ----------
function handleReveal(r) {
  sessionId = r.sessionId || sessionId;
  renderJev(r.jev || []);
  const banner = $('reveal-banner');
  banner.className = 'banner ' + (r.isAttack ? 'attack' : 'legit');
  banner.textContent = r.isAttack ? '🎣 IT WAS AN ATTACK' : '✅ IT WAS LEGITIMATE';
  $('reveal-sub').innerHTML = r.isAttack
    ? `Jev's lure was aimed at <b>${escapeHtml(r.targetName)}</b>. ${r.trapSuccess ? 'The trap worked — most of you trusted it.' : 'You saw through it. This time.'}`
    : `No attack this round — Jev was testing your paranoia. The lure was aimed at <b>${escapeHtml(r.targetName)}</b>.`;
  $('flags-title').textContent = r.flagLabel;
  $('flags-list').innerHTML = r.flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  $('votes-list').innerHTML = r.results.map((p) => {
    const good = p.delta > 0;
    return `<div class="voterow ${good ? 'good' : 'bad'}">
      <span class="vname">${escapeHtml(p.name)}</span>
      <span class="vvote">${p.vote === 'trust' ? '✅ trusted' : '🚨 reported'}</span>
      <span class="vnote">${escapeHtml(p.note)}</span>
      <span class="vdelta">${p.delta > 0 ? '+' : ''}${p.delta} <em>(${p.score})</em></span>
    </div>`;
  }).join('');
  document.querySelector('#screen-reveal .btn.gold').textContent =
    r.n >= r.total ? 'See final scores' : 'Next round';
  show('screen-reveal');
}

async function nextRound() {
  show('screen-loading');
  const r = await api('/api/next', { sessionId });
  if (r.type === 'gameover') handleGameover(r);
  else handleRound(r);
}

// ---------- game over ----------
function handleGameover(r) {
  renderJev(r.jev || []);
  const top = r.board[0];
  $('winner').textContent = top ? `🏆 ${top.name} wins with ${top.score} pts` : '';
  $('board').innerHTML = r.board.map((p, i) =>
    `<div class="voterow ${i === 0 ? 'good' : ''}">
      <span class="vname">#${i + 1} ${escapeHtml(p.name)}</span>
      <span class="vvote">${escapeHtml(p.role)}</span>
      <span class="vdelta">${p.score} pts</span>
    </div>`).join('');
  $('jev-stats').innerHTML =
    `Jev launched <b>${r.stats.attacksLaunched}</b> attacks and trapped you in ` +
    `<b>${r.stats.trapWins}</b> of them — a <b>${r.stats.trapRate}%</b> trap rate.`;
  show('screen-gameover');
}

// ---------- Jev's mind ----------
const KIND_ICON = { should_attack: '⚔️', vector: '🎯', target: '📍', lure: '🪤', trap_report: '📊', info: 'ℹ️' };

function renderJev(log) {
  const box = $('jev-log');
  box.innerHTML = '';
  const decisions = log.filter((e) => !e.fallback && !['info', 'trap_report'].includes(e.kind)).length;
  $('jev-count').textContent = decisions ? `${decisions} decisions` : '';
  if (!log.length) {
    box.innerHTML = '<p class="jev-empty">Press start — Jev is waiting.</p>';
    return;
  }
  [...log].reverse().forEach((e) => {
    const div = document.createElement('div');
    div.className = 'jev-entry' + (e.fallback ? ' fallback' : '');
    const meta = [];
    if (e.ms) meta.push(`${e.ms}ms`);
    if (e.confidence != null && !['should_attack'].includes(e.kind)) meta.push(`conf ${Math.round(e.confidence * 100)}%`);
    let bars = '';
    (e.probs || []).forEach((p) => {
      const pct = Math.round(p.p * 100);
      bars += `<div class="bar"><span class="blabel">${escapeHtml(p.label)}</span>` +
        `<div class="btrack"><div class="bfill" style="width:${pct}%"></div></div>` +
        `<span class="bpct">${pct}%</span></div>`;
    });
    div.innerHTML =
      `<div class="jhead">${e.fallback ? '<span class="fbadge">local</span>' : '<span class="jbadge">jev</span>'}` +
      `<strong>${escapeHtml(e.title)}</strong></div>` +
      (e.detail ? `<div class="jdetail">${escapeHtml(e.detail)}</div>` : '') +
      bars +
      (e.verdict ? `<div class="jverdict">${escapeHtml(e.verdict)}</div>` : '') +
      (meta.length ? `<div class="jmeta">${KIND_ICON[e.kind] || ''} ${meta.join(' · ')}</div>` : '');
    box.appendChild(div);
  });
}

window.addEventListener('DOMContentLoaded', init);
