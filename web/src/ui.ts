// Peças da interface: painéis, sparklines, variações, modal/gaveta, tabela ordenável, ícones.
import { disposeIn } from "./charts";
import { esc } from "./data";

export const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;
export const $$ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as E[];

const P = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  painel: P('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  setores: P('<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>'),
  empresas: P('<path d="M4 21V6l7-3v18"/><path d="M11 21V9l9 3v9"/><path d="M2 21h20"/><path d="M7 9h1M7 13h1M7 17h1M15 15h1M15 18h1"/>'),
  credito: P('<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4.5-6"/><circle cx="12" cy="18" r="1.2"/>'),
  juros: P('<path d="M3 17c4-1 6-8 9-8s4 4 9 3"/><path d="M3 21h18"/>'),
  nota: P('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  theme: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none"/>'),
  left: P('<path d="m15 6-6 6 6 6"/>'),
  right: P('<path d="m9 6 6 6-6 6"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  download: P('<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 20h14"/>'),
  expand: P('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  alert: P('<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.5v.5"/>'),
};

export function panel(id: string, title: string, tools = "", body = "", cls = ""): string {
  return `<section class="panel ${cls}" id="${id}"><header class="ph"><h2>${title}</h2><div class="tools">${tools}</div></header><div class="pb">${body}</div></section>`;
}

export function seg(id: string, options: [string, string][], active: string): string {
  return `<div class="seg" id="${id}" role="tablist">${options.map(([v, l]) =>
    `<button role="tab" data-v="${v}" class="${v === active ? "on" : ""}" aria-selected="${v === active}">${l}</button>`).join("")}</div>`;
}

export function onSeg(id: string, fn: (v: string) => void) {
  const root = $(`#${id}`);
  $$<HTMLButtonElement>("button", root).forEach((b) => (b.onclick = () => {
    $$("button", root).forEach((o) => { o.classList.toggle("on", o === b); o.setAttribute("aria-selected", String(o === b)); });
    fn(b.dataset.v!);
  }));
}

/** Sparkline em SVG puro: barata o bastante para uma por linha de tabela. */
export function spark(values: (number | null)[], opts: { w?: number; h?: number; zero?: boolean; bars?: boolean } = {}): string {
  const w = opts.w ?? 72, h = opts.h ?? 20;
  const nums = values.filter((v): v is number => v != null && isFinite(v));
  if (nums.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (opts.zero || opts.bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const span = hi - lo || 1;
  const y = (v: number) => h - 1.5 - ((v - lo) / span) * (h - 3);
  const step = w / Math.max(1, values.length - 1);
  if (opts.bars) {
    const bw = Math.max(1, w / values.length - 1), y0 = y(0);
    return `<svg class="spark" width="${w}" height="${h}">${values.map((v, i) => v == null ? "" :
      `<rect x="${(i * w) / values.length}" y="${Math.min(y(v), y0)}" width="${bw}" height="${Math.max(0.8, Math.abs(y(v) - y0))}" class="${v < 0 ? "neg" : "pos"}"/>`).join("")}</svg>`;
  }
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (v == null || !isFinite(v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const lastI = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()!;
  const zero = opts.zero && lo < 0 && hi > 0 ? `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" class="z"/>` : "";
  return `<svg class="spark" width="${w}" height="${h}">${zero}<path d="${d}"/><circle cx="${lastI * step}" cy="${y(values[lastI]!)}" r="1.8"/></svg>`;
}

/** Variação com seta e cor (azul alta, vermelho queda), sempre com texto. */
export function delta(v: number | null | undefined, text: string, invert = false, eps = 0.0005): string {
  if (v == null || !isFinite(v)) return `<span class="delta">–</span>`;
  // Abaixo de eps a variação some no arredondamento; vira neutra em vez de "▼ -0,00".
  if (Math.abs(v) < eps) return `<span class="delta">■ ${text.replace(/^[-+]/, "")}</span>`;
  const cls = (invert ? v < 0 : v > 0) ? "up" : "down";
  return `<span class="delta ${cls}">${v > 0 ? "▲" : "▼"} ${text}</span>`;
}

// ---- camadas sobrepostas: modal e gaveta ----

let layerClose: (() => void) | null = null;

function openLayer(kind: "modal" | "drawer", title: string, body: string, wide = false): HTMLElement {
  closeLayer();
  const root = document.createElement("div");
  root.className = `layer ${kind}`;
  root.innerHTML = `<div class="scrim"></div><div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="sh"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon.close}</button></header>
    <div class="sb">${body}</div></div>`;
  document.body.appendChild(root);
  const close = () => { disposeIn(root); root.remove(); layerClose = null; };
  root.querySelector(".scrim")!.addEventListener("click", close);
  root.querySelector("[data-close]")!.addEventListener("click", close);
  layerClose = close;
  requestAnimationFrame(() => root.classList.add("open"));
  return root.querySelector(".sb") as HTMLElement;
}

export const openModal = (title: string, body: string, wide = false) => openLayer("modal", title, body, wide);
export const openDrawer = (title: string, body: string) => openLayer("drawer", title, body);
export function closeLayer() { layerClose?.(); }
export const layerOpen = () => layerClose != null;

// ---- tabela ordenável ----

export interface Col<R> { key: string; label: string; get: (r: R) => number | string | null; fmt?: (r: R) => string; cls?: string; title?: string }

export function table<R>(host: HTMLElement, rows: R[], cols: Col<R>[], state: { key: string; dir: number }, onRow?: (r: R) => void, rowCls?: (r: R) => string) {
  const render = () => {
    const col = cols.find((c) => c.key === state.key) ?? cols[0];
    const sorted = [...rows].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : (va as number) - (vb as number)) * state.dir;
    });
    host.innerHTML = `<table class="grid"><thead><tr>${cols.map((c) =>
      `<th data-k="${c.key}" class="${c.cls ?? ""} ${c.key === state.key ? "sorted" : ""}" ${c.title ? `title="${esc(c.title)}"` : ""}
        aria-sort="${c.key === state.key ? (state.dir > 0 ? "ascending" : "descending") : "none"}">${c.label}<i>${c.key === state.key ? (state.dir > 0 ? "↑" : "↓") : ""}</i></th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r, i) => `<tr data-i="${i}" class="${onRow ? "clickable" : ""} ${rowCls?.(r) ?? ""}">${cols.map((c) =>
        `<td class="${c.cls ?? ""}">${c.fmt ? c.fmt(r) : esc(String(c.get(r) ?? "–"))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    $$<HTMLElement>("th", host).forEach((th) => (th.onclick = () => {
      const k = th.dataset.k!;
      const c = cols.find((x) => x.key === k)!;
      state.dir = k === state.key ? -state.dir : typeof c.get(rows[0]) === "string" ? 1 : -1;
      state.key = k;
      render();
    }));
    if (onRow) $$<HTMLElement>("tbody tr", host).forEach((tr) => (tr.onclick = () => onRow(sorted[Number(tr.dataset.i)])));
  };
  if (!rows.length) { host.innerHTML = `<p class="empty">Nada a mostrar.</p>`; return; }
  render();
}

export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : `"${v.replace(/"/g, '""')}"`;
  const csv = "﻿" + [header.map(cell), ...rows.map((r) => r.map(cell))].map((r) => r.join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
