// Structural checks for the plugin files, so a broken manifest or command is
// caught by `npm test` as well as by `claude plugin validate`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

function frontmatter(file) {
  const match = read(file).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} has YAML frontmatter`);
  return Object.fromEntries(
    match[1].split('\n').filter((line) => /^[\w-]+:/.test(line)).map((line) => {
      const [key, ...rest] = line.split(':');
      return [key.trim(), rest.join(':').trim()];
    }),
  );
}

const CONTENT_COMMANDS = ['social-posts', 'email-draft', 'content-calendar'];

test('plugin and marketplace manifests agree', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, './');
  assert.equal(readJson('package.json').version, plugin.version);
  assert.ok(fs.statSync(path.join(ROOT, plugin.icon)).isFile(), `icon ${plugin.icon} exists`);
  assert.match(plugin.description, /\/content-kit:setup/);
});

test('setup and every content command have a description and argument hint', () => {
  for (const name of ['setup', ...CONTENT_COMMANDS]) {
    const meta = frontmatter(`commands/${name}.md`);
    assert.ok(meta.description, `${name} has a description`);
    assert.ok(meta['argument-hint'], `${name} has an argument hint`);
  }
});

test('content commands read the brand config and describe both output paths', () => {
  for (const name of CONTENT_COMMANDS) {
    const body = read(`commands/${name}.md`);
    assert.match(body, /brand\.config\.json/, `${name} reads the brand config`);
    assert.match(body, /Google Workspace connected/, `${name} describes the Google path`);
    assert.match(body, /file fallback/i, `${name} describes the file fallback`);
    assert.match(body, /out\//, `${name} writes fallback files under out/`);
  }
});

test('both agents are defined with a name, description and tool list', () => {
  for (const name of ['brand-voice-editor', 'fact-checker']) {
    const meta = frontmatter(`agents/${name}.md`);
    assert.equal(meta.name, name);
    assert.ok(meta.description.length > 40);
    assert.ok(meta.tools);
  }
});

test('every skill has a SKILL.md with a description', () => {
  const skills = fs.readdirSync(path.join(ROOT, 'skills'));
  assert.deepEqual(skills.sort(), ['brand-config', 'brand-voice', 'workspace-output']);
  for (const skill of skills) assert.ok(frontmatter(`skills/${skill}/SKILL.md`).description);
});

test('the example brand config has every required field', () => {
  const config = readJson('examples/brand.config.json');
  assert.equal(config.schemaVersion, 1);
  for (const [field, value] of Object.entries({
    'brand.name': config.brand.name,
    'brand.website': config.brand.website,
    'audience.primary': config.audience.primary,
    'ctas.primary': config.ctas.primary,
    'ctas.primaryUrl': config.ctas.primaryUrl,
  })) assert.ok(value, `${field} is set`);
  assert.equal(config.voice.adjectives.length, 3);
  assert.ok(config.voice.do.length && config.voice.dont.length);
  assert.ok(config.pillars.length >= 2 && config.pillars.length <= 6);
  assert.ok(config.channels.every((c) => c.name && Number.isInteger(c.postsPerWeek)));
  assert.ok(['auto', 'google', 'files'].includes(config.workspace.mode));
});

test('the workspace-output skill documents the same CSV columns the checker enforces', () => {
  const { POSTING_SCHEDULE, CONTENT_CALENDAR } = require('../scripts/check-output.js');
  const skill = read('skills/workspace-output/SKILL.md');
  assert.ok(skill.includes(`\`${POSTING_SCHEDULE.join(',')}\``), 'posting-schedule columns');
  assert.ok(skill.includes(`\`${CONTENT_CALENDAR.join(',')}\``), 'content-calendar columns');
});

test('every content command is allowed to run the output checker and is told to', () => {
  for (const name of CONTENT_COMMANDS) {
    assert.match(frontmatter(`commands/${name}.md`)['allowed-tools'], /Bash\(node:\*\)/, name);
    assert.match(read(`commands/${name}.md`), /check it with the skill's checker|checks? (it|the CSV) with/i, name);
  }
  assert.match(read('skills/workspace-output/SKILL.md'), /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/check-output\.js/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/check-output.js')));
});

test('the shipped examples include output from every content command', () => {
  const files = (dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String);
  assert.ok(files('examples/out/social').some((f) => f.endsWith('posting-schedule.csv')));
  assert.ok(files('examples/out/social').some((f) => f.endsWith('posts.md')));
  assert.ok(files('examples/out/email').some((f) => f.endsWith('.md')));
  assert.ok(files('examples/out/calendar').some((f) => f.endsWith('-content-calendar.csv')));
  assert.ok(files('examples/out/calendar').some((f) => f.endsWith('-content-calendar.md')));
});
