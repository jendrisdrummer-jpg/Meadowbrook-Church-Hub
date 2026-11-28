// Keeps the Claude Code agent team and the project docs in working order: every agent file has the
// settings Claude Code reads (name, description, model, known tools), and every link between the
// docs points at a file and heading that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const agentsDir = path.join(root, '.claude', 'agents');

const TEAM = {
  'chief-architect': 'opus',
  'product-innovation': 'sonnet',
  'church-operations': 'sonnet',
  'ui-ux-specialist': 'sonnet',
  'security-specialist': 'opus',
  'qa-engineer': 'sonnet',
  'senior-developer': 'sonnet',
  'product-manager': 'sonnet',
  'devops-engineer': 'sonnet',
  'accessibility-specialist': 'sonnet',
  'mobile-engineer': 'sonnet',
  'training-writer': 'sonnet',
  'database-engineer': 'sonnet',
};
const TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite']);
// Agents that must never change files.
const READ_ONLY = ['church-operations', 'security-specialist'];

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${path.basename(file)} starts with a --- front matter block`);
  const fields = Object.fromEntries(m[1].split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }));
  return { fields, body: m[2] };
}

test('agent team: thirteen agents with valid settings', () => {
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  assert.deepEqual(files.map((f) => f.replace(/\.md$/, '')).sort(), Object.keys(TEAM).sort());
  for (const f of files) {
    const { fields, body } = frontmatter(path.join(agentsDir, f));
    const name = f.replace(/\.md$/, '');
    assert.equal(fields.name, name, `${f}: name matches the file name`);
    assert.match(fields.name, /^[a-z][a-z0-9-]*$/);
    assert.ok(fields.description?.length > 80, `${f}: description says when to use it`);
    assert.equal(fields.model, TEAM[name], `${f}: model`);
    if (fields.tools) {
      for (const t of fields.tools.split(',').map((x) => x.trim())) assert.ok(TOOLS.has(t), `${f}: unknown tool ${t}`);
    }
    if (READ_ONLY.includes(name)) {
      const tools = fields.tools.split(',').map((x) => x.trim());
      assert.ok(!tools.some((t) => ['Bash', 'Edit', 'Write', 'NotebookEdit'].includes(t)), `${f}: read-only agents can't change files`);
    }
    assert.ok(body.includes('docs/'), `${f}: points the agent at the shared docs`);
    // No secrets or paid-API setup in agent instructions.
    assert.ok(!/sk_(live|test)_|ANTHROPIC_API_KEY/.test(body), `${f}: no keys`);
  }
});

const slug = (h) => h.toLowerCase().replace(/[`*_]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

test('docs: links between pages point at real files and headings', () => {
  const pages = [path.join(root, 'README.md'), path.join(root, 'CLAUDE.md'),
    ...fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => path.join(root, 'docs', f)),
    ...fs.readdirSync(agentsDir).map((f) => path.join(agentsDir, f))];
  const broken = [];
  for (const page of pages) {
    const text = fs.readFileSync(page, 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const abs = path.resolve(path.dirname(page), file);
      if (!fs.existsSync(abs)) { broken.push(`${path.relative(root, page)} → ${target}`); continue; }
      if (anchor && abs.endsWith('.md')) {
        const headings = [...fs.readFileSync(abs, 'utf8').matchAll(/^#+\s+(.+)$/gm)].map((h) => slug(h[1]));
        if (!headings.includes(anchor)) broken.push(`${path.relative(root, page)} → ${target} (no such heading)`);
      }
    }
    // Plain-text references like `docs/testing.md` must exist too.
    for (const [ref] of text.matchAll(/docs\/[a-z-]+\.md/g)) {
      if (!fs.existsSync(path.join(root, ref))) broken.push(`${path.relative(root, page)} mentions ${ref}`);
    }
  }
  assert.deepEqual(broken, []);
});
