import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const schema = read('packages/database/prisma/schema.prisma').replaceAll('\r','');
const enums = Object.fromEntries([...schema.matchAll(/enum (\w+) \{([^}]+)\}/g)].map(m => [m[1], m[2].trim().split(/\s+/)]));
const models = {};
for (const match of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
  const name = match[1], fields = {}, relations = {}, indexes = [];
  for (const line of match[2].split('\n')) {
    const f = /^\s*(\w+)\s+(\w+)(\[\]|\?)?(.*)$/.exec(line);
    if (!f) { const idx = /@@(unique|index)\(\[([^\]]+)\]/.exec(line); if (idx) indexes.push({ unique: idx[1] === 'unique', fields: idx[2].split(',').map(x => x.trim()) }); continue; }
    const [, key, type, suffix, attrs] = f;
    if (!['String','Int','BigInt','DateTime','Boolean','Json', ...Object.keys(enums)].includes(type)) {
      const rel = /fields: \[(\w+)\], references: \[(\w+)\]/.exec(attrs);
      relations[key] = { table: type, many: suffix === '[]', ...(rel ? { local: rel[1], foreign: rel[2] } : {}), name: /@relation\("([^"]+)"/.exec(attrs)?.[1], onDelete: /onDelete: (\w+)/.exec(attrs)?.[1] };
    } else fields[key] = { type, optional: suffix === '?', id: attrs.includes('@id'), unique: attrs.includes('@unique'), updated: attrs.includes('@updatedAt'), default: /@default\(([^)]+(?:\))?)\)/.exec(attrs)?.[1] };
  }
  models[name] = { fields, relations, indexes };
  if(!Object.keys(fields).length)throw new Error(`No scalar fields parsed for ${name}`);
}
for (const [name, m] of Object.entries(models)) for (const r of Object.values(m.relations)) {
  if (r.local) continue;
  const inverse = Object.values(models[r.table].relations).find(x => x.table === name && x.local && x.name === r.name);
  if (!inverse) throw new Error(`Cannot resolve ${name} -> ${r.table}`);
  r.local = inverse.foreign; r.foreign = inverse.local;
}
const checks = new Map();
for (const dir of readdirSync(new URL('packages/database/prisma/migrations/', root)).sort()) {
  if (dir.endsWith('.toml')) continue;
  const sql = read(`packages/database/prisma/migrations/${dir}/migration.sql`);
  for (const m of sql.matchAll(/(?:CONSTRAINT )"(\w+)_([^"]+_check)" CHECK\s*\(/g)) {
    let end = m.index + m[0].length, level = 1;
    for (; level && end < sql.length; end++) { if (sql[end] === '(') level++; else if (sql[end] === ')') level--; }
    const table = Object.keys(models).sort((a,b)=>b.length-a.length).find(t => (m[1]+'_'+m[2]).startsWith(t+'_'));
    if (table) checks.set(m[1]+'_'+m[2], { table, body: sql.slice(m.index + m[0].length, end - 1) });
  }
}
let sql = '-- D1 schema. Independent preview database only; never run against Turon.\nPRAGMA foreign_keys = ON;\n';
for (const [name, model] of Object.entries(models)) {
  const columns = [];
  for (const [key, f] of Object.entries(model.fields)) {
    const type = ['Int','DateTime','Boolean'].includes(f.type) ? 'INTEGER' : 'TEXT';
    let col = `"${key}" ${type}${f.optional ? '' : ' NOT NULL'}${f.id ? ' PRIMARY KEY' : ''}${f.unique ? ' UNIQUE' : ''}`;
    if (f.default && !f.default.startsWith('cuid')) {
      const def = f.default.startsWith('now') ? "(CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))" : f.type === 'Boolean' ? (f.default === 'true' ? '1' : '0') : /^-?\d+$/.test(f.default) ? f.default : `'${f.default.replaceAll('"','')}'`;
      col += ` DEFAULT ${def}`;
    }
    if (enums[f.type]) col += ` CHECK ("${key}" IN (${enums[f.type].map(x=>`'${x}'`).join(',')}))`;
    if (f.type === 'Boolean') col += ` CHECK ("${key}" IN (0,1))`;
    if (f.type === 'Int') col += ` CHECK ("${key}" BETWEEN -2147483648 AND 2147483647)`;
    if (f.type === 'Json') col += ` CHECK ("${key}" IS NULL OR json_valid("${key}"))`;
    columns.push(col);
    if (['nameRu','nameUz','descriptionRu','descriptionUz','slug','publicId'].includes(key)) columns.push(`"${key}__fold" TEXT`);
  }
  for (const r of Object.values(model.relations)) if (!r.many && model.fields[r.local] && r.local !== 'id') columns.push(`FOREIGN KEY ("${r.local}") REFERENCES "${r.table}" ("${r.foreign}") ON DELETE ${{SetNull:'SET NULL',Cascade:'CASCADE',Restrict:'RESTRICT'}[r.onDelete] ?? 'RESTRICT'} ON UPDATE CASCADE`);
  for (const [constraint, c] of checks) if (c.table === name) columns.push(`CONSTRAINT "${constraint}" CHECK (${c.body})`);
  sql += `\nCREATE TABLE "${name}" (\n  ${columns.join(',\n  ')}\n);\n`;
  for (const [i, idx] of model.indexes.entries()) sql += `CREATE ${idx.unique?'UNIQUE ':''}INDEX "${name}_${i}_idx" ON "${name}" (${idx.fields.map(x=>`"${x}"`).join(',')});\n`;
}
sql += '\nCREATE UNIQUE INDEX "ProductImage_one_primary_per_product_key" ON "ProductImage" ("productId") WHERE "isPrimary" = 1;\n';
sql += 'CREATE TABLE "_Revision" ("id" INTEGER PRIMARY KEY CHECK (id=1), "version" INTEGER NOT NULL);\nINSERT INTO "_Revision" VALUES (1,0);\nCREATE TABLE "_BatchGuard" ("id" TEXT PRIMARY KEY, "ok" INTEGER NOT NULL CHECK (ok=1));\n';
for (const table of Object.keys(models)) for (const op of ['INSERT','UPDATE','DELETE']) sql += `CREATE TRIGGER "revision_${table}_${op}" AFTER ${op} ON "${table}" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;\n`;
mkdirSync(new URL('apps/worker/migrations/', root), {recursive:true});
// Schema refreshes for sequential migrations must never rewrite applied SQL.
if (!process.argv.includes('--schema-only')) writeFileSync(new URL('apps/worker/migrations/0001_initial.sql',root), sql);
writeFileSync(new URL('packages/database/src/d1-schema.ts',root), `// Generated by scripts/prepare-d1.mjs; no runtime Prisma dependency.\nexport const models = ${JSON.stringify(models,null,2)} as const;\n`);
console.log(`D1 schema generated: ${Object.keys(models).length} models, ${checks.size} preserved checks.`);
