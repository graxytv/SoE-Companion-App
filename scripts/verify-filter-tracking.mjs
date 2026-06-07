import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const soe13Path = path.join(root, 'src', 'lib', 'soe-13-items.ts');
const filterPath = path.join(root, 'src-tauri', 'resources', 'Hiim_SOE.filter');

const soe13Source = fs.readFileSync(soe13Path, 'utf8');
const filterSource = fs.readFileSync(filterPath, 'utf8');

function extractArray(name) {
  const match = soe13Source.match(new RegExp(`(?:export\\s+)?const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) {
    throw new Error(`Could not find ${name} in ${path.relative(root, soe13Path)}`);
  }
  return [...match[1].matchAll(/'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"/g)].map((item) =>
    (item[1] ?? item[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'),
  );
}

function extractRecordKeys(name) {
  const match = soe13Source.match(new RegExp(`export const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`));
  if (!match) {
    throw new Error(`Could not find ${name} in ${path.relative(root, soe13Path)}`);
  }
  return [...match[1].matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_]+))\s*:/gm)].map(
    (item) => item[1] ?? item[2] ?? item[3],
  );
}

function numberedCodes(prefix, count, pad = 2) {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(pad, '0')}`);
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasCodeInItemDisplay(code) {
  const pattern = new RegExp(`^\\s*ItemDisplay\\[[^\\]]*(?<![A-Za-z0-9])${escapeRegExp(code)}(?![A-Za-z0-9])`, 'gim');
  return pattern.test(filterSource);
}

const fateCardItems = extractArray('SOE_13_FATE_CARD_ITEMS');
const hatredOrbItems = extractArray('SOE_13_HATRED_ORB_ITEMS');
const baseEssenceCodes = extractArray('SOE_13_BASE_ESSENCE_CODES');
const greaterEssenceCodes = extractArray('SOE_13_GREATER_ESSENCE_CODES');
const perfectEssenceCodes = extractArray('SOE_13_PERFECT_ESSENCE_CODES');

const groups = [
  {
    name: 'Fate Cards',
    codes: numberedCodes('fa', fateCardItems.length),
    requiredInFilter: true,
  },
  {
    name: 'Hatred Orbs',
    codes: numberedCodes('hor', hatredOrbItems.length, 1),
    requiredInFilter: true,
  },
  {
    name: 'Essences',
    codes: unique([
      ...baseEssenceCodes,
      ...greaterEssenceCodes,
      ...perfectEssenceCodes,
      ...extractRecordKeys('SOE_13_ESSENCE_CODE_NAMES'),
    ]),
    requiredInFilter: true,
  },
  {
    name: 'General Currency/Materials',
    codes: extractRecordKeys('SOE_13_GENERAL_MATERIAL_CODE_NAMES'),
    requiredInFilter: true,
  },
  {
    name: 'Ascendancy',
    codes: extractRecordKeys('SOE_13_ASCENDANCY_CODE_NAMES'),
    requiredInFilter: true,
  },
  {
    name: 'New Unique Base Codes',
    codes: extractArray('SOE_13_UNIQUE_BASE_CODES'),
    requiredInFilter: false,
  },
  {
    name: 'Ornate Charm Filter Rules',
    codes: ['cm4'],
    requiredInFilter: true,
  },
];

const expectedCodeSet = new Set(groups.flatMap((group) => group.codes.map((code) => code.toLowerCase())));
const filterTrackedCodePattern =
  /\b(?:fa\d{2}|hor\d+|es\d{2}|csor|etor|ooal|oroh|hfmx|lsvl|ascc|assc|smer|uts|uuc|utbe|cm4)\b/gi;
const filterCodes = unique([...filterSource.matchAll(filterTrackedCodePattern)].map((match) => match[0].toLowerCase()));

const errors = [];
const warnings = [];

for (const group of groups) {
  const missing = group.codes.filter((code) => !hasCodeInItemDisplay(code));
  if (missing.length === 0) {
    continue;
  }
  const message = `${group.name}: missing explicit filter rule(s) for ${missing.join(', ')}`;
  if (group.requiredInFilter) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

const unknownFilterCodes = filterCodes.filter((code) => !expectedCodeSet.has(code));
if (unknownFilterCodes.length > 0) {
  errors.push(`Filter references tracked-code pattern(s) not mapped in SoE Companion: ${unknownFilterCodes.join(', ')}`);
}

if (warnings.length > 0) {
  console.warn('Filter tracking warnings:');
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.error('Filter tracking verification failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Filter tracking verification passed.');
for (const group of groups) {
  console.log(`- ${group.name}: ${group.codes.length} code(s) checked`);
}
