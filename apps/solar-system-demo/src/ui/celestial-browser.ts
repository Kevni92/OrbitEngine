import { objectId, type ObjectId } from "orbit-engine";
import type { CelestialCatalog } from "../scenario/celestial-catalog.js";
import { searchCelestialBodies, type CelestialSearchResult } from "./body-search.js";
import {
  buildCelestialTree,
  categoryLabel,
  type CelestialTreeBodyNode,
  type CelestialTreeGroupNode,
  type CelestialTreeModel,
} from "./celestial-tree.js";

export interface CelestialBrowserOptions {
  readonly catalog: CelestialCatalog;
  readonly selectedBodyId?: ObjectId;
  readonly viewCenterBodyId?: ObjectId;
  readonly onNavigateToBody: (objectId: ObjectId) => void;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Celestial browser element #${id} is missing`);
  return value as T;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export class CelestialBrowser {
  readonly #panel = element<HTMLElement>("celestial-browser");
  readonly #toggle = element<HTMLButtonElement>("celestial-browser-toggle");
  readonly #content = element<HTMLElement>("browser-content");
  readonly #search = element<HTMLInputElement>("celestial-browser-search");
  readonly #clear = element<HTMLButtonElement>("celestial-browser-clear");
  readonly #summary = element<HTMLElement>("celestial-browser-summary");
  readonly #results = element<HTMLElement>("celestial-browser-results");
  readonly #tree = element<HTMLElement>("celestial-browser-tree");
  readonly #catalog: CelestialCatalog;
  readonly #model: CelestialTreeModel;
  readonly #onNavigateToBody: (objectId: ObjectId) => void;
  readonly #abort = new AbortController();
  readonly #expandedGroups = new Set<string>(["planets"]);
  readonly #expandedBodies = new Set<ObjectId>();
  #selectedBodyId?: ObjectId;
  #viewCenterBodyId?: ObjectId;

  constructor(options: CelestialBrowserOptions) {
    this.#catalog = options.catalog;
    this.#model = buildCelestialTree(options.catalog);
    this.#onNavigateToBody = options.onNavigateToBody;
    this.#selectedBodyId = options.selectedBodyId;
    this.#viewCenterBodyId = options.viewCenterBodyId;

    this.#toggle.addEventListener("click", () => {
      const collapsed = this.#panel.classList.toggle("is-collapsed");
      this.#content.hidden = collapsed;
      this.#toggle.setAttribute("aria-expanded", String(!collapsed));
      this.#toggle.textContent = collapsed ? "Show browser" : "Hide browser";
      this.#toggle.setAttribute("aria-label", collapsed ? "Show celestial browser" : "Hide celestial browser");
    }, { signal: this.#abort.signal });
    this.#search.addEventListener("input", () => this.#render(), { signal: this.#abort.signal });
    this.#clear.addEventListener("click", () => {
      this.setQuery("");
      this.#search.focus();
    }, { signal: this.#abort.signal });
    this.#render();
  }

  setSelectedBody(objectIdValue: ObjectId): void {
    this.#assertBody(objectIdValue);
    if (this.#selectedBodyId === objectIdValue) return;
    this.#selectedBodyId = objectIdValue;
    this.#revealAncestors(objectIdValue);
    this.#render();
    this.#scrollSelectedIntoView();
  }

  setViewCenter(objectIdValue: ObjectId): void {
    this.#assertBody(objectIdValue);
    if (this.#viewCenterBodyId === objectIdValue) return;
    this.#viewCenterBodyId = objectIdValue;
    this.#render();
  }

  setQuery(text: string): void {
    this.#search.value = text;
    this.#render();
  }

  dispose(): void {
    this.#abort.abort();
    this.#results.replaceChildren();
    this.#tree.replaceChildren();
  }

  #assertBody(objectIdValue: ObjectId): void {
    objectId(objectIdValue);
    if (!this.#catalog.bodyById.has(objectIdValue)) throw new RangeError(`Unknown catalog body: ${objectIdValue}`);
  }

  #revealAncestors(objectIdValue: ObjectId): void {
    const rootIds = new Set(this.#catalog.roots);
    let current: ObjectId | undefined = objectIdValue;
    while (current !== undefined) {
      const parent = this.#catalog.parentOf(current);
      if (parent === undefined) break;
      this.#expandedBodies.add(parent);
      if (rootIds.has(current)) break;
      current = parent;
    }
    let topLevelBody = objectIdValue;
    while (!rootIds.has(topLevelBody)) {
      const parent = this.#catalog.parentOf(topLevelBody);
      if (parent === undefined) break;
      topLevelBody = parent;
    }
    const group = this.#model.groups.find((candidate) => candidate.children.some((body) => body.id === topLevelBody));
    if (group !== undefined) this.#expandedGroups.add(group.key);
  }

  #render(): void {
    const query = this.#search.value.trim();
    this.#clear.hidden = query.length === 0;
    if (query.length > 0) {
      const results = searchCelestialBodies(this.#catalog, query);
      this.#summary.textContent = results.length === 0
        ? `No celestial bodies match “${query}”.`
        : `${countLabel(results.length, "result")} · catalog metadata only`;
      this.#results.hidden = false;
      this.#tree.hidden = true;
      this.#results.replaceChildren(...results.map((result) => this.#renderSearchResult(result)));
      return;
    }

    this.#summary.textContent = `${countLabel(this.#catalog.bodyById.size, "registered body", "registered bodies")} · catalog metadata only`;
    this.#results.hidden = true;
    this.#tree.hidden = false;
    const nodes: HTMLElement[] = [];
    for (const body of this.#model.rootBodies) nodes.push(this.#renderBody(body, 0));
    for (const group of this.#model.groups) nodes.push(this.#renderGroup(group));
    this.#tree.replaceChildren(...nodes);
  }

  #renderGroup(group: CelestialTreeGroupNode): HTMLElement {
    const item = document.createElement("li");
    item.className = "celestial-tree-item celestial-tree-item--group";
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-expanded", String(this.#expandedGroups.has(group.key)));
    const row = document.createElement("div");
    row.className = "celestial-tree-row";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "celestial-branch-toggle";
    toggle.textContent = this.#expandedGroups.has(group.key) ? "▾" : "▸";
    toggle.setAttribute("aria-expanded", String(this.#expandedGroups.has(group.key)));
    toggle.setAttribute("aria-label", `${this.#expandedGroups.has(group.key) ? "Collapse" : "Expand"} ${group.label}`);
    toggle.addEventListener("click", () => {
      if (this.#expandedGroups.has(group.key)) this.#expandedGroups.delete(group.key);
      else this.#expandedGroups.add(group.key);
      this.#render();
    });
    const label = document.createElement("button");
    label.type = "button";
    label.className = "celestial-group-label";
    label.textContent = group.label;
    label.setAttribute("aria-label", `${group.label}, ${countLabel(group.children.length, "body")}`);
    label.addEventListener("click", () => {
      if (this.#expandedGroups.has(group.key)) this.#expandedGroups.delete(group.key);
      else this.#expandedGroups.add(group.key);
      this.#render();
    });
    const count = document.createElement("span");
    count.className = "celestial-node-count";
    count.textContent = String(group.children.length);
    row.append(toggle, label, count);
    item.append(row);
    if (this.#expandedGroups.has(group.key)) {
      const children = document.createElement("ul");
      children.className = "celestial-tree-children";
      children.setAttribute("role", "group");
      children.append(...group.children.map((body) => this.#renderBody(body, 1)));
      item.append(children);
    }
    return item;
  }

  #renderBody(node: CelestialTreeBodyNode, depth: number): HTMLElement {
    const expanded = this.#expandedBodies.has(node.id);
    const selected = this.#selectedBodyId === node.id;
    const focused = this.#viewCenterBodyId === node.id;
    const item = document.createElement("li");
    item.className = "celestial-tree-item";
    item.dataset.objectId = node.id;
    item.dataset.depth = String(depth);
    item.dataset.selected = String(selected);
    item.dataset.focused = String(focused);
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-selected", String(selected));
    if (node.children.length > 0) item.setAttribute("aria-expanded", String(expanded));

    const row = document.createElement("div");
    row.className = "celestial-tree-row";
    if (node.children.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "celestial-branch-toggle";
      toggle.textContent = expanded ? "▾" : "▸";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${node.definition.name} children`);
      toggle.addEventListener("click", () => {
        if (this.#expandedBodies.has(node.id)) this.#expandedBodies.delete(node.id);
        else this.#expandedBodies.add(node.id);
        this.#render();
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "celestial-branch-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.append(spacer);
    }

    const bodyButton = document.createElement("button");
    bodyButton.type = "button";
    bodyButton.className = "celestial-body-button";
    bodyButton.dataset.objectId = node.id;
    bodyButton.setAttribute("aria-label", `Navigate to ${node.definition.name}, ${categoryLabel(node.definition.display.category)}`);
    bodyButton.setAttribute("aria-pressed", String(selected));
    if (focused) bodyButton.setAttribute("aria-current", "true");
    const icon = document.createElement("span");
    icon.className = "celestial-body-icon";
    icon.dataset.type = node.definition.display.category;
    icon.style.setProperty("--body-color", `#${node.definition.display.color.toString(16).padStart(6, "0")}`);
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "celestial-body-name";
    name.textContent = node.definition.name;
    const meta = document.createElement("span");
    meta.className = "celestial-body-meta";
    meta.textContent = node.children.length === 0 ? categoryLabel(node.definition.display.category) : countLabel(node.children.length, "moon");
    bodyButton.append(icon, name, meta);
    bodyButton.addEventListener("click", () => this.#onNavigateToBody(node.id));
    row.append(bodyButton);
    item.append(row);
    if (expanded && node.children.length > 0) {
      const children = document.createElement("ul");
      children.className = "celestial-tree-children";
      children.setAttribute("role", "group");
      children.append(...node.children.map((child) => this.#renderBody(child, depth + 1)));
      item.append(children);
    }
    return item;
  }

  #renderSearchResult(result: CelestialSearchResult): HTMLElement {
    const item = document.createElement("li");
    item.className = "celestial-search-result";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "celestial-search-result-button";
    button.dataset.objectId = result.id;
    button.setAttribute("aria-label", `Navigate to ${result.definition.name}, ${result.breadcrumb}`);
    const title = document.createElement("strong");
    title.textContent = result.definition.name;
    const path = document.createElement("span");
    path.textContent = result.breadcrumb;
    button.append(title, path);
    button.addEventListener("click", () => this.#onNavigateToBody(result.id));
    item.append(button);
    return item;
  }

  #scrollSelectedIntoView(): void {
    if (this.#search.value.trim().length > 0) return;
    const selected = this.#tree.querySelector<HTMLElement>(`[data-object-id="${this.#selectedBodyId ?? ""}"]`);
    selected?.scrollIntoView({ block: "nearest" });
  }
}
