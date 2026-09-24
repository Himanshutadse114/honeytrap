// Honeytrap — a multiplayer social-engineering trap game.
// Jev (TypeSafe AI) plays the attacker. Every round it decides:
//   1. attack or legitimate message?   (noul probability)
//   2. which attack vector?             (choice)
//   3. which player to target?          (choice, exploiting weaknesses)
//   4. which exact lure?                (choice)
// Like Mastermind, it narrows down each player's weak spots and traps
// them where they're weakest. Every decision is logged with
// probabilities and latency for the "Jev's mind" panel.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_TIMEOUT_MS = 8000;

const app = express();
app.use(express.json());

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'scenarios.json'), 'utf8'));
const VECTORS = DATA.vectors;
const vectorById = (id) => VECTORS.find((v) => v.id === id);

const JEV_KEY = (process.env.TYPESAFE_API_KEY || '').trim();
const jevAvailable = () => Boolean(JEV_KEY);
let jevLastError = null;

const ROLES = ['Finance', 'HR', 'Engineering', 'Customer Support', 'Sales', 'IT Admin'];

// ---------- Jev plumbing ----------
async function jevCall(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JEV_KEY}` },
      body: JSON.stringify({ model: 'jev-latest', ...body }),
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      jevLastError = `HTTP ${res.status}`;
      console.error('[jev]', jevLastError);
      return { error: jevLastError, ms };
    }
    jevLastError = null;
    return { data: await res.json(), ms };
  } catch (err) {
    const ms = Date.now() - t0;
    jevLastError = err.message;
    console.error('[jev]', jevLastError);
    return { error: jevLastError, ms };
  } finally {
    clearTimeout(timer);
  }
}

const logJev = (s, e) => s.jev.push({ at: new Date().toISOString(), ...e });
const probsOf = (ans, labelOf, top = 5) =>
  Object.entries((ans && ans.probabilities) || {})
    .map(([id, p]) => ({ label: labelOf(id), p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, top);

function weaknessLine(p) {
  const parts = Object.keys(p.faced)
    .filter((v) => p.faced[v] > 0)
    .map((v) => `${v} fell ${p.fell[v] || 0}/${p.faced[v]}`);
  return parts.length ? parts.join('; ') : 'untested';
}
const playerState = (s) =>
  s.players.map((p) => `- ${p.name} (${p.role}, score ${p.score}): ${weaknessLine(p)}`).join('\n');

// ---------- Jev decisions ----------
async function decideAttack(s) {
  const state =
    `You are the attacker in a security-awareness trap game at ${s.company}.\n` +
    `Round ${s.round} of ${s.rounds}.\n` +
    `Players (vector: fell/faced):\n${playerState(s)}\n` +
    (s.lastOutcome ? `Last round: ${s.lastOutcome}` : 'No rounds played yet.');
  if (jevAvailable()) {
    const { data, ms, error } = await jevCall({
      state,
      questions: {
        should_attack: {
          type: 'noul',
          instructions:
            'Should this round be a REAL social-engineering attack? If players have started reporting everything out of paranoia, a legitimate message punishes that. Return the probability this round should be an attack.',
        },
      },
    });
    const ans = data && data.answers && data.answers.should_attack;
    if (!error && ans && typeof ans.noul === 'number') {
      const p = ans.noul;
      const attack = p >= 0.5;
      logJev(s, {
        kind: 'should_attack',
        title: 'Jev decided: attack or legitimate?',
        detail: attack ? 'Launching a real attack' : 'Sending a legitimate message (paranoia trap)',
        probs: [
          { label: 'Real attack', p },
          { label: 'Legitimate', p: 1 - p },
        ],
        confidence: Math.max(p, 1 - p),
        ms,
        fallback: false,
        verdict: attack ? '⚔️ Attack incoming' : '📋 Legit message incoming',
      });
      return attack;
    }
  }
  const attack = Math.random() < 0.7;
  logJev(s, {
    kind: 'should_attack', title: 'Attack or legitimate? (local brain)',
    detail: attack ? 'Real attack' : 'Legitimate message',
    probs: [], confidence: null, ms: 0, fallback: true,
  });
  return attack;
}

async function decideVector(s, isAttack) {
  const criteria = {};
  for (const v of VECTORS) criteria[v.id] = `${v.name}: ${v.description}`;
  const state =
    `You are the attacker in a security-awareness trap game at ${s.company}.\n` +
    `This round will be a ${isAttack ? 'REAL attack' : 'LEGITIMATE message'}.\n` +
    `Players (vector: fell/faced):\n${playerState(s)}`;
  if (jevAvailable()) {
    const { data, ms, error } = await jevCall({
      state,
      questions: {
        vector: {
          type: 'choice',
          instructions: isAttack
            ? 'Pick the attack vector most likely to fool these players — exploit their known weaknesses.'
            : 'Pick the vector for a legitimate message that looks just suspicious enough to tempt a false report.',
          criteria,
        },
      },
    });
    const ans = data && data.answers && data.answers.vector;
    if (!error && ans && ans.choice && vectorById(ans.choice)) {
      logJev(s, {
        kind: 'vector',
        title: 'Jev picked the vector',
        detail: `${vectorById(ans.choice).icon} ${vectorById(ans.choice).name}`,
        probs: probsOf(ans, (id) => (vectorById(id) ? `${vectorById(id).icon} ${vectorById(id).name}` : id)),
        confidence: ans.confidence,
        ms,
        fallback: false,
      });
      return ans.choice;
    }
  }
  const weights = VECTORS.map(
    (v) => 1 + s.players.reduce((a, p) => a + (p.fell[v.id] || 0) * 2, 0)
  );
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let id = VECTORS[0].id;
  for (let i = 0; i < VECTORS.length; i++) {
    r -= weights[i];
    if (r <= 0) { id = VECTORS[i].id; break; }
  }
  logJev(s, {
    kind: 'vector', title: 'Vector (local brain)',
    detail: `${vectorById(id).icon} ${vectorById(id).name}`,
    probs: [], confidence: null, ms: 0, fallback: true,
  });
  return id;
}

async function decideTarget(s, vectorId, isAttack) {
  const criteria = {};
  for (const p of s.players) criteria[p.name] = `${p.role}; ${weaknessLine(p)}; score ${p.score}`;
  const state =
    `You are the attacker in a security-awareness trap game at ${s.company}.\n` +
    `Vector this round: ${vectorId} (${isAttack ? 'real attack' : 'legitimate message'}).\n` +
    `Pick which player the lure should be personally addressed to.`;
  if (jevAvailable()) {
    const { data, ms, error } = await jevCall({
      state,
      questions: {
        target: {
          type: 'choice',
          instructions: isAttack
            ? 'Pick the player most likely to fall for this vector — target their weakest spot.'
            : 'Pick the player most likely to false-report a legitimate message.',
          criteria,
        },
      },
    });
    const ans = data && data.answers && data.answers.target;
    if (!error && ans && ans.choice && s.players.some((p) => p.name === ans.choice)) {
      logJev(s, {
        kind: 'target',
        title: 'Jev picked its target',
        detail: `The lure is addressed to ${ans.choice}`,
        probs: probsOf(ans, (id) => id),
        confidence: ans.confidence,
        ms,
        fallback: false,
      });
      return ans.choice;
    }
  }
  const sorted = [...s.players].sort(
    (a, b) =>
      Object.values(b.fell).reduce((x, y) => x + y, 0) -
      Object.values(a.fell).reduce((x, y) => x + y, 0)
  );
  const name = sorted[0].name;
  logJev(s, {
    kind: 'target', title: 'Target (local brain)', detail: `Addressed to ${name}`,
    probs: [], confidence: null, ms: 0, fallback: true,
  });
  return name;
}

async function decideScenario(s, vectorId, isAttack) {
  const pool = vectorById(vectorId).scenarios.filter((sc) => sc.attack === isAttack);
  const criteria = {};
  for (const sc of pool) criteria[sc.id] = sc.body.slice(0, 90) + '…';
  if (jevAvailable()) {
    const { data, ms, error } = await jevCall({
      state: `You are the attacker in a security-awareness trap game. Vector: ${vectorId} (${isAttack ? 'real attack' : 'legitimate message'}). Pick the single most effective lure from the options.`,
      questions: {
        lure: {
          type: 'choice',
          instructions: 'Pick the lure most likely to achieve your goal this round.',
          criteria,
        },
      },
    });
    const ans = data && data.answers && data.answers.lure;
    if (!error && ans && ans.choice && pool.some((sc) => sc.id === ans.choice)) {
      logJev(s, {
        kind: 'lure',
        title: 'Jev chose the exact lure',
        detail: pool.find((sc) => sc.id === ans.choice).subject || pool.find((sc) => sc.id === ans.choice).body.slice(0, 80),
        probs: probsOf(ans, (id) => id),
        confidence: ans.confidence,
        ms,
        fallback: false,
      });
      return ans.choice;
    }
  }
  const sc = pool[Math.floor(Math.random() * pool.length)];
  logJev(s, {
    kind: 'lure', title: 'Lure (local brain)', detail: sc.subject || sc.body.slice(0, 80),
    probs: [], confidence: null, ms: 0, fallback: true,
  });
  return sc.id;
}

// ---------- game flow ----------
const sessions = new Map();

function fill(text, ctx) {
  return String(text || '')
    .replace(/\{player\}/g, ctx.player)
    .replace(/\{role\}/g, ctx.role)
    .replace(/\{company\}/g, ctx.company);
}

function newSession(playerNames, rounds, company) {
  return {
    id: crypto.randomUUID(),
    company: company || 'Nimbus Fintech',
    rounds,
    round: 0,
    players: playerNames.map((name, i) => ({
      name, role: ROLES[i % ROLES.length], score: 0, faced: {}, fell: {},
    })),
    current: null,
    jev: [],
    lastOutcome: null,
    attacksLaunched: 0,
    trapWins: 0,
  };
}

async function buildRound(s) {
  s.round += 1;
  logJev(s, {
    kind: 'info', title: `Round ${s.round} of ${s.rounds}`,
    detail: `${s.players.length} players at ${s.company}`,
    probs: [], confidence: null, ms: 0, fallback: false,
  });
  const isAttack = await decideAttack(s);
  const vectorId = await decideVector(s, isAttack);
  const targetName = await decideTarget(s, vectorId, isAttack);
  const scenarioId = await decideScenario(s, vectorId, isAttack);
  const vector = vectorById(vectorId);
  const sc = vector.scenarios.find((x) => x.id === scenarioId);
  const target = s.players.find((p) => p.name === targetName);
  const ctx = { player: target.name, role: target.role, company: s.company };
  s.current = {
    vectorId,
    isAttack,
    targetName: target.name,
    subject: fill(sc.subject, ctx),
    from: fill(sc.from, ctx),
    body: fill(sc.body, ctx),
    flags: sc.flags.map((f) => fill(f, ctx)),
    difficulty: sc.difficulty,
    votes: {},
    voteIdx: 0,
  };
  if (isAttack) s.attacksLaunched += 1;
  return roundView(s);
}

function roundView(s) {
  const c = s.current;
  const v = vectorById(c.vectorId);
  return {
    type: 'round',
    n: s.round,
    total: s.rounds,
    vectorName: v.name,
    icon: v.icon,
    format: v.format,
    subject: c.subject,
    from: c.from,
    body: c.body,
    voter: s.players[c.voteIdx].name,
    votesCast: c.voteIdx,
    votesTotal: s.players.length,
  };
}

function reveal(s) {
  const c = s.current;
  const v = vectorById(c.vectorId);
  const results = s.players.map((p) => {
    const vote = c.votes[p.name];
    let delta = 0, note = '';
    p.faced[c.vectorId] = (p.faced[c.vectorId] || 0) + 1;
    if (c.isAttack && vote === 'report') { delta = 2; note = 'spotted it'; }
    else if (c.isAttack && vote === 'trust') { delta = -3; note = 'fell for it'; p.fell[c.vectorId] = (p.fell[c.vectorId] || 0) + 1; }
    else if (!c.isAttack && vote === 'trust') { delta = 1; note = 'correctly trusted'; }
    else { delta = -1; note = 'false alarm'; }
    p.score += delta;
    return { name: p.name, vote, delta, note, score: p.score };
  });
  const trustCount = results.filter((r) => r.vote === 'trust').length;
  const trapSuccess = c.isAttack && trustCount > results.length / 2;
  if (trapSuccess) s.trapWins += 1;
  s.lastOutcome = `${c.isAttack ? 'attack' : 'legitimate message'} via ${c.vectorId} aimed at ${c.targetName}; ${trustCount}/${results.length} trusted it.`;
  logJev(s, {
    kind: 'trap_report',
    title: trapSuccess ? '🎣 Trap successful' : c.isAttack ? '🛡️ Attack repelled' : '📋 Legit round complete',
    detail: `${trustCount} of ${results.length} players trusted it · aimed at ${c.targetName}`,
    probs: [], confidence: null, ms: 0, fallback: false,
  });
  return {
    type: 'reveal',
    n: s.round,
    total: s.rounds,
    isAttack: c.isAttack,
    icon: v.icon,
    vectorName: v.name,
    targetName: c.targetName,
    flagLabel: c.isAttack ? '🚩 Red flags' : '✅ Why it was safe',
    flags: c.flags,
    results,
    trapSuccess,
    jev: s.jev,
  };
}

// ---------- API ----------
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    jevAvailable: jevAvailable(),
    jevError: jevLastError,
    vectors: VECTORS.length,
    scenarios: VECTORS.reduce((a, v) => a + v.scenarios.length, 0),
  });
});

app.post('/api/new', async (req, res) => {
  const { players, rounds, company } = req.body || {};
  const names = (players || []).map((n) => String(n).trim()).filter(Boolean).slice(0, 6);
  if (names.length < 2) return res.status(400).json({ error: 'need at least 2 players' });
  const s = newSession(names, Math.min(Math.max(parseInt(rounds, 10) || 6, 2), 12), company);
  sessions.set(s.id, s);
  const view = await buildRound(s);
  res.json({ sessionId: s.id, ...view, jev: s.jev });
});

app.post('/api/vote', (req, res) => {
  const { sessionId, vote } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s || !s.current) return res.status(404).json({ error: 'session not found' });
  if (!['trust', 'report'].includes(vote)) return res.status(400).json({ error: 'bad vote' });
  const c = s.current;
  const voter = s.players[c.voteIdx];
  if (!voter || c.votes[voter.name]) return res.status(400).json({ error: 'not your turn' });
  c.votes[voter.name] = vote;
  c.voteIdx += 1;
  if (c.voteIdx < s.players.length) {
    return res.json({ sessionId: s.id, ...roundView(s), jev: s.jev });
  }
  res.json({ sessionId: s.id, ...reveal(s) });
});

app.post('/api/next', async (req, res) => {
  const { sessionId } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (s.round >= s.rounds) {
    const board = [...s.players].sort((a, b) => b.score - a.score);
    logJev(s, {
      kind: 'info',
      title: 'Game over',
      detail: `Jev trapped players in ${s.trapWins} of ${s.attacksLaunched} attacks`,
      probs: [], confidence: null, ms: 0, fallback: false,
    });
    return res.json({
      type: 'gameover',
      board: board.map((p) => ({ name: p.name, role: p.role, score: p.score })),
      stats: {
        attacksLaunched: s.attacksLaunched,
        trapWins: s.trapWins,
        trapRate: s.attacksLaunched ? Math.round((s.trapWins / s.attacksLaunched) * 100) : 0,
      },
      jev: s.jev,
    });
  }
  const view = await buildRound(s);
  res.json({ sessionId: s.id, ...view, jev: s.jev });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`honeytrap on http://localhost:${PORT}`));
