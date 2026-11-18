// Regression test: thread-row metadata (bb >= 0.50 `experimental_threadRowMetadata`,
// e.g. the GitHub PR Status badge) must keep its semantic status colours inside
// the selected "sticker" row, and stay legible on selected and unselected rows
// in light and dark mode.
//
// The cascade is checked in headless Chrome against theme.css. It runs once with
// a small stand-in for the host stylesheet and, when a bb desktop app is
// installed, again with the stylesheets that app ships.
//   CHROME_PATH   path to a Chrome/Chromium binary (default: macOS Google Chrome)
//   BB_APP_DIR    path to bb-app (default: inside /Applications/bb.app)
//   RAD_BINDER_FIXTURE_OUT  directory to keep each fixture page and its measurements in
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const themeCss = join(root, "theme.css");
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const bbApp =
  process.env.BB_APP_DIR ??
  "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app";

// The host declarations the badge depends on, as bb 0.50.1 ships them: layered
// utilities that read the semantic token where they are used.
const STAND_IN_HOST_CSS = `
@layer base {
  :root, .light { --success-foreground: oklch(0.53 0.14 155); --attention: oklch(0.7 0.16 50); }
  .dark { --success-foreground: var(--success); }
}
@layer utilities {
  .hidden { display: none; }
  .flex, .data-\\[has-items\\]\\:flex[data-has-items] { display: flex; }
  .contents { display: contents; }
  .flex-1 { flex: 1; }
  .min-w-0 { min-width: 0; }
  .basis-full { flex-basis: 100%; }
  .overflow-hidden { overflow: hidden; }
  .text-success-foreground { color: var(--success-foreground); }
  .text-pr-merged { color: var(--pr-merged); }
  .text-destructive-text { color: var(--destructive-text); }
  .text-subtle-foreground { color: var(--subtle-foreground); }
  .text-muted-foreground { color: var(--muted-foreground); }
  .bg-attention { background-color: var(--attention); }
}`;

function shippedHostCss() {
  const assets = join(bbApp, "app/dist/assets");
  if (!existsSync(assets)) return null;
  const index = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
  if (index === undefined) return null;
  const plugins = ["thread-list", "github-pr-status"]
    .map((name) => join(bbApp, "server/dist/builtin-plugins", name, "dist/app.css"))
    .filter((path) => existsSync(path));
  return [join(assets, index), ...plugins];
}

// Markup follows bb 0.50.1: plugins/thread-list/app/rows/ThreadRow.tsx,
// apps/app/src/components/plugin/ThreadRowMetadata.tsx and
// plugins/github-pr-status/ui/PullRequestRowMetadata.tsx.
function row(id, selected) {
  const badge = (state, cls, glyph) => `
    <span role="img" data-pull-request-badge="${state}" class="flex shrink-0 items-center gap-1 text-xs">
      <span data-probe="${id}-${state}" class="${cls}">#12</span>${glyph}
    </span>`;
  return `
  <div data-probe="${id}-row" data-sidebar-sticky-tier="thread"
       class="${selected ? "bb-sidebar-selected-row bg-state-active" : ""} text-sidebar-foreground">
    <span class="relative flex min-w-0 flex-1 flex-wrap items-center">
      <a href="#" class="absolute inset-0"></a>
      <span class="flex min-w-0 basis-full items-center">
        <span data-sidebar-thread-provider="x" class="flex size-4 text-muted-foreground">
          <svg data-probe="${id}-provider" width="14" height="14" stroke="currentColor"><path d="M0 0L9 9"/></svg>
        </span>
        <span data-probe="${id}-title" class="bb-thread-title">Thread title</span>
      </span>
      <span class="mt-px flex min-w-0 basis-full pl-6">
        <span data-probe="${id}-metadata" data-thread-row-metadata="" data-has-items=""
              class="pointer-events-auto relative hidden min-w-0 flex-1 items-center gap-2 overflow-hidden data-[has-items]:flex">
          <div data-bb-plugin="bb--github-pr-status" class="contents">
            ${badge("open", "text-success-foreground", `<svg data-probe="${id}-blocked" class="size-3 shrink-0 text-destructive-text" width="12" height="12" stroke="currentColor"><path d="M0 0L9 9"/></svg>`)}
            ${badge("merged", "text-pr-merged", `<span class="flex size-3"><span data-probe="${id}-running" class="size-1.5 rounded-full bg-attention" style="width:6px;height:6px"></span></span>`)}
            ${badge("closed", "text-destructive-text", "")}
            ${badge("draft", "text-subtle-foreground", "")}
          </div>
        </span>
      </span>
    </span>
    <span data-sidebar-thread-trailing=""><button data-probe="${id}-action" type="button">⋯</button></span>
  </div>`;
}

const PROBE_SCRIPT = `
const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function rgba(color) {
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data);
}
function luminance([r, g, b]) {
  return [r, g, b].map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
// First opaque background at or above the element: what the text is drawn on.
function backdrop(el) {
  for (let node = el; node; node = node.parentElement) {
    const colour = rgba(getComputedStyle(node).backgroundColor);
    if (colour[3] === 255) return colour;
  }
  return [255, 255, 255, 255];
}
const out = {};
for (const mode of ["light", "dark"]) {
  document.documentElement.className = mode;
  out[mode] = {};
  for (const el of document.querySelectorAll("[data-probe]")) {
    const style = getComputedStyle(el);
    const fill = el.dataset.probe.endsWith("-running") ? style.backgroundColor : style.color;
    const onto = el.dataset.probe.endsWith("-running") ? backdrop(el.parentElement) : backdrop(el);
    out[mode][el.dataset.probe] = {
      color: rgba(fill).slice(0, 3).join(","),
      background: rgba(style.backgroundColor).join(","),
      contrast: Math.round(contrast(rgba(fill), onto) * 100) / 100,
      width: Math.round(el.getBoundingClientRect().width),
    };
  }
}
document.getElementById("result").textContent = JSON.stringify(out);
`;

function probe(hostStylesheets, label) {
  const dir = mkdtempSync(join(tmpdir(), "rad-binder-test-"));
  try {
    const links = [...hostStylesheets, themeCss]
      .map((path) => `<link rel="stylesheet" href="${pathToFileURL(path)}">`)
      .join("");
    writeFileSync(
      join(dir, "fixture.html"),
      `<!doctype html><meta charset="utf-8">${links}
<div data-testid="app-layout-root"><aside data-sidebar="sidebar" style="width:260px">
<div data-bb-plugin="thread-list">${row("selected", true)}${row("plain", false)}</div>
</aside></div><pre id="result"></pre><script>${PROBE_SCRIPT}</script>`,
    );
    const dom = execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--allow-file-access-from-files",
        `--user-data-dir=${join(dir, "profile")}`,
        "--dump-dom",
        pathToFileURL(join(dir, "fixture.html")).href,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 },
    );
    const match = /<pre id="result">([^<]+)<\/pre>/.exec(dom);
    assert.ok(match, "fixture produced no result");
    const result = JSON.parse(match[1].replaceAll("&quot;", '"'));
    const keep = process.env.RAD_BINDER_FIXTURE_OUT;
    if (keep) {
      mkdirSync(keep, { recursive: true });
      copyFileSync(join(dir, "fixture.html"), join(keep, `${label}.html`));
      writeFileSync(join(keep, `${label}.json`), JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STICKER_INK = "18,10,36"; // #120a24, the selected row's own text colour
const STATES = ["open", "merged", "closed", "draft"];

function checkCascade(result) {
  for (const mode of ["light", "dark"]) {
    const r = result[mode];
    const at = (key) => `${mode} ${key}: ${JSON.stringify(r[key])}`;

    // The sticker keeps its own ink on what the theme owns.
    for (const owned of ["selected-row", "selected-title", "selected-provider", "selected-action"]) {
      assert.equal(r[owned].color, STICKER_INK, at(owned));
    }
    assert.ok(r["selected-title"].contrast >= 4.5, at("selected-title"));

    // Status metadata is not repainted with the sticker ink ...
    for (const key of [...STATES, "blocked"]) {
      assert.notEqual(r[`selected-${key}`].color, STICKER_INK, at(`selected-${key}`));
      // ... and reads the same as on an unselected row.
      assert.equal(r[`selected-${key}`].color, r[`plain-${key}`].color, at(`selected-${key}`));
    }
    assert.equal(r["selected-running"].color, r["plain-running"].color, at("selected-running"));
    const distinct = new Set(["open", "merged", "closed"].map((s) => r[`selected-${s}`].color));
    assert.equal(distinct.size, 3, `${mode}: open, merged and closed must differ`);

    // Legible on both rows: text at 4.5:1, the glyphs at 3:1.
    for (const id of ["selected", "plain"]) {
      for (const state of STATES) {
        assert.ok(r[`${id}-${state}`].contrast >= 4.5, at(`${id}-${state}`));
      }
      assert.ok(r[`${id}-blocked`].contrast >= 3, at(`${id}-blocked`));
      assert.ok(r[`${id}-running`].contrast >= 3, at(`${id}-running`));
    }

    // The selected row's metadata plate hugs the badges instead of spanning the row.
    assert.ok(
      r["selected-metadata"].width < r["plain-metadata"].width,
      `${mode}: ${at("selected-metadata")} vs ${at("plain-metadata")}`,
    );
  }
}

test("selected-row ink rule leaves thread-row metadata alone", () => {
  const css = readFileSync(themeCss, "utf8");
  const rule = /\.bb-sidebar-selected-row\s+:is\(span, a, button, svg\)([^{]*)\{/.exec(css);
  assert.ok(rule, "selected-row descendant rule not found");
  assert.match(rule[1], /:not\([^{]*\[data-thread-row-metadata\]/);
});

test("metadata keeps status colours and contrast (stand-in host CSS)", { skip: !existsSync(chrome) && "no Chrome; set CHROME_PATH" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rad-binder-host-"));
  try {
    const host = join(dir, "host.css");
    writeFileSync(host, STAND_IN_HOST_CSS);
    checkCascade(probe([host], "stand-in"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const shipped = shippedHostCss();
test("metadata keeps status colours and contrast (installed bb stylesheets)", {
  skip: (!existsSync(chrome) && "no Chrome; set CHROME_PATH") || (shipped === null && "no bb desktop app; set BB_APP_DIR"),
}, () => {
  checkCascade(probe(shipped, "installed-bb"));
});
