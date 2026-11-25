import { Rng } from '../core/rng';
import type { Pt } from '../core/geom';
import type { GameMap } from '../map/types';
import { TERRAIN_INFO } from '../map/types';
import {
  BUILD_INFO, PROPOSAL_NAME, RULES, allied, atWar, countryGdp, defenseMultiplier, findPath, friendlyTo,
  isSeaStep, manpowerCap, orderCost, SUPPLY_CUT, SUPPLY_STRETCHED, stackCap, supplyCombat, supplyLevels,
  totalPop, totalTroops,
} from './rules';
import { applyEventChoice, rollEvent } from './events';
import { aiAcceptsProposal } from './ai';
import type {
  ColSnap, GameState, Order, Proposal, Resolution, SimEvent, TickFrame,
} from './types';

interface Col {
  id: number;
  owner: number;
  path: number[];
  amphib: boolean[];
  idx: number;
  prog: number;
  troops: number;
  init: number;
  kind: 'serang' | 'gerak' | 'mundur';
  fighting: boolean;
  battleDays: number;
  gone: boolean;
  stroke?: Pt[];
}

/**
 * Deterministic WEGO resolution: state + everyone's orders → new state + per-day
 * frames/events. Pure TypeScript, no rendering; the director only replays it.
 */
export function resolveTurn(map: GameMap, input: GameState, orders: Order[][]): { state: GameState; res: Resolution } {
  const s: GameState = structuredClone(input);
  const rng = new Rng(s.rng);
  const P = map.provinces;
  const nC = s.countries.length;
  const news: string[] = [];
  const priv: string[][] = s.countries.map(() => []);
  const casualties = new Array(nC).fill(0);
  const captured: Resolution['captured'] = [];
  const provLost = new Array(nC).fill(0);
  const day0Events: SimEvent[] = [];
  const name = (c: number) => s.countries[c].name;

  s.lastOrders = orders.map((o) => o.map((x) => ({ ...x })));
  for (const p of s.provs) p.entrenched = false;

  // ---------------- 1. diplomacy & events ----------------
  const declareWar = (a: number, b: number, reason = '') => {
    if (a === b || s.rel[a][b].status === 'perang') return;
    const prev = s.rel[a][b].status;
    for (const [x, y] of [[a, b], [b, a]]) {
      s.rel[x][y].status = 'perang';
      s.rel[x][y].value = Math.max(-100, s.rel[x][y].value - 50);
      s.rel[x][y].trade = false;
    }
    if (prev === 'nap' || prev === 'aliansi') {
      s.countries[a].reputation -= 30;
      s.countries[a].weariness = Math.min(100, s.countries[a].weariness + 10);
      news.push(`PENGKHIANATAN! ${name(a)} melanggar ${prev === 'nap' ? 'pakta non-agresi' : 'aliansi'} dengan ${name(b)}.`);
    } else news.push(`${name(a)} menyatakan perang kepada ${name(b)}${reason}.`);
    const cap = s.countries[b].capital >= 0 ? P[s.countries[b].capital] : P[0];
    day0Events.push({ t: 'moment', text: 'PERANG!', country: a, x: cap.x, y: cap.y, kind: 'perang' });
  };

  const applyProposal = (pr: Proposal) => {
    const { from: a, to: b } = pr;
    const ra = s.rel[a][b], rb = s.rel[b][a];
    if (pr.pay > 0) {
      const pay = Math.min(pr.pay, Math.max(0, s.countries[a].treasury));
      s.countries[a].treasury -= pay;
      s.countries[b].treasury += pay;
    }
    switch (pr.kind) {
      case 'damai':
        ra.status = rb.status = 'damai';
        ra.truce = rb.truce = 8;
        ra.value = rb.value = Math.min(100, ra.value + 25);
        // peace keeps the current lines: occupied land changes hands
        s.provs.forEach((p) => {
          if ((p.owner === a && p.ctrl === b) || (p.owner === b && p.ctrl === a)) p.owner = p.ctrl;
        });
        news.push(`DAMAI: ${name(a)} dan ${name(b)} menandatangani perjanjian damai.`);
        day0Events.push({ t: 'moment', text: 'DAMAI', country: a, x: P[s.countries[b].capital >= 0 ? s.countries[b].capital : 0].x, y: P[s.countries[b].capital >= 0 ? s.countries[b].capital : 0].y, kind: 'damai' });
        break;
      case 'aliansi':
        ra.status = rb.status = 'aliansi';
        ra.value = rb.value = Math.min(100, ra.value + 30);
        news.push(`${name(a)} dan ${name(b)} membentuk aliansi.`);
        break;
      case 'nap':
        ra.status = rb.status = 'nap';
        ra.value = rb.value = Math.min(100, ra.value + 15);
        news.push(`${name(a)} dan ${name(b)} menyepakati pakta non-agresi.`);
        break;
      case 'dagang':
        ra.trade = rb.trade = true;
        ra.value = rb.value = Math.min(100, ra.value + 15);
        news.push(`${name(a)} dan ${name(b)} membuka jalur dagang.`);
        break;
    }
  };

  for (let c = 0; c < nC; c++) {
    if (!s.countries[c].alive) continue;
    for (const o of orders[c] ?? []) {
      if (o.kind === 'deklarasi') {
        if (s.rel[c][o.target].truce > 0) continue;
        declareWar(c, o.target);
        // defensive alliances drag allies in
        for (let k = 0; k < nC; k++) {
          if (k !== c && s.rel[o.target][k].status === 'aliansi' && s.rel[c][k].status !== 'aliansi' && s.countries[k].alive) {
            declareWar(k, c, ` untuk membela sekutunya ${name(o.target)}`);
          }
        }
      } else if (o.kind === 'jawab') {
        const i = s.proposals.findIndex((p) => p.id === o.proposal && p.to === c);
        if (i < 0) continue;
        const pr = s.proposals[i];
        s.proposals.splice(i, 1);
        if (o.accept && validProposal(s, pr)) applyProposal(pr);
        else {
          priv[pr.from].push(`${name(c)} menolak usulan ${PROPOSAL_NAME[pr.kind].toLowerCase()} darimu.`);
          priv[c].push(`Kamu menolak usulan ${PROPOSAL_NAME[pr.kind].toLowerCase()} dari ${name(pr.from)}.`);
        }
      } else if (o.kind === 'event') {
        const msg = applyEventChoice(s, c, o.choice, rng);
        if (msg) priv[c].push(msg);
      }
    }
  }
  for (let c = 0; c < nC; c++) {
    if (!s.countries[c].alive) continue;
    for (const o of orders[c] ?? []) {
      if (o.kind !== 'usul') continue;
      const pr: Proposal = { id: s.nextProposalId++, from: c, to: o.to, kind: o.what, pay: o.pay, turn: s.turn };
      if (!validProposal(s, pr)) continue;
      if (s.countries[o.to].kind === 'manusia') {
        s.proposals.push(pr);
        priv[c].push(`Usulan ${PROPOSAL_NAME[pr.kind].toLowerCase()} dikirim ke ${name(o.to)}.`);
      } else if (aiAcceptsProposal(map, s, pr)) {
        applyProposal(pr);
      } else priv[c].push(`${name(o.to)} menolak usulan ${PROPOSAL_NAME[pr.kind].toLowerCase()}.`);
    }
  }
  s.proposals = s.proposals.filter((p) => s.turn - p.turn <= 2 && validProposal(s, p));
  // AI players leave unanswered events
  for (const k of s.countries) if (k.kind !== 'manusia' && k.pendingEvent) {
    const msg = applyEventChoice(s, k.id, Math.floor(rng.next() * 2), rng);
    if (msg) priv[k.id].push(msg);
  }

  // ---------------- 2. economy orders ----------------
  const recruits = new Map<number, { amount: number; owner: number; cost: number }>();
  const airZones: { owner: number; x: number; y: number; r: number }[] = [];
  for (let c = 0; c < nC; c++) {
    const me = s.countries[c];
    if (!me.alive) continue;
    for (const o of orders[c] ?? []) {
      const cost = orderCost(o);
      if (cost > 0 && me.treasury < cost) continue;
      switch (o.kind) {
        case 'bangun': {
          if (o.what === 'jalan') {
            const path = (o.path ?? [o.prov]).filter((p) => s.provs[p].owner === c && s.provs[p].ctrl === c);
            for (const p of path) if (s.provs[p].infra < 5) s.provs[p].queue.push({ kind: 'jalan', left: 1 });
            me.treasury -= BUILD_INFO.jalan.cost * path.length;
          } else {
            const p = s.provs[o.prov];
            if (p.owner !== c || p.ctrl !== c || p.queue.length >= 3) break;
            p.queue.push({ kind: o.what, left: BUILD_INFO[o.what].turns });
            me.treasury -= cost;
          }
          break;
        }
        case 'rekrut':
          if (s.provs[o.prov].ctrl !== c) break;
          if (totalTroops(s, c) + o.amount > manpowerCap(s, c)) break;
          {
            const prev = recruits.get(o.prov);
            recruits.set(o.prov, { amount: (prev?.amount ?? 0) + o.amount, owner: c, cost: (prev?.cost ?? 0) + cost });
          }
          me.treasury -= cost;
          break;
        case 'hangus': {
          const p = s.provs[o.prov];
          if (p.ctrl !== c) break;
          p.scorched = 4;
          p.infra = Math.max(0, p.infra - 2);
          p.factories = Math.max(0, p.factories - 1);
          if (p.owner === c) me.stability = Math.max(0, me.stability - 3);
          priv[c].push(`Bumi hangus di provinsi ${o.prov + 1}.`);
          break;
        }
        case 'udara':
          airZones.push({ owner: c, x: o.x, y: o.y, r: o.r });
          day0Events.push({ t: 'air', owner: c, x: o.x, y: o.y, r: o.r });
          me.treasury -= cost;
          break;
        case 'mata2':
          s.intel[c] = { target: o.target, turn: s.turn + 1, orders: (orders[o.target] ?? []).map((x) => ({ ...x })) };
          me.treasury -= cost;
          priv[c].push(`Agen kita menyusup ke ${name(o.target)}. Laporan intel siap di giliran berikutnya.`);
          break;
      }
    }
  }

  // ---------------- 3. columns ----------------
  const cols: Col[] = [];
  let colId = 1;
  const mkCol = (owner: number, path: number[], troops: number, kind: Col['kind'], stroke?: Pt[]): Col => {
    const amphib = path.slice(1).map((b, i) => isSeaStep(map, path[i], b));
    const col: Col = { id: colId++, owner, path, amphib, idx: 0, prog: 0, troops, init: troops, kind, fighting: false, battleDays: 0, gone: false, stroke };
    cols.push(col);
    if (amphib.some(Boolean)) day0Events.push({ t: 'amphib', owner, from: path[0], to: path[path.length - 1] });
    return col;
  };
  for (let c = 0; c < nC; c++) {
    if (!s.countries[c].alive) continue;
    for (const o of orders[c] ?? []) {
      if (o.kind !== 'serang' && o.kind !== 'gerak') continue;
      const src = s.provs[o.from];
      if (src.ctrl !== c || src.troops < 100 || o.path[0] !== o.from) continue;
      // path must still be legal
      let ok = true;
      for (let i = 1; i < o.path.length; i++) {
        const ctrl = s.provs[o.path[i]].ctrl;
        if (!allied(s, c, ctrl) && (o.kind === 'gerak' || !atWar(s, c, ctrl))) { ok = o.kind === 'serang' && i > 1 && atWar(s, c, ctrl); if (!ok) break; }
      }
      if (!ok) continue;
      const amt = Math.round(src.troops * o.frac);
      if (amt < 100) continue;
      src.troops -= amt;
      const stroke = Array.isArray(o.stroke) && o.stroke.length >= 2
        ? o.stroke.slice(0, 64).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y))
        : undefined;
      mkCol(c, o.path.slice(), amt, o.kind, stroke && stroke.length >= 2 ? stroke : undefined);
    }
    // defensive lines: even out troops along the line, then dig in
    for (const o of orders[c] ?? []) {
      if (o.kind !== 'bertahan') continue;
      const line = o.provs.filter((p) => s.provs[p].ctrl === c);
      if (line.length < 2) continue;
      for (const p of line) s.provs[p].entrenched = true;
      const total = line.reduce((a, p) => a + s.provs[p].troops, 0);
      const avg = total / line.length;
      let carry = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const cur = s.provs[line[i]].troops + carry;
        const surplus = cur - avg;
        carry = surplus;
        if (Math.abs(surplus) < 200) continue;
        const [a, b] = surplus > 0 ? [line[i], line[i + 1]] : [line[i + 1], line[i]];
        const path = findPath(map, s, c, a, b, { attack: false });
        if (!path) continue;
        const amt = Math.min(Math.round(Math.abs(surplus)), s.provs[a].troops);
        if (amt < 100) continue;
        s.provs[a].troops -= amt;
        mkCol(c, path, amt, 'gerak');
      }
    }
  }

  const frames: TickFrame[] = [];
  const snap = (day: number, events: SimEvent[]): TickFrame => ({
    day,
    cols: cols.map((c): ColSnap => ({
      id: c.id, owner: c.owner, path: c.path, amphib: c.amphib, idx: c.idx, prog: c.prog,
      troops: Math.round(c.troops), fighting: c.fighting, kind: c.kind, gone: c.gone || undefined, stroke: c.stroke,
    })),
    troops: s.provs.map((p) => Math.round(p.troops)),
    ctrl: s.provs.map((p) => p.ctrl),
    events,
  });
  frames.push(snap(0, day0Events));

  const supplied = s.countries.map((_, c) => supplyLevels(map, s, c));
  const airCovers = (owner: number, prov: number) =>
    airZones.some((z) => z.owner === owner && Math.hypot(P[prov].x - z.x, P[prov].y - z.y) < z.r + 20);
  const morale = (c: number) => 0.85 + 0.3 * (s.countries[c].stability / 100) - 0.15 * (s.countries[c].weariness / 100);
  const defEff = (q: number) => {
    const pq = s.provs[q], def = pq.ctrl;
    return Math.max(1, pq.troops) * (s.countries[def]?.quality ?? 1) * (s.countries[def] ? morale(def) : 1) *
      defenseMultiplier(map, s, q) * (supplied[def] ? supplyCombat(supplied[def][q]) : 1) * (airCovers(def, q) ? RULES.airBonus : 1);
  };
  const colEff = (c: Col, q: number, pincer = 1) =>
    c.troops * s.countries[c.owner].quality * morale(c.owner) * supplyCombat(supplied[c.owner][c.path[c.idx]]) *
    (c.amphib[c.idx] ? RULES.amphibPenalty : 1) * (airCovers(c.owner, q) ? RULES.airBonus : 1) * pincer;
  const capturedToday = new Set<number>();
  const guarded = new Set<string>();

  const merge = (col: Col, prov: number) => {
    if (col.gone) return;
    col.gone = true;
    col.fighting = false;
    const p = s.provs[prov];
    if (allied(s, col.owner, p.ctrl)) {
      if (p.ctrl === col.owner) p.troops += col.troops;
      else {
        // allied territory: hand back to nearest own province or keep as allied garrison
        p.troops += col.troops;
      }
    } else {
      // stranded in hostile land → lost
      casualties[col.owner] += col.troops;
    }
  };

  const retreatDefenders = (q: number, owner: number, survivors: number, attackers: Col[]): boolean => {
    const opts = P[q].neighbors.filter((n) => s.provs[n].ctrl === owner || allied(s, owner, s.provs[n].ctrl));
    const attackedFrom = new Set(attackers.map((a) => a.path[a.idx]));
    const safe = opts.filter((n) => !attackedFrom.has(n));
    const pick = (safe.length ? safe : opts).sort((a, b) => s.provs[b].troops - s.provs[a].troops)[0];
    if (pick === undefined || survivors < 50) return false;
    const col = mkCol(owner, [q, pick], survivors, 'mundur');
    col.prog = 0.1;
    return true;
  };

  /** Province q changes hands. Defenders fall back (or are trapped), events are logged at time `at`. */
  const captureProv = (q: number, winner: number, ex: number, ey: number, at: number, how: 'serbu' | 'lindas' | 'serap', atk: Col[], ev: SimEvent[]) => {
    const pq = s.provs[q];
    const def = pq.ctrl;
    const survivors = Math.round(pq.troops * (how === 'serbu' ? 0.8 : 0.9));
    if (pq.troops > 0 && s.countries[def]) casualties[def] += pq.troops - survivors;
    const escaped = survivors > 0 && retreatDefenders(q, def, survivors, atk);
    if (!escaped && survivors > 500) {
      ev.push({ t: 'moment', text: 'DIKEPUNG!', country: winner, x: P[q].x, y: P[q].y, kind: 'dikepung' });
      if (s.countries[def]) casualties[def] += survivors;
    }
    pq.troops = 0;
    pq.ctrl = winner;
    pq.integration = pq.owner === winner ? 1 : 0;
    if (s.countries[def]) provLost[def]++;
    capturedToday.add(q);
    captured.push({ prov: q, from: def, to: winner });
    ev.push({ t: 'capture', prov: q, from: def, to: winner, ex, ey, at, how });
    for (const c of atk) if (allied(s, c.owner, winner) && c.path[c.idx + 1] === q) c.fighting = false;
    const loser = s.countries[def];
    if (loser && loser.capital === q) {
      ev.push({ t: 'moment', text: 'IBU KOTA JATUH', country: winner, x: P[q].x, y: P[q].y, kind: 'ibukota' });
      news.push(`Ibu kota ${loser.name} jatuh ke tangan ${name(winner)}!`);
      relocateCapital(s, def);
      loser.stability = Math.max(0, loser.stability - 15);
      loser.weariness = Math.min(100, loser.weariness + 15);
      if (loser.capital < 0) {
        loser.exiled = true;
        news.push(`${loser.name} kini menjadi pemerintahan pengasingan.`);
      }
    }
  };

  /**
   * Weak or empty enemy land next to an advancing army falls without a set-piece battle:
   * provinces beside the axis of advance are swept up, and encircled pockets collapse.
   */
  const absorb = (ev: SimEvent[]) => {
    const near: Set<number>[] = s.countries.map(() => new Set());
    for (const c of cols) {
      if (c.gone || c.kind !== 'serang') continue;
      near[c.owner].add(c.path[c.idx]);
      if (c.prog >= 0.5 && c.path[c.idx + 1] !== undefined) near[c.owner].add(c.path[c.idx + 1]);
    }
    capturedToday.forEach((q) => near[s.provs[q].ctrl]?.add(q));
    const strength = (x: number, q: number) => {
      let t = 0;
      for (const n of P[q].neighbors) if (allied(s, x, s.provs[n].ctrl)) t += s.provs[n].troops;
      for (const c of cols) if (!c.gone && c.owner === x && P[q].neighbors.includes(c.path[c.idx])) t += c.troops;
      return t;
    };
    const taken = new Array(nC).fill(0);
    const cand: { q: number; x: number; score: number }[] = [];
    for (let q = 0; q < P.length; q++) {
      const d = s.provs[q].ctrl;
      if (capturedToday.has(q)) continue;
      for (let x = 0; x < nC; x++) {
        if (!s.countries[x].alive || !atWar(s, x, d)) continue;
        const nb = P[q].neighbors;
        const mine = nb.filter((n) => allied(s, x, s.provs[n].ctrl)).length;
        if (!mine) continue;
        const share = mine / nb.length;
        const active = nb.some((n) => near[x].has(n));
        const str = strength(x, q);
        const thr = Math.max(RULES.absorbMin, RULES.absorbShare * str);
        const pocket = share >= 0.8 && s.provs[q].troops <= str * 0.25;
        if (pocket || (active && s.provs[q].troops <= thr && (share >= 0.34 || s.provs[q].troops < 200))) {
          cand.push({ q, x, score: share + (pocket ? 1 : 0) - s.provs[q].troops / Math.max(1, thr) });
        }
      }
    }
    cand.sort((u, v) => v.score - u.score || u.q - v.q);
    for (const { q, x } of cand) {
      if (taken[x] >= RULES.absorbPerDay || capturedToday.has(q) || !atWar(s, x, s.provs[q].ctrl)) continue;
      const from = P[q].neighbors.filter((n) => allied(s, x, s.provs[n].ctrl)).sort((u, v) => s.provs[v].troops - s.provs[u].troops)[0];
      if (from === undefined) continue; // the neighbour it would come from changed hands earlier today
      const ex = (P[from].x + P[q].x) / 2, ey = (P[from].y + P[q].y) / 2;
      captureProv(q, x, ex, ey, 0.3 + 0.65 * rng.next(), 'serap', [], ev);
      taken[x]++;
    }
  };

  // ---------------- 4. day loop ----------------
  for (let day = 1; day <= RULES.daysPerTurn; day++) {
    const ev: SimEvent[] = [];
    capturedToday.clear();
    // a0. flank awareness: a marching army that passes an enemy on its side leaves a guard there
    for (const col of cols) {
      if (col.gone || col.fighting || col.kind === 'mundur' || col.troops < 6000) continue;
      const nxt = col.path[col.idx + 1];
      const cur = col.prog >= 0.5 && nxt !== undefined && s.provs[nxt].ctrl === col.owner ? nxt : col.path[col.idx];
      if (s.provs[cur].ctrl !== col.owner || guarded.has(col.id + ':' + cur)) continue;
      let threat = 0, toward = -1, worst = 0;
      for (const n of P[cur].neighbors) {
        if (col.path.includes(n) || !atWar(s, col.owner, s.provs[n].ctrl)) continue;
        let t = s.provs[n].troops;
        for (const e of cols) if (!e.gone && e.kind !== 'mundur' && e.path[e.idx] === n && e.path[e.idx + 1] === cur) t += e.troops;
        threat += t;
        if (t > worst) { worst = t; toward = n; }
      }
      // enemy columns already coming straight at this province from anywhere
      for (const e of cols) if (!e.gone && e.kind !== 'mundur' && atWar(s, col.owner, e.owner) && e.path[e.idx + 1] === cur && !P[cur].neighbors.includes(e.path[e.idx])) threat += e.troops;
      if (toward < 0 || threat < Math.max(3000, RULES.flankThreat * col.troops)) continue;
      const amt = Math.round(Math.min(col.troops * RULES.flankShare, threat * 0.6) / 100) * 100;
      if (amt < 1000) continue;
      guarded.add(col.id + ':' + cur);
      col.troops -= amt;
      col.init = Math.max(col.troops, col.init - amt);
      s.provs[cur].troops += amt;
      s.provs[cur].entrenched = true;
      ev.push({ t: 'detach', owner: col.owner, col: col.id, prov: cur, toward, troops: amt, at: 0.05 + 0.35 * rng.next() });
    }

    // a. movement
    for (const col of cols) {
      if (col.gone || col.fighting) continue;
      const a = col.path[col.idx], b = col.path[col.idx + 1];
      if (b === undefined) { merge(col, a); continue; }
      const tb = TERRAIN_INFO[P[b].terrain];
      let speed = RULES.marchSpeed * tb.speed * (1 + 0.08 * s.provs[b].infra);
      if (col.amphib[col.idx]) speed *= 0.7;
      if (col.kind === 'mundur') speed = 0.8;
      if (col.kind === 'gerak' && friendlyTo(s, col.owner, b)) speed *= 1.35;
      if (s.provs[b].scorched > 0 && !friendlyTo(s, col.owner, b)) speed *= 0.6;
      const hostile = !friendlyTo(s, col.owner, b) && col.kind !== 'mundur';
      let np = col.prog + speed;
      if (hostile && col.prog < 0.5 && np >= 0.5) {
        if (col.kind === 'serang' && atWar(s, col.owner, s.provs[b].ctrl)) {
          // overrun: a much stronger column sweeps through a weak garrison without stopping
          const at = Math.min(1, Math.max(0, (0.5 - col.prog) / Math.max(0.01, speed)));
          const de = defEff(b);
          if (s.provs[b].troops < 60 || colEff(col, b) >= RULES.overrunRatio * de) {
            const loss = Math.min(col.troops * 0.06, de * RULES.lanchesterK * 2);
            col.troops -= loss;
            casualties[col.owner] += loss;
            const pa = P[a], pb = P[b];
            if (s.provs[b].troops >= 60) ev.push({ t: 'battle', prov: b, x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, atk: [col.owner], def: s.provs[b].ctrl, size: col.troops + s.provs[b].troops, lossA: loss, lossD: s.provs[b].troops, at });
            captureProv(b, col.owner, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, at, s.provs[b].troops < 60 ? 'lindas' : 'serbu', [col], ev);
            col.prog = Math.min(0.95, col.prog + speed * 0.8);
            continue;
          }
          col.prog = 0.5;
          col.fighting = true;
          col.battleDays = 0;
        } else {
          col.prog = 0.45;
          merge(col, a);
        }
        continue;
      }
      if (np >= 1) {
        col.idx++;
        np = Math.min(np - 1, 0.45);
        col.prog = np;
        if (col.idx >= col.path.length - 1) { merge(col, col.path[col.idx]); continue; }
        if (!friendlyTo(s, col.owner, col.path[col.idx]) && col.kind !== 'mundur') {
          // province flipped under us: fight for it from the border
          col.idx--;
          col.prog = 0.5;
          if (atWar(s, col.owner, s.provs[col.path[col.idx + 1]].ctrl)) col.fighting = true;
          else merge(col, col.path[col.idx]);
        }
      } else col.prog = np;
    }

    // b. meeting engagements (head-on collisions between enemy columns)
    for (let i = 0; i < cols.length; i++) {
      const A = cols[i];
      if (A.gone || A.fighting || A.kind === 'mundur') continue;
      for (let j = i + 1; j < cols.length; j++) {
        const B = cols[j];
        if (B.gone || B.fighting || B.kind === 'mundur' || !atWar(s, A.owner, B.owner)) continue;
        const a0 = A.path[A.idx], a1 = A.path[A.idx + 1], b0 = B.path[B.idx], b1 = B.path[B.idx + 1];
        if (!(a0 === b1 && a1 === b0 && A.prog + B.prog >= 0.95)) continue;
        const ea = A.troops * s.countries[A.owner].quality * morale(A.owner);
        const eb = B.troops * s.countries[B.owner].quality * morale(B.owner);
        const la = Math.min(A.troops * 0.6, RULES.lanchesterK * 2.5 * eb * (A.troops / ea));
        const lb = Math.min(B.troops * 0.6, RULES.lanchesterK * 2.5 * ea * (B.troops / eb));
        A.troops -= la; B.troops -= lb;
        casualties[A.owner] += la; casualties[B.owner] += lb;
        const mx = (P[a0].x + P[a1].x) / 2, my = (P[a0].y + P[a1].y) / 2;
        ev.push({ t: 'battle', prov: a1, x: mx, y: my, atk: [A.owner], def: B.owner, size: A.troops + B.troops, lossA: la, lossD: lb, at: 0.5 });
        const loser = ea * (A.troops / (A.troops + la)) >= eb * (B.troops / (B.troops + lb)) ? B : A;
        const winner = loser === A ? B : A;
        loser.kind = 'mundur';
        loser.path = [loser.path[loser.idx + 1], loser.path[loser.idx]];
        loser.idx = 0;
        loser.prog = 1 - loser.prog;
        loser.amphib = [false];
        winner.prog = Math.min(winner.prog, 0.49);
        if (loser.troops > 20000) ev.push({ t: 'moment', text: 'GAGAL', country: loser.owner, x: mx, y: my, kind: 'gagal' });
      }
    }

    // c. province battles
    const byTarget = new Map<number, Col[]>();
    for (const col of cols) {
      if (col.gone || !col.fighting) continue;
      const q = col.path[col.idx + 1];
      if (!byTarget.has(q)) byTarget.set(q, []);
      byTarget.get(q)!.push(col);
    }
    const targets = [...byTarget.keys()].sort((a, b) => a - b);
    for (const q of targets) {
      const pq = s.provs[q];
      const def = pq.ctrl;
      const atk = byTarget.get(q)!.filter((c) => {
        if (atWar(s, c.owner, def)) return true;
        if (allied(s, c.owner, def)) { c.fighting = false; return false; }
        merge(c, c.path[c.idx]);
        return false;
      });
      if (!atk.length) continue;
      for (const c of atk) c.battleDays++;
      const sources = new Set(atk.map((c) => c.path[c.idx]));
      const pincer = sources.size >= 2 ? RULES.pincerBonus : 1;
      const A = atk.reduce((a, c) => a + c.troops, 0);
      let Aeff = atk.reduce((a, c) => a + colEff(c, q, pincer) * (c.battleDays <= 2 ? RULES.attackInitiative : 1), 0);
      const D = pq.troops;
      const Deff = defEff(q) * (!pq.entrenched && pq.fort === 0 ? RULES.unpreparedDefense : 1);
      let lossA = Math.min(A * 0.5, (RULES.lanchesterK * Deff * A) / Math.max(1, Aeff));
      let lossD = Math.min(D, (RULES.lanchesterK * Aeff * Math.max(1, D)) / Deff);
      if (atk.some((c) => airCovers(c.owner, q))) lossD = Math.min(D, lossD * 1.15);
      if (D <= 0) { lossA = 0; lossD = 0; }
      for (const c of atk) {
        const l = (lossA * c.troops) / Math.max(1, A);
        c.troops -= l;
        casualties[c.owner] += l;
      }
      pq.troops = Math.max(0, D - lossD);
      if (s.countries[def]) casualties[def] += lossD;
      const main = atk.reduce((a, b) => (b.troops > a.troops ? b : a));
      const src = P[main.path[main.idx]];
      const bx = (src.x + P[q].x) / 2, by = (src.y + P[q].y) / 2;
      const at = 0.15 + 0.6 * rng.next();
      if (D > 0) ev.push({ t: 'battle', prov: q, x: bx, y: by, atk: [...new Set(atk.map((c) => c.owner))], def, size: A + D, lossA, lossD, at });

      const A2 = atk.reduce((a, c) => a + c.troops, 0);
      Aeff = Aeff * (A2 / Math.max(1, A));
      const Deff2 = Deff * (pq.troops / Math.max(1, D));
      if (pq.troops < 60 || Aeff / Math.max(1, Deff2) >= RULES.breakRatio) {
        // ---- breakthrough ----
        const winner = main.owner;
        const wasCapital = s.countries[def]?.capital === q;
        captureProv(q, winner, bx, by, Math.min(0.95, at + 0.2), 'serbu', atk, ev);
        if (!wasCapital && main.init > 30000 && main.path.length > 2 && main.idx === 0) {
          ev.push({ t: 'moment', text: 'TEROBOSAN!', country: winner, x: P[q].x, y: P[q].y, kind: 'terobosan' });
        }
      } else {
        // ---- attackers may give up ----
        const ratio = Aeff / Math.max(1, Deff2);
        let failedBig = false;
        for (const c of atk) {
          if (ratio < RULES.attackerGiveUp || c.troops < 0.4 * c.init || c.battleDays >= 6) {
            if (c.init > 25000) failedBig = true;
            c.fighting = false;
            c.kind = 'mundur';
            c.path = [q, c.path[c.idx]];
            c.amphib = [false];
            c.idx = 0;
            c.prog = 0.5;
          }
        }
        if (failedBig) ev.push({ t: 'moment', text: 'SERANGAN GAGAL', country: def, x: P[q].x, y: P[q].y, kind: 'gagal' });
      }
    }
    absorb(ev);
    frames.push(snap(day, ev));
  }

  // land everyone where they stand
  for (const col of cols) {
    if (col.gone) continue;
    const a = col.path[col.idx], b = col.path[col.idx + 1];
    if (col.kind === 'mundur') merge(col, col.prog >= 0.5 && b !== undefined && friendlyTo(s, col.owner, b) ? b : friendlyTo(s, col.owner, a) ? a : b ?? a);
    else if (col.prog >= 0.5 && b !== undefined && friendlyTo(s, col.owner, b)) merge(col, b);
    else merge(col, a);
  }
  const last = frames[frames.length - 1];
  last.troops = s.provs.map((p) => Math.round(p.troops));
  last.cols = last.cols.map((c) => ({ ...c, gone: true }));

  // ---------------- 5. end of turn ----------------
  // supply attrition + overcrowding (troops above what a province can feed)
  const endSupply: Uint8Array[] = s.countries.map((_, c) => supplyLevels(map, s, c));
  for (let c = 0; c < nC; c++) {
    const me = s.countries[c];
    if (!me.alive) continue;
    const sup = endSupply[c];
    let cut = 0, stretched = 0, crowded = 0, crowdLoss = 0;
    s.provs.forEach((p, i) => {
      if (p.ctrl !== c || p.troops <= 0) return;
      let l = 0;
      if (sup[i] === SUPPLY_CUT) { l = p.troops * RULES.unsuppliedAttrition; cut++; }
      else if (sup[i] === SUPPLY_STRETCHED) { l = p.troops * RULES.stretchedAttrition; stretched++; }
      const cap = stackCap(map, s, i);
      if (p.troops - l > cap) {
        const over = (p.troops - l - cap) * RULES.overStackLoss;
        l += over;
        crowdLoss += over;
        crowded++;
      }
      p.troops -= l;
      casualties[c] += l;
    });
    if (cut) priv[c].push(`${cut} provinsi terputus dari suplai — pasukan di sana melemah 10%/minggu.`);
    if (stretched) priv[c].push(`${stretched} provinsi di ujung jalur suplai — pasukan melemah 4%/minggu dan tempur −18%. Bangun jalan/rel atau rebut kota.`);
    if (crowded) priv[c].push(`${crowded} provinsi kelebihan pasukan — ${fmtInt(crowdLoss)} tentara hilang karena logistik tak sanggup. Sebarkan pasukan.`);
  }
  // fresh recruits arrive after attrition; refund if the province fell
  recruits.forEach((r, p) => {
    if (s.provs[p].ctrl === r.owner && s.provs[p].owner === r.owner) s.provs[p].troops += r.amount;
    else {
      s.countries[r.owner].treasury += r.cost;
      priv[r.owner].push(`Rekrutmen di provinsi ${p + 1} batal karena wilayahnya jatuh — kas dikembalikan.`);
    }
  });

  s.provs.forEach((p) => {
    if (p.ctrl !== p.owner) {
      p.integration = Math.min(1, p.integration + RULES.integrationPerTurn * 0.5);
      if (p.integration < 0.5 && s.countries[p.owner]?.alive && atWar(s, p.owner, p.ctrl)) p.troops *= 0.98; // partisans
    } else if (p.integration < 1) p.integration = Math.min(1, p.integration + RULES.integrationPerTurn);
    if (p.scorched > 0) p.scorched--;
    const job = p.queue[0];
    if (job) {
      job.left--;
      if (job.left <= 0) {
        p.queue.shift();
        switch (job.kind) {
          case 'pabrik': p.factories++; break;
          case 'pabrikMil': p.milFactories++; break;
          case 'benteng': p.fort = Math.min(3, p.fort + 1); break;
          case 'pelabuhan': p.port = true; break;
          case 'kota': p.urban = Math.min(3, p.urban + 1); p.pop = Math.round(p.pop * 1.15); break;
          case 'jalan': p.infra = Math.min(5, p.infra + 1); break;
        }
      }
    }
  });

  // economy
  const gdps = s.countries.map((_, c) => countryGdp(s, c));
  for (let c = 0; c < nC; c++) {
    const me = s.countries[c];
    if (!me.alive) continue;
    const partners = s.rel[c].filter((r, k) => k !== c && r.trade && r.status !== 'perang').length;
    const income = gdps[c] * 3 * (1 + 0.05 * partners);
    const troops = totalTroops(s, c);
    const upkeep = (troops / 1000) * 0.15;
    const net = income - upkeep;
    const auto = Math.max(0, net * 0.5);
    me.treasury += net - auto;
    me.lastIncome = Math.round(net);
    const b = me.budget;
    const milFactories = s.provs.reduce((a, p) => a + (p.ctrl === c ? p.milFactories : 0), 0);
    // military budget → automatic reinforcement
    const cap = manpowerCap(s, c);
    let reinforce = ((auto * b.mil) / 100 / RULES.recruitCostPer1000) * 1000 + milFactories * 600;
    reinforce = Math.max(0, Math.min(reinforce, cap - troops));
    if (reinforce > 0) {
      // reinforcements only go where there is supply and room to feed them
      const sup = endSupply[c];
      const room = s.provs.map((p, i) => (p.ctrl === c && sup[i] > SUPPLY_CUT ? Math.max(0, stackCap(map, s, i) * RULES.garrisonFill - p.troops) : 0));
      const tot = room.reduce((x, y) => x + y, 0);
      reinforce = Math.min(reinforce, tot);
      if (tot > 0) room.forEach((h, i) => { if (h) s.provs[i].troops += (reinforce * h) / tot; });
    }
    // civil budget → stability & growth
    me.stability += (b.civ - 30) / 25;
    s.provs.forEach((p) => { if (p.owner === c && p.ctrl === c) p.pop *= 1 + 0.0006 * (b.civ / 40); });
    // research
    if (me.quality < RULES.qualityCap) {
      me.researchPts += (auto * b.res) / 100;
      const need = 120 * me.quality * me.quality;
      if (me.researchPts >= need) {
        me.researchPts -= need;
        me.quality = Math.min(RULES.qualityCap, Math.round((me.quality + 0.05) * 100) / 100);
        priv[c].push(`Riset selesai: kualitas peralatan naik menjadi ${Math.round(me.quality * 100)}%.`);
      }
    } else me.researchPts = 0;
    if (me.treasury < 0) me.stability -= 4;
    // weariness & stability
    const pop = Math.max(1, totalPop(s, c) * 1000);
    const wars = s.rel[c].filter((r, k) => k !== c && r.status === 'perang' && s.countries[k].alive).length;
    const wGain = (casualties[c] / pop) * 600 + provLost[c] * 1.2;
    me.weariness = Math.max(0, Math.min(100, me.weariness + wGain * (me.gov === 'demokrasi' ? 1.3 : 1) - (wars ? 0.3 : 3)));
    const overMob = troops / pop > RULES.mobilizationSoft ? 6 : 0;
    const target = 62 + (b.civ - 30) / 2 - me.weariness * 0.45 - overMob + (me.gov === 'otoriter' ? 5 : 0);
    me.stability += (target - me.stability) * 0.12;
    me.stability = Math.max(0, Math.min(100, me.stability));
    me.casualties += casualties[c];
    if (casualties[c] > 0) priv[c].push(`Korban minggu ini: ${fmtInt(casualties[c])} jiwa.`);
    // coup risk
    if (me.gov === 'otoriter' && me.stability < 12 && rng.chance(0.25)) {
      me.stability = 35;
      me.weariness = Math.max(0, me.weariness - 20);
      me.treasury -= 100;
      news.push(`KUDETA di ${me.name}! Junta baru mengambil alih.`);
    }
    // random event
    if (!me.pendingEvent && me.kind !== 'minor' && rng.chance(0.1)) {
      me.pendingEvent = rollEvent(map, s, c, rng);
    }
  }

  // relations drift
  for (let a = 0; a < nC; a++)
    for (let b = 0; b < nC; b++) {
      if (a === b) continue;
      const r = s.rel[a][b];
      if (r.truce > 0) r.truce--;
      if (r.status === 'perang') r.value = Math.max(-100, r.value - 1);
      else r.value += r.value < 0 ? 1 : r.trade ? 0.5 : 0;
    }

  // deaths
  for (const k of s.countries) {
    if (!k.alive) continue;
    const owned = s.provs.some((p) => p.ctrl === k.id);
    if (!owned) {
      k.alive = false;
      news.push(`${k.name} runtuh dan lenyap dari peta.`);
      // end wars with the dead
      for (let o = 0; o < nC; o++) { s.rel[k.id][o].status = 'damai'; s.rel[o][k.id].status = 'damai'; }
    } else if (k.capital < 0 || s.provs[k.capital].ctrl !== k.id) relocateCapital(s, k.id);
  }

  {
    let nb = 0;
    const where = new Set<number>();
    for (const f of frames) for (const e of f.events) if (e.t === 'battle') { nb++; where.add(e.prov); }
    const total = casualties.reduce((a, b) => a + b, 0);
    if (nb > 0) news.push(`Pertempuran sengit di ${where.size} titik garis depan — sekitar ${fmtInt(Math.round(total / 1000) * 1000)} korban.`);
  }
  if (captured.length) {
    const byWinner = new Map<number, number>();
    for (const c of captured) byWinner.set(c.to, (byWinner.get(c.to) ?? 0) + 1);
    byWinner.forEach((n, c) => news.push(`${name(c)} merebut ${n} provinsi.`));
  }

  s.stats.push({
    turn: s.turn,
    gdp: gdps.map((g) => Math.round(g * 10) / 10),
    troops: s.countries.map((_, c) => Math.round(totalTroops(s, c))),
    provs: s.countries.map((_, c) => s.provs.filter((p) => p.ctrl === c).length),
  });
  if (s.stats.length > 60) s.stats.shift();

  checkVictory(s, gdps, news);
  s.news = news;
  s.privateNews = priv;
  s.turn++;
  s.rng = rng.state;
  for (const p of s.provs) p.troops = Math.round(p.troops);
  return { state: s, res: { frames, casualties: casualties.map(Math.round), captured } };
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}

function validProposal(s: GameState, p: Proposal): boolean {
  const r = s.rel[p.from][p.to];
  if (!s.countries[p.from].alive || !s.countries[p.to].alive) return false;
  switch (p.kind) {
    case 'damai': return r.status === 'perang';
    case 'aliansi': return r.status !== 'perang' && r.status !== 'aliansi';
    case 'nap': return r.status === 'damai';
    case 'dagang': return r.status !== 'perang' && !r.trade;
  }
}

function relocateCapital(s: GameState, c: number) {
  let best = -1, bp = -1;
  s.provs.forEach((p, i) => {
    if (p.ctrl === c && p.owner === c && p.pop * (1 + p.urban) > bp) { bp = p.pop * (1 + p.urban); best = i; }
  });
  if (best < 0) s.provs.forEach((p, i) => { if (p.ctrl === c && p.pop > bp) { bp = p.pop; best = i; } });
  s.countries[c].capital = best;
}

export function scoreOf(s: GameState, c: number, gdp: number): number {
  const provs = s.provs.filter((p) => p.ctrl === c).length;
  const k = s.countries[c];
  return Math.round(provs * 10 + gdp * 4 + k.stability + totalTroops(s, c) / 20000 + k.reputation / 5);
}

/** Population share needed for a domination win: 60% with 2 great powers, less with more rivals. */
export function dominationShare(majors: number): number {
  return Math.min(0.6, 0.25 + 0.7 / Math.max(2, majors));
}

function checkVictory(s: GameState, gdps: number[], news: string[]) {
  if (s.winner) return;
  const majors = s.countries.filter((k) => k.kind !== 'minor');
  const alive = majors.filter((k) => k.alive);
  const v = s.settings.victory;
  if (alive.length === 1 && majors.length > 1) {
    s.winner = { country: alive[0].id, cond: 'Satu-satunya kekuatan besar yang bertahan' };
  }
  const worldPop = s.provs.reduce((a, p) => a + p.pop, 0);
  const worldGdp = gdps.reduce((a, b) => a + b, 0);
  for (const k of alive) {
    if (s.winner) break;
    if (v.dominasi) {
      const pop = s.provs.reduce((a, p) => a + (p.ctrl === k.id ? p.pop : 0), 0);
      const allCaps = majors.filter((o) => o.id !== k.id).every((o) => s.provs[o.homeCapital].ctrl === k.id);
      const need = dominationShare(majors.length);
      if (pop / worldPop >= need) s.winner = { country: k.id, cond: `Dominasi: menguasai ${Math.round(need * 100)}% populasi dunia` };
      else if (allCaps && majors.length > 1) s.winner = { country: k.id, cond: 'Dominasi: menguasai semua ibu kota lawan' };
    }
    if (!s.winner && v.ekonomi) {
      if (gdps[k.id] / Math.max(1, worldGdp) >= 0.4) k.econStreak++;
      else k.econStreak = 0;
      if (k.econStreak >= 12) s.winner = { country: k.id, cond: 'Ekonomi: 40% PDB dunia selama 12 giliran' };
    }
  }
  if (!s.winner && v.skor && s.turn >= v.turnLimit) {
    let best = alive[0], bs = -Infinity;
    for (const k of alive) {
      const sc = scoreOf(s, k.id, gdps[k.id]);
      if (sc > bs) { bs = sc; best = k; }
    }
    if (best) s.winner = { country: best.id, cond: `Skor tertinggi saat batas giliran (${bs})` };
  }
  if (s.winner) news.unshift(`${s.countries[s.winner.country].name} MENANG — ${s.winner.cond}`);
}
