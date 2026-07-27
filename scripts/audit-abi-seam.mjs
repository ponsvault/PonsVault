/**
 * Diffs every ABI the frontend declares by hand against the compiled contracts.
 *
 * The fork tests cannot catch drift here: they call the contracts through
 * Solidity types, so a TypeScript ABI that has fallen out of step still passes
 * every test and then fails at runtime, in the browser, on a real launch.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = 'contracts/out';

function compiled(contract) {
  const path = `${OUT}/${contract}.sol/${contract}.json`;
  return JSON.parse(readFileSync(path, 'utf8')).abi;
}

/** Canonical "name(type,type)->(type,type)" for comparing regardless of arg names. */
function sigOf(entry) {
  // Recursive, so a change nested inside a struct cannot slip through as a
  // matching bare "tuple" on both sides.
  const flat = (params = []) =>
    params
      .map((p) =>
        p.type.startsWith('tuple')
          ? `(${flat(p.components)})${p.type.slice('tuple'.length)}`
          : p.type,
      )
      .join(',');
  const base = `${entry.name}(${flat(entry.inputs)})`;
  if (entry.type === 'event') return base;
  const out = flat(entry.outputs);
  return `${base}->(${out})${entry.stateMutability === 'view' ? ' view' : ''}`;
}

function index(abi) {
  const map = new Map();
  for (const entry of abi) {
    if (entry.type !== 'function' && entry.type !== 'event') continue;
    map.set(`${entry.type}:${entry.name}`, sigOf(entry));
  }
  return map;
}

/** Extracts the bracketed array literal that follows `marker`. */
function arrayLiteral(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found`);
  const open = src.indexOf('[', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated array after ${marker}`);
}

/** Pulls a `const` ABI array out of a TS module without importing the app. */
function tsAbi(file, name) {
  const src = readFileSync(file, 'utf8');
  let body = arrayLiteral(src, `export const ${name} = [`);

  // Inline any sibling constant the ABI refers to, so shared component lists
  // are checked as part of the signature rather than skipped.
  for (const [, ref] of body.matchAll(/components:\s*([A-Z][A-Z0-9_]*)/g)) {
    body = body.replaceAll(ref, arrayLiteral(src, `const ${ref} = [`));
  }

  // The declarations are plain data; the only non-JSON syntax is the trailing
  // `as const`, unquoted keys and single quotes, which this normalises.
  const json = body
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'/g, '"')
    .replace(/,(\s*[\]}])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  return JSON.parse(json);
}

const CHECKS = [
  ['PONS_VAULT_ABI', 'src/lib/pons/vault-state.ts', 'PonsBuybackBurnVault'],
  ['PONS_STAKING_VAULT_ABI', 'src/lib/pons/vault-state.ts', 'PonsStakingVault'],
  ['PONSVAULT_LAUNCHER_ABI', 'src/lib/pons/vault.ts', 'PonsVaultLauncher'],
];

let failures = 0;

for (const [abiName, file, contract] of CHECKS) {
  const declared = tsAbi(file, abiName);
  const real = index(compiled(contract));

  console.log(`\n${abiName}  vs  ${contract}.sol`);

  for (const entry of declared) {
    if (entry.type !== 'function' && entry.type !== 'event') continue;
    const key = `${entry.type}:${entry.name}`;
    const mine = sigOf(entry);
    const theirs = real.get(key);

    if (!theirs) {
      console.log(`  MISSING  ${key} — declared in TS, absent from the contract`);
      failures += 1;
    } else if (mine !== theirs) {
      console.log(`  MISMATCH ${key}`);
      console.log(`      ts: ${mine}`);
      console.log(`     sol: ${theirs}`);
      failures += 1;
    } else {
      console.log(`  ok       ${mine}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* config encoding: what the launch form sends must be what the factory decodes */
/* -------------------------------------------------------------------------- */

console.log('\nvault config encoding');

const componentsOf = (contract, fn) => {
  const abi = compiled(contract);
  const init = abi.find((e) => e.type === 'function' && e.name === fn);
  const cfg = init.inputs.find((i) => i.type === 'tuple');
  return cfg.components.map((c) => `${c.name}:${c.type}`);
};

const tsComponents = (() => {
  const src = readFileSync('src/lib/pons/vault.ts', 'utf8');
  const grab = (name) => {
    const start = src.indexOf(`const ${name}`);
    const open = src.indexOf('[', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '[') depth += 1;
      if (src[i] === ']') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return [...src.slice(open, end).matchAll(/name:\s*'([^']+)',\s*type:\s*'([^']+)'/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
  };
  return { buyback: grab('VAULT_CONFIG_COMPONENTS'), staking: grab('STAKING_CONFIG_COMPONENTS') };
})();

for (const [label, ts, contract] of [
  ['buyback', tsComponents.buyback, 'PonsBuybackBurnVault'],
  ['staking', tsComponents.staking, 'PonsStakingVault'],
]) {
  const sol = componentsOf(contract, 'initialize');
  const same = ts.length === sol.length && ts.every((v, i) => v === sol[i]);
  console.log(`  ${same ? 'ok      ' : 'MISMATCH'} ${label}`);
  console.log(`      ts: ${ts.join(', ') || '(none found)'}`);
  console.log(`     sol: ${sol.join(', ')}`);
  if (!same) failures += 1;
}

/* -------------------------------------------------------------------------- */
/* template ids: the string the registry is keyed on must match the vault's own */
/* -------------------------------------------------------------------------- */

console.log('\ntemplate ids');

const tsTemplates = [
  ...readFileSync('src/lib/pons/vault.ts', 'utf8').matchAll(
    /id:\s*'(buyback-burn|staking)'/g,
  ),
].map((m) => m[1]);

for (const id of [...new Set(tsTemplates)]) {
  const contract = id === 'staking' ? 'PonsStakingVault' : 'PonsBuybackBurnVault';
  const onChain = execSync(
    `cd contracts && forge inspect ${contract} abi --json`,
    { encoding: 'utf8' },
  );
  const hasTemplate = JSON.parse(onChain).some((e) => e.name === 'template');
  console.log(`  ${hasTemplate ? 'ok      ' : 'MISSING '} ${id} — template() on ${contract}`);
  if (!hasTemplate) failures += 1;
}

console.log(
  failures === 0
    ? '\nPASS — no drift between the TypeScript ABIs and the compiled contracts.'
    : `\nFAIL — ${failures} problem(s).`,
);
process.exit(failures === 0 ? 0 : 1);
