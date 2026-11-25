// Token Launch Radar — model radar-2. One snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every pre-token protocol below the watchlist floor that is not itself a wrapped, staked or
// bridged product of a token that already trades. A protocol is pre-token when its record carries
// no token (no market cap, no CoinGecko id, no symbol); the live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through one function:
//
//   multiple(cat) = shrunk median mcap_usd/tvl_usd of the token-bearing protocols in that
//                   category, blended toward the overall median when the category has few
//                   token-bearing protocols, clamped to [0.02, 1.5]
//   growth        = 1 + clamp(change_7d, -50, 100) / 200        (null change: 1)
//   age           = 1 + min(years since listed_at to as_of, 4) * 0.08   (null listed_at: 1)
//   implied       = round(tvl_usd * multiple(cat) * growth * age), capped at 1e14
//
// The multiple is the market's own pricing of a category: Dexs trade near 0.31x TVL, Lending
// near 0.14x, RWA near 0.26x in this snapshot, while the overall median is 0.205x. A category
// with one or two token-bearing protocols is shrunk hard toward that overall median, because a
// single protocol's ratio is not a category's price. No protocol name is ever special-cased:
// the same function scores every row, and the dashboard recomputes each row from the same
// figures and checks the number board.json carries.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_divisor: number;
  age_per_year: number;
  age_years_cap: number;
  multiple_shrink: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 100,
  growth_divisor: 200,
  age_per_year: 0.08,
  age_years_cap: 4,
  multiple_shrink: 3,
  multiple_min: 0.02,
  multiple_max: 1.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/**
 * The dashboard's compact view of one row, as a positional array so data.js stays small:
 * [rank, slug, name, categoryIndex, chainIndexes, tvl_usd, change_7d, age_days, implied_value_usd]
 * change_7d null stays null, age_days null is -1, chainIndexes holds at most 3 chains.
 */
export type RadarRow = [number, string, string, number, number[], number, number | null, number, number];

/** A live-token protocol, compact: [name, categoryIndex, chainIndexes, tvl_usd, mcap_usd, change_7d]. */
export type LiveRow = [string, number, number[], number, number | null, number | null];

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: string[];
  chains: string[];
  /** Category multiple per category index, at full precision: the page recomputes each row's implied value to the same whole dollar board.json carries. */
  multiples: number[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The category multiples, from the token-bearing protocols alone: for each category, the
 * median mcap_usd/tvl_usd of its token-bearing protocols with tvl and mcap above zero,
 * shrunk toward the overall median by `multiple_shrink` pseudo-observations and clamped.
 * Categories with no token-bearing protocol get the overall median.
 */
export function categoryMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): { overall: number; byCategory: Map<string, number> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.gecko_id === null && p.symbol === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    all.push(r);
    const key = p.category ?? 'Other';
    const arr = byCat.get(key);
    if (arr) arr.push(r);
    else byCat.set(key, [r]);
  }
  const overall = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [cat, values] of byCat) {
    const m = median(values);
    const shrunk = (values.length * m + model.multiple_shrink * overall) / (values.length + model.multiple_shrink);
    byCategory.set(cat, Math.min(model.multiple_max, Math.max(model.multiple_min, shrunk)));
  }
  return { overall, byCategory };
}

function multipleFor(p: SnapshotProtocol, multiples: { overall: number; byCategory: Map<string, number> }, model: ModelConstants): number {
  const key = p.category ?? 'Other';
  const m = multiples.byCategory.get(key);
  if (m !== undefined) return m;
  return Math.min(model.multiple_max, Math.max(model.multiple_min, multiples.overall));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { overall: number; byCategory: Map<string, number> },
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; ageMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + growthPct / model.growth_divisor;
  const years = age === null ? 0 : Math.min(age / 365, model.age_years_cap);
  const ageMult = 1 + years * model.age_per_year;
  const multiple = multipleFor(protocol, multiples, model);
  const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(protocol.tvl_usd * multiple * growthMult * ageMult)));
  return { implied, multiple, growthPct, growthMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are themselves a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Exchange names: a protocol beginning with one is the exchange's own product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, bridge, wrapped or staked product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  const cat = p.category ?? '';
  if (EXCLUDED_CATEGORIES.has(cat) || /bridge/i.test(cat)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot.protocols, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names. It cannot be gambled on a missing record.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the watchlist floor that is rankable,
  // not just the largest 160 by TVL. The pool is what the snapshot holds; padding it with
  // bridges, exchanges and wrapped products would rank launches that are not launches.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: Math.round(s.multiple * 10000) / 10000,
      growth_pct: s.growthPct,
      growth_multiplier: Math.round(s.growthMult * 10000) / 10000,
      age_multiplier: Math.round(s.ageMult * 10000) / 10000,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for a first transaction on a chain, in the words the plan uses. */
function gasFor(chain: string): string {
  const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos'];
  return cheap.includes(chain) ? 'under $1 of gas' : 'about $3-8 of gas';
}

/**
 * A protocol's farm plan: five or six steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Eight templates cover the categories the board holds; each
 * template's steps name the protocol, its main chain and the capital, and say what each step
 * costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const name = p.name;
  const c = (p.category ?? '').toLowerCase();
  const setup: FarmStep = {
    text: `Open a fresh wallet, fund it with $${capital + 20} of USDC on ${chain}, and keep its seed phrase offline.`,
    cost: `${gas} to fund it`,
    time: '10 minutes',
  };
  const weekly = (action: string): FarmStep => ({
    text: `Once a week, ${action} on ${name} so the wallet stays active in more than one snapshot.`,
    cost: 'about $2 of gas a week',
    time: '10 minutes a week',
  });
  const holdStep: FarmStep = {
    text: `Hold the position for at least ${hold} days, and do not withdraw and re-enter to chase a snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  };
  const claim: FarmStep = {
    text: `Before you withdraw, open ${name}'s own points or rewards page and claim only from the link it publishes.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  };
  const log: FarmStep = {
    text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  };

  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      setup,
      { text: `Supply $${capital} of USDC to ${name} on ${chain} and keep the supply position open.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Borrow 30% of the supplied value in the protocol's stable asset and hold it in the same wallet.`, cost: 'about $2 of gas', time: '10 minutes' },
      weekly('adjust the supply or the borrow by $10-20'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity')) {
    return [
      setup,
      { text: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in equal parts of its two assets.`, cost: `$${capital} of capital and ${gas}`, time: '20 minutes to set up' },
      { text: `Stake the LP receipt in ${name}'s farm on ${chain} if it offers one, and note the reward rate.`, cost: 'about $2 of gas', time: '10 minutes' },
      weekly('swap $10-20 through the pool or add a little liquidity'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('rwa')) {
    return [
      setup,
      { text: `Mint $${capital} of the yield-bearing asset on ${chain} through ${name} and hold it in the wallet.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Check the asset's yield and redemption terms on ${name}'s own page, and note the lock or notice period.`, cost: 'no fee to check', time: '10 minutes' },
      weekly('top up by $10-20 or re-mint after a redemption window opens'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return [
      setup,
      { text: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Read which strategy the vault allocates to on ${name}'s own page, and note its fee and curator.`, cost: 'no fee to check', time: '10 minutes' },
      weekly('add $10-20 to the vault or move between its vaults'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) {
    return [
      setup,
      { text: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and keep it as collateral.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Open one small hedge on ${name} worth about $${Math.round(capital / 5)} and close it within the week.`, cost: 'about $2 of gas plus the trade fee', time: '15 minutes' },
      weekly('open and close one small position so the account shows real use'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('stable')) {
    return [
      setup,
      { text: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Hold the stable asset in ${name}'s savings or staking module on ${chain} if it has one.`, cost: 'about $2 of gas', time: '10 minutes' },
      weekly('top up by $10-20 or move the balance between its modules'),
      holdStep,
      claim,
      log,
    ];
  }
  if (c.includes('insurance') || c.includes('prediction') || c.includes('governance')) {
    return [
      setup,
      { text: `Use $${capital} to buy cover, place a market position or vote through ${name} on ${chain}.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
      { text: `Keep the position or vote receipt in the wallet, and note its expiry or the vote's close.`, cost: 'no fee to check', time: '5 minutes' },
      weekly('place one more position or vote in a new market'),
      holdStep,
      claim,
      log,
    ];
  }
  return [
    setup,
    { text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    weekly('make one qualifying action, such as a deposit, a swap or a vote'),
    holdStep,
    claim,
    log,
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS);
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;

  const categories = [...new Set([...board.map((r) => r.category ?? 'Other'), ...live.map((p) => p.category ?? 'Other')])].sort();
  const catIndex = new Map(categories.map((c, i) => [c, i]));
  const chains = [...new Set([...board.flatMap((r) => r.chains), ...live.flatMap((p) => p.chains)])].sort();
  const chainIndex = new Map(chains.map((c, i) => [c, i]));
  const mults = categories.map((c) => {
    const m = multiples.byCategory.get(c);
    const v = m !== undefined ? m : multiples.overall;
    return Math.min(model.multiple_max, Math.max(model.multiple_min, v));
  });

  const rows: RadarRow[] = board.map((r) => [
    r.rank,
    r.slug,
    r.name,
    catIndex.get(r.category ?? 'Other') ?? 0,
    r.chains.slice(0, 3).map((c) => chainIndex.get(c) ?? 0),
    r.tvl_usd,
    r.change_7d,
    r.age_days === null ? -1 : r.age_days,
    r.implied_value_usd,
  ]);
  const liveRowsCompact: LiveRow[] = live.map((p) => [
    p.name,
    catIndex.get(p.category ?? 'Other') ?? 0,
    p.chains.slice(0, 3).map((c) => chainIndex.get(c) ?? 0),
    p.tvl_usd,
    p.mcap_usd,
    p.change_7d,
  ]);

  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    categories,
    chains,
    multiples: mults,
    rows,
    live: liveRowsCompact,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
