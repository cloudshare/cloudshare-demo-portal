import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

// Publication is an explicit review decision, never a directory walk or link crawl.
const pages = [
  ['docs/flows/README.md', 'index', 'Flow guide'],
  ['docs/flows/authentication.md', 'authentication', 'Authentication'],
  ['docs/flows/certification-admin.md', 'certification-admin', 'Certification admin'],
  ['docs/flows/certification-candidate.md', 'certification-candidate', 'Candidate'],
  ['docs/flows/coverage.md', 'coverage', 'Coverage'],
  ['docs/flows/endpoints.md', 'endpoints', 'Endpoints'],
  ['docs/flows/operations.md', 'operations', 'Operations'],
  ['docs/flows/sales-configuration.md', 'sales-configuration', 'Sales configuration'],
  ['docs/flows/sales-sessions.md', 'sales-sessions', 'Sales sessions'],
  ['docs/flows/sales-trial.md', 'sales-trial', 'Sales Trial'],
  ['docs/flows/trial-administration.md', 'trial-administration', 'Trial administration'],
  ['docs/implementation/two-os-installation.md', 'installation', 'Installation (dated guide)'],
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 2) throw new Error('build:docs accepts no arguments.');
const md = new MarkdownIt({ html: false, linkify: false });
const escape = md.utils.escapeHtml;
const documents = new Map(pages.map(([source, name, title]) => {
  const tokens = md.parse(readFileSync(path.join(root, source), 'utf8'), {});
  const anchors = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const text = tokens[i + 1].children.map(t => t.content).join('');
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
    let id = base;
    for (let n = 1; anchors.has(id); n++) id = `${base}-${n}`;
    anchors.add(id);
    tokens[i].attrSet('id', id);
  }
  return [source, { name, title, tokens, anchors }];
}));

function publishedLink(href, source) {
  if (/^https?:\/\//i.test(href)) {
    const url = new URL(href);
    return url.username || url.password ? null : href;
  }
  if (/^[a-z][a-z\d+.-]*:|^[\/\\]|\\/i.test(href)) return null;
  const [relative, fragment] = href.split('#');
  const target = relative ? path.posix.normalize(path.posix.join(path.posix.dirname(source), relative)) : source;
  const document = documents.get(target);
  if (!document) return null;
  if (fragment && !document.anchors.has(decodeURIComponent(fragment))) {
    throw new Error(`Missing selected anchor: ${source} -> ${href}`);
  }
  return `${document.name}.html${fragment ? `#${fragment}` : ''}`;
}

md.renderer.rules.image = (tokens, index) => escape(tokens[index].content);
const navigation = pages.map(([, name, title]) => `<a href="${name}.html">${escape(title)}</a>`).join(' ');
const rendered = [];
for (const [source, document] of documents) {
  for (const block of document.tokens) {
    let inert = false;
    for (const token of block.children ?? []) {
      if (token.type === 'link_open') {
        const href = publishedLink(token.attrGet('href'), source);
        inert = href === null;
        if (inert) token.hidden = true;
        else token.attrSet('href', href);
      } else if (token.type === 'link_close') {
        token.hidden = inert;
        inert = false;
      }
    }
  }
  const body = md.renderer.render(document.tokens, md.options, {});
  rendered.push([`${document.name}.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(document.title)} · Certalis documentation</title><link rel="stylesheet" href="style.css"></head>
<body><header><a href="/login">Open portal</a><nav aria-label="Documentation">${navigation}</nav></header>
<main><p class="notice">Selected repository documentation. Unpublished source references are plain text. Diagrams are shown as readable code; installation and verification notes retain their recorded dates.</p>
${body}</main></body></html>\n`]);
}

const output = path.join(root, 'build/docs-site');
// All reads and anchor checks finish before replacing the fixed artifact directory.
const parent = path.dirname(output);
if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Output parent must not be a link.');
mkdirSync(parent, { recursive: true });
if (realpathSync(parent) !== path.join(realpathSync(root), 'build')) throw new Error('Output parent escaped the checkout.');
if (lstatSync(output, { throwIfNoEntry: false }) && (lstatSync(output).isSymbolicLink() || realpathSync(output) !== path.join(realpathSync(parent), 'docs-site'))) {
  throw new Error('Output directory must not be a link.');
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [name, content] of rendered) writeFileSync(path.join(output, name), content);
writeFileSync(path.join(output, 'style.css'), `
:root { font-family: system-ui, sans-serif; line-height: 1.6; color: #172b40; background: #f7f9fc; }
body { margin: 0; } header, main { max-width: 1100px; margin: auto; padding: 1.5rem; }
header { border-bottom: 1px solid #cbd5e1; } nav { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-top: 1rem; }
a { color: #0759a5; } a:focus-visible { outline: 3px solid #ad6500; outline-offset: 3px; }
.notice { border-left: 4px solid #52769b; padding: .75rem 1rem; background: #eaf0f7; }
h1,h2,h3 { line-height: 1.25; scroll-margin-top: 1rem; } main { overflow-wrap: anywhere; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; margin: 1rem 0; }
th,td { border: 1px solid #bac8d8; padding: .6rem; text-align: left; min-width: 8rem; vertical-align: top; }
th { background: #eaf0f7; } pre { overflow-x: auto; padding: 1rem; background: #eaf0f7; }
code { font-size: .9em; } pre code { white-space: pre; } @media(max-width: 600px) { header,main { padding: 1rem; } }
`);
console.log(`Built ${pages.length} documentation pages in build/docs-site.`);
