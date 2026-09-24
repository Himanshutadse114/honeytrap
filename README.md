# 🍯 Honeytrap

A multiplayer social-engineering trap game. **Jev** (TypeSafe AI) plays the attacker — and you are the target.

## How it plays

1. 2–6 players, one screen (pass-and-play). You're employees of a fictional company.
2. Every round, Jev secretly decides:
   - **Attack or legitimate?** — a real phish, or a legit message to punish paranoia
   - **Which vector?** — phishing email, smishing, vishing, fake portal, USB drop, QR code, CEO fraud, fake update
   - **Who to target?** — it studies who falls for what and aims at the weakest player
   - **Which exact lure?** — picked from a bank of 40 scenarios
3. The lure appears exactly as it would in real life — an email in your inbox, an SMS, a call transcript, a login page.
4. Each player votes: **Trust it** or **Report attack**. Votes stay hidden until everyone has voted.
5. Reveal: was it an attack? Red flags (or green flags) explained — that's the security-awareness training.
6. Scoring: spot an attack **+2**, fall for one **−3**, correctly trust a legit message **+1**, false alarm **−1**.

Like Mastermind, Jev narrows down each player's weak spots round after round and traps them where they're weakest. The **Jev's mind** panel shows every decision live with probabilities.

## Run it

```cmd
git clone https://github.com/Himanshutadse114/honeytrap.git
cd honeytrap
npm install
set "TYPESAFE_API_KEY=your-key-here" && npm start
```

Then open http://localhost:3000. Without the key, a local brain plays instead (still fun, less cunning).

## Files

- `server.js` — game engine + Jev decisions
- `data/scenarios.json` — 8 vectors × 5 scenarios (3 attacks + 2 legit each)
- `public/` — the game UI
