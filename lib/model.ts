// Launch Radar model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// Method, in one paragraph: the board ranks only protocols that record no token
// (no market cap, no CoinGecko id, no symbol) and are not a wrapped, staked,
// bridged or exchange product of something that already trades. Each survivor
// is valued from the snapshot's own comparables: the protocols in the same
// snapshot whose tokens DO trade imply a market-cap-to-TVL multiple for their
// category, and a pre-token protocol is worth its category's (shrunk) median
// multiple applied to a sublinear function of its own TVL, then adjusted for
// its 7-day TVL growth, how long it has run tokenless, and its chain breadth.
// No protocol name is ever special-cased: one function scores every row, and
// the dashboard restates the same arithmetic so a reader can check any row.
//
// Board scope: every watchlist slug (the floor) plus every other clean
// pre-token protocol the snapshot carries (TVL at or above $5,000,000, the
// snapshot's own minimum). Token-bearing protocols are never ranked; the
// largest of them are listed separately as the comparables set.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'launch-radar-2';

/** Tunable constants of the valuation; the dashboard prints them verbatim. */
export interface ModelConstants {
  /** Exponent on TVL: below 1, so a 10x larger protocol is worth less than 10x more. */
  tvl_exponent: number;
  /** TVL at which the sublinear curve passes through multiple x TVL unchanged. */
  tvl_anchor_usd: number;
  /** Prior strength when shrinking a category median toward the global median. */
  shrink_k: number;
  mult_floor: number;
  mult_cap: number;
  /** Weight on positive 7-day growth: a hot week is weak evidence of launch value. */
  growth_weight: number;
  /** Weight on negative 7-day growth: shrinking TVL is stronger evidence, so it costs more. */
  growth_down_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Bonus per extra chain beyond the first, capped. */
  breadth_per_chain: number;
  breadth_max_chains: number;
  range_low_factor: number;
  range_high_factor: number;
}

export const MODEL: ModelConstants = {
  tvl_exponent: 0.88,
  tvl_anchor_usd: 100_000_000,
  shrink_k: 4,
  mult_floor: 0.02,
  mult_cap: 2.5,
  growth_weight: 0.3,
  growth_down_weight: 0.5,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1825,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
  range_low_factor: 0.45,
  range_high_factor: 2.2,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  readiness: number;
  tier: 'A' | 'B' | 'C';
  confidence: 'high' | 'medium' | 'low';
  model: {
    category_multiple: number;
    comparables: number;
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row itself, farm plan included. */
export type RadarRow = BoardRow;

/** A token-bearing protocol, shown only as a comparable, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  change_7d: number | null;
}

/** One category's comparables summary, printed on the dashboard. */
export interface CategoryStat {
  category: string;
  comparables: number;
  median_multiple: number;
  used_multiple: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_multiple: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Whole days from listed_at to as_of; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a wrapped, staked, bridged or exchange product of a
 * token that already trades: the watchlist's own exclusion rule, applied at
 * every size, not only above the floor.
 */
export function isWrappedOrExchange(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** Whether the board may rank a protocol: records no token, not a versioned pool, not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !isWrappedOrExchange(p);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Category multiples derived from the snapshot's own token-bearing protocols. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryStat> } {
  const all: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const m = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(m) || m <= 0) continue;
    all.push(m);
    const key = p.category ?? 'Uncategorized';
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryStat>();
  for (const [category, values] of groups) {
    const med = median(values);
    const used = clamp((values.length * med + model.shrink_k * global) / (values.length + model.shrink_k), model.mult_floor, model.mult_cap);
    byCategory.set(category, { category, comparables: values.length, median_multiple: round4(med), used_multiple: round4(used) });
  }
  return { global, byCategory };
}

/** The multiple one protocol is valued at: its category's shrunk median, or the global median. */
function multipleFor(p: SnapshotProtocol, stats: { global: number; byCategory: Map<string, CategoryStat> }, model: ModelConstants): { multiple: number; comparables: number } {
  const stat = p.category !== null ? stats.byCategory.get(p.category) : undefined;
  if (stat !== undefined) return { multiple: stat.used_multiple, comparables: stat.comparables };
  return { multiple: clamp(stats.global, model.mult_floor, model.mult_cap), comparables: 0 };
}

/** Every factor of one protocol's implied value, so the dashboard can show the working. */
export interface Valuation {
  implied: number;
  multiple: number;
  comparables: number;
  growthPct: number | null;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, stats: { global: number; byCategory: Map<string, CategoryStat> }, model: ModelConstants = MODEL): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, comparables } = multipleFor(p, stats, model);
  const base = multiple * Math.pow(Math.max(p.tvl_usd, 1), model.tvl_exponent) * Math.pow(model.tvl_anchor_usd, 1 - model.tvl_exponent);
  const growthPct = p.change_7d === null ? null : clamp(p.change_7d, model.growth_floor_pct, model.growth_cap_pct);
  const g = growthPct ?? 0;
  const growthMult = 1 + (g / 100) * (g >= 0 ? model.growth_weight : model.growth_down_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * Math.min(1, Math.log1p(Math.max(ageForModel, 0)) / Math.log1p(model.maturity_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, multiple, comparables, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** Launch-readiness 0..100: size, momentum, seasoning and breadth, from the snapshot only. */
export function readinessScore(p: SnapshotProtocol, age: number | null): number {
  const size = clamp(Math.log10(Math.max(p.tvl_usd, 1) / 5_000_000) / Math.log10(2000), 0, 1) * 40;
  const growth = p.change_7d === null ? 10 : clamp((clamp(p.change_7d, -20, 40) + 20) / 60, 0, 1) * 25;
  const season = clamp(Math.log1p(age ?? 180) / Math.log1p(1825), 0, 1) * 20;
  const breadth = clamp(p.chains.length / 6, 0, 1) * 15;
  return Math.round(size + growth + season + breadth);
}

export function tierFor(readiness: number): 'A' | 'B' | 'C' {
  if (readiness >= 62) return 'A';
  if (readiness >= 42) return 'B';
  return 'C';
}

export function confidenceFor(p: SnapshotProtocol, age: number | null, comparables: number): 'high' | 'medium' | 'low' {
  let points = 0;
  if (p.change_7d !== null) points++;
  if (age !== null) points++;
  if (comparables >= 3) points++;
  if (p.tvl_usd >= 50_000_000) points++;
  if (points >= 4) return 'high';
  if (points >= 2) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page weekly.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical all-in gas for one transaction on the protocol's first chain. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 'about $0.05 of network fees';
  if (c === 'ethereum') return 'about $6 of gas at typical fees';
  if (c.includes('bitcoin')) return 'about $2 of network fees';
  return 'about $0.40 of gas on this chain';
}

/** Starter capital for one qualifying position, scaled to the protocol's TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Hold length: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay once, so both sides of the market record your wallet.`;
  if (c.includes('dex')) return `Swap about $${Math.max(25, Math.round(capital / 4))} on ${name} on ${chain}, then provide the remaining $${capital} as liquidity in its main pool and keep the position open.`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet for the full hold.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a week so volume and open interest both count.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an active market, letting it settle rather than selling out early.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} through its own app and hold the asset in the farming wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it rather than looping it elsewhere.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name} on ${chain} using its standard flow and keep the balance for the full hold.`;
  if (c.includes('launchpad')) return `Commit $${capital} to one live sale or pool on ${name} on ${chain} and keep any allocation in the same wallet.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain} and make your weekly transactions there with ${name} as the entry point, keeping a working balance on the chain.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open for the full hold.`;
}

/**
 * A protocol's farm plan: six concrete steps with costs and times, derived
 * from its own record (category, chains, TVL, age), never a name list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Open ${p.name} only from the link on its official DefiLlama page, and set up a fresh wallet that holds only the funds you plan to farm with.`,
      cost: 'nothing to open; never pay anyone to claim a future token',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one small qualifying action on ${p.name} every week (a deposit, swap, borrow or vote) so the wallet appears in at least ${Math.max(4, Math.floor(hold / 7))} separate weekly snapshots.`,
      cost: `${gas} per weekly action`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days without moving it to another wallet, because airdrop snapshots usually reward age and continuity over size.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points, rewards or governance page every week and complete any free quest it publishes there; claim only from links that page itself publishes.`,
      cost: 'no fee to check; gas only if you claim on chain',
      time: '10 minutes a week',
    },
    {
      text: `Log the wallet, every date, amount and transaction hash in a farm sheet, and set a reminder to unwind the $${capital} position if no token or points program appears within 90 days.`,
      cost: 'nothing but the log',
      time: '5 minutes, then 90-day review',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly ordered values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const stats = categoryMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, stats, model);
    const readiness = readinessScore(p, v.age);
    return { p, v, readiness };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < scored.length; i++) {
    const { p, v, readiness } = scored[i]!;
    let implied = v.implied;
    if (implied >= previous) implied = Math.max(1, previous - 1);
    previous = implied;
    rows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: v.age,
      token_status: 'pre-token',
      on_watchlist: watch.has(p.slug),
      implied_value_usd: implied,
      implied_low_usd: Math.max(1, Math.round(implied * model.range_low_factor)),
      implied_high_usd: Math.round(implied * model.range_high_factor),
      readiness,
      tier: tierFor(readiness),
      confidence: confidenceFor(p, v.age, v.comparables),
      model: {
        category_multiple: v.multiple,
        comparables: v.comparables,
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        maturity_multiplier: round4(v.maturityMult),
        breadth_multiplier: round4(v.breadthMult),
      },
      farm_steps: farmSteps(p, v.age).map(stepText),
    });
  }
  return rows;
}

/** How many token-bearing comparables the dashboard lists, by market cap. */
export const LIVE_ROWS = 24;

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const stats = categoryMultiples(snapshot, model);
  const categories = [...stats.byCategory.values()].sort((a, b) => b.comparables - a.comparables || (a.category < b.category ? -1 : 1)).slice(0, 14);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    global_median_multiple: round4(stats.global),
    categories,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row minimum`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
