// A minimal Figma Plugin API mock. Loads the built build/main.js as is, drives it
// with UI events, and lets tests inspect the resulting canvas.
//
// Section adoption of overlapping nodes is reproduced too, nesting included,
// because the implementation leans on it.
//
// Keep the mock shaped like the real API. Drift lets bugs that depend on the
// difference pass unnoticed; ModeledSceneProps below is the guard against that.

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import type { PanelState } from '../src/events';

// Properties the plugin actually touches. Anything listed here must match the
// real type, in value type and in existence, or this fails to compile.
type ModeledSceneProps = 'id' | 'name' | 'x' | 'y' | 'width' | 'height' | 'removed' | 'locked';

export interface FakeNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  removed: boolean;
  locked: boolean;
  parent: FakeParent | null;
  type: string;
  children: FakeNode[];
  appendChild(child: FakeNode): void;
  pluginData: Record<string, string>;
  // Read from tests. Real nodes have more; the mock declares only what is needed.
  text?: { characters: string; fontSize: number; fontName: unknown };
  characters?: string;
  fills?: unknown[];
  strokes?: unknown[];
  backgrounds?: unknown[];
  shapeType?: string;
  resize(width: number, height: number): void;
  resizeWithoutConstraints(width: number, height: number): void;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
  remove(): void;
  [key: string]: unknown;
}

export type FakeParent = FakeNode;

// Fails to compile if the mock stops being a subset of the real node.
type Assert<T extends Pick<SectionNode, ModeledSceneProps>> = T;
export type CheckedFake = Assert<Pick<FakeNode, ModeledSceneProps>>;

let idCounter = 0;
const nextId = (): string => `${++idCounter}:1`;

function detach(node: FakeNode): void {
  if (node.parent === null) {
    return;
  }
  const siblings = node.parent.children;
  siblings.splice(siblings.indexOf(node), 1);
  node.parent = null;
}

export function absolute(node: FakeNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let parent = node.parent;
  while (parent !== null && parent.type !== 'PAGE') {
    x += parent.x;
    y += parent.y;
    parent = parent.parent;
  }
  return { x, y };
}

interface Listener {
  type: string;
  callback: (event: unknown) => void;
}

export type Harness = ReturnType<typeof createHarness>;

export function createHarness() {
  const pluginDataMixin = {
    getPluginData(this: FakeNode, key: string): string {
      return this.pluginData[key] ?? '';
    },
    setPluginData(this: FakeNode, key: string, value: string): void {
      this.pluginData[key] = value;
    },
  };

  const page = {
    type: 'PAGE',
    id: '0:1',
    name: 'Page 1',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    removed: false,
    locked: false,
    parent: null,
    children: [] as FakeNode[],
    selection: [] as FakeNode[],
    // Real PageNodes carry backgrounds; FigJam's light default measures #E5E5E5.
    backgrounds: [
      { type: 'SOLID', color: { r: 0xe5 / 255, g: 0xe5 / 255, b: 0xe5 / 255 } },
    ] as unknown[],
    listeners: [] as Listener[],
    pluginData: {} as Record<string, string>,
    ...pluginDataMixin,
    remove(): void {},
    async loadAsync(): Promise<void> {},
    on(type: string, callback: (event: unknown) => void): void {
      page.listeners.push({ type, callback });
    },
    appendChild(child: FakeNode): void {
      detach(child);
      child.parent = page as unknown as FakeParent;
      page.children.push(child);
    },
    findAllWithCriteria({ types }: { types: string[] }): FakeNode[] {
      const out: FakeNode[] = [];
      const walk = (nodes: FakeNode[]): void => {
        for (const node of nodes) {
          if (types.includes(node.type)) {
            out.push(node);
          }
          if (node.children) {
            walk(node.children);
          }
        }
      };
      walk(page.children);
      return out;
    },
  };

  const notifications: string[] = [];
  const uiMessages: unknown[] = [];
  const globalListeners: Listener[] = [];
  const storage = new Map<string, unknown>();

  function container<T extends FakeNode>(node: T): T & FakeParent {
    const withChildren = node as T & FakeParent;
    withChildren.appendChild = (child: FakeNode): void => {
      detach(child);
      child.parent = withChildren;
      withChildren.children.push(child);
    };
    return withChildren;
  }

  function createSection(): FakeNode & FakeParent {
    return container({
      type: 'SECTION',
      id: nextId(),
      name: 'Section',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      removed: false,
      locked: false,
      children: [] as FakeNode[],
      parent: null,
      fills: [] as unknown[],
      strokes: [] as unknown[],
      strokeWeight: 0,
      pluginData: {} as Record<string, string>,
      ...pluginDataMixin,
      resizeWithoutConstraints(this: FakeNode, width: number, height: number): void {
        this.width = width;
        this.height = height;
      },
      remove(this: FakeNode & FakeParent): void {
        const drop = (node: FakeNode): void => {
          for (const child of node.children ?? []) {
            drop(child);
          }
          node.removed = true;
        };
        drop(this);
        detach(this);
      },
    } as unknown as FakeNode & FakeParent);
  }

  function createShapeWithText(): FakeNode {
    return {
      type: 'SHAPE_WITH_TEXT',
      id: nextId(),
      name: 'Shape',
      shapeType: 'SQUARE',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      removed: false,
      locked: false,
      parent: null,
      fills: [] as unknown[],
      pluginData: {} as Record<string, string>,
      ...pluginDataMixin,
      text: { fontName: { family: 'Inter', style: 'Medium' }, characters: '', fontSize: 0 },
      resize(this: FakeNode, width: number, height: number): void {
        this.width = width;
        this.height = height;
      },
      remove(this: FakeNode): void {
        this.removed = true;
        detach(this);
      },
    } as unknown as FakeNode;
  }

  function createText(): FakeNode {
    // Size follows the characters and font size, as it does on a real text node.
    const internals = { characters: '', fontSize: 12 };
    const text = {
      type: 'TEXT',
      id: nextId(),
      name: 'Text',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      removed: false,
      locked: false,
      parent: null,
      fills: [] as unknown[],
      pluginData: {} as Record<string, string>,
      ...pluginDataMixin,
      fontName: { family: 'Inter', style: 'Medium' },
      remove(this: FakeNode): void {
        this.removed = true;
        detach(this);
      },
    } as unknown as FakeNode;

    const resize = (): void => {
      text.width = internals.characters.length * internals.fontSize * 0.6;
      text.height = internals.fontSize * 1.2;
    };
    Object.defineProperty(text, 'characters', {
      get: () => internals.characters,
      set: (value: string) => {
        internals.characters = value;
        resize();
      },
    });
    Object.defineProperty(text, 'fontSize', {
      get: () => internals.fontSize,
      set: (value: number) => {
        internals.fontSize = value;
        resize();
      },
    });

    page.appendChild(text);
    return text;
  }

  function createSticky(text: string, x: number, y: number): FakeNode {
    const sticky = {
      type: 'STICKY',
      id: nextId(),
      name: text,
      text,
      x,
      y,
      width: 240,
      height: 240,
      removed: false,
      locked: false,
      parent: null,
      pluginData: {} as Record<string, string>,
      ...pluginDataMixin,
      remove(this: FakeNode): void {
        this.removed = true;
        detach(this);
      },
    } as unknown as FakeNode;
    page.appendChild(sticky);
    return sticky;
  }

  const figma = {
    currentPage: page,
    root: { children: [page] },
    mixed: Symbol('mixed'),
    viewport: {
      center: { x: 0, y: 0 },
      scrollAndZoomIntoView(): void {},
    },
    clientStorage: {
      async getAsync(key: string): Promise<unknown> {
        return storage.get(key);
      },
      async setAsync(key: string, value: unknown): Promise<void> {
        storage.set(key, value);
      },
    },
    ui: {
      onmessage: null as null | ((args: unknown) => void),
      postMessage(message: unknown): void {
        uiMessages.push(message);
      },
    },
    showUI(): void {},
    notify(text: string): void {
      notifications.push(text);
    },
    on(type: string, callback: (event: unknown) => void): void {
      globalListeners.push({ type, callback });
    },
    documentListeners(): Array<(event: unknown) => void> {
      return globalListeners.filter((l) => l.type === 'documentchange').map((l) => l.callback);
    },
    createSection,
    createShapeWithText,
    createText,
    async loadFontAsync(): Promise<void> {},
    async getNodeByIdAsync(id: string): Promise<FakeNode | null> {
      const walk = (nodes: FakeNode[]): FakeNode | null => {
        for (const node of nodes) {
          if (node.id === id) {
            return node;
          }
          const found = node.children ? walk(node.children) : null;
          if (found) {
            return found;
          }
        }
        return null;
      };
      return walk(page.children);
    },
  };

  const code = readFileSync(new URL('../build/main.js', import.meta.url), 'utf8');

  function boot(): void {
    runInNewContext(code, {
      figma,
      __html__: '<html></html>',
      setTimeout,
      clearTimeout,
      Date,
      Math,
      Infinity,
      console,
      Symbol,
      Object,
      Array,
      String,
      Number,
      JSON,
      Promise,
      parseFloat,
      isFinite,
    });
  }

  // Reopens the plugin: what the previous run remembered is lost and the event
  // subscriptions are re-established.
  function restart(): void {
    page.listeners.length = 0;
    globalListeners.length = 0;
    boot();
  }

  boot();

  // Approximates FigJam section adoption: a node whose centre is inside belongs
  // to it, one outside is released, and since rows sit inside boards the innermost
  // section wins.
  function settle(): void {
    const sections = page.findAllWithCriteria({ types: ['SECTION'] });
    const depthOf = (node: FakeNode): number => {
      let depth = 0;
      let parent = node.parent;
      while (parent && parent.type === 'SECTION') {
        depth += 1;
        parent = parent.parent;
      }
      return depth;
    };

    const loose: FakeNode[] = [];
    const walk = (nodes: FakeNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'SECTION') {
          walk(node.children ?? []);
        } else {
          loose.push(node);
        }
      }
    };
    walk(page.children);

    for (const node of loose) {
      const pos = absolute(node);
      const cx = pos.x + node.width / 2;
      const cy = pos.y + node.height / 2;

      let host: FakeNode | null = null;
      for (const section of sections) {
        const at = absolute(section);
        const inside =
          cx >= at.x && cx <= at.x + section.width && cy >= at.y && cy <= at.y + section.height;
        if (inside && (host === null || depthOf(section) > depthOf(host))) {
          host = section;
        }
      }

      const target = (host ?? page) as unknown as FakeParent;
      if (node.parent !== target) {
        const at = host === null ? { x: 0, y: 0 } : absolute(host);
        target.appendChild(node);
        node.x = pos.x - at.x;
        node.y = pos.y - at.y;
      }
    }
  }

  // Notifies the plugin that a node changed. Arranging is debounced, so wait with
  // flush.
  function deliver(entries: unknown[], channel: 'both' | 'nodechange' | 'documentchange'): void {
    if (channel === 'both' || channel === 'nodechange') {
      for (const listener of page.listeners) {
        if (listener.type === 'nodechange') {
          listener.callback({ nodeChanges: entries });
        }
      }
    }
    if (channel === 'both' || channel === 'documentchange') {
      for (const listener of globalListeners) {
        if (listener.type === 'documentchange') {
          listener.callback({ documentChanges: entries });
        }
      }
    }
  }

  function entriesFor(nodes: FakeNode | FakeNode[]): unknown[] {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    return list.map((node) => ({
      type: 'PROPERTY_CHANGE',
      id: node.id,
      origin: 'LOCAL',
      node,
      properties: ['x'],
    }));
  }

  function change(nodes: FakeNode | FakeNode[]): void {
    deliver(entriesFor(nodes), 'both');
  }

  function changeVia(channel: 'nodechange' | 'documentchange', nodes: FakeNode | FakeNode[]): void {
    deliver(entriesFor(nodes), channel);
  }

  // Waits past the debounce, then applies section adoption.
  async function flush(ms = 600): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    settle();
  }

  // Replaces the canvas background, which decides a new board's palette.
  function setCanvasBackground(hex: string): void {
    const value = parseInt(hex.slice(1), 16);
    page.backgrounds = [
      {
        type: 'SOLID',
        color: {
          r: ((value >> 16) & 0xff) / 255,
          g: ((value >> 8) & 0xff) / 255,
          b: (value & 0xff) / 255,
        },
      },
    ];
  }

  // Reproduces a canvas selection, which the panel's active board follows.
  function select(nodes: FakeNode | FakeNode[]): void {
    page.selection = Array.isArray(nodes) ? nodes : [nodes];
    for (const listener of globalListeners) {
      if (listener.type === 'selectionchange') {
        listener.callback(undefined);
      }
    }
  }

  // Sends a UI event to main in create-figma-plugin's [name, ...args] envelope.
  async function send(name: string, ...args: unknown[]): Promise<void> {
    if (figma.ui.onmessage === null) {
      throw new Error('plugin did not subscribe to ui messages');
    }
    figma.ui.onmessage([name, ...args]);
    // Handlers are async, so let them progress.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    settle();
  }

  // The panel state main last sent.
  function state(): PanelState {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      const message = uiMessages[i];
      if (Array.isArray(message) && message[0] === 'STATE') {
        return JSON.parse(JSON.stringify(message[1])) as PanelState;
      }
    }
    throw new Error('no STATE message yet');
  }

  // Boards, topmost first.
  function containers(): FakeNode[] {
    return page
      .findAllWithCriteria({ types: ['SECTION'] })
      .filter((s) => s.getPluginData('figjamTierBoardSection') === '1')
      .sort((a, b) => absolute(a).y - absolute(b).y);
  }

  function rowsOf(node: FakeNode): FakeNode[] {
    return (node.children ?? [])
      .filter((child) => child.getPluginData('figjamTierRow') === '1')
      .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  }

  function titleOf(node: FakeNode): FakeNode | null {
    return (
      (node.children ?? []).find(
        (child) => child.type === 'TEXT' && child.getPluginData('figjamTierTitle') === '1',
      ) ?? null
    );
  }

  function rows(): FakeNode[] {
    const out: FakeNode[] = [];
    for (const box of containers()) {
      out.push(...rowsOf(box));
    }
    return out;
  }

  // A tier label carries its owner row id, so a non-empty value marks one.
  function items(row: FakeNode): FakeNode[] {
    return (row.children ?? []).filter(
      (child) =>
        child.getPluginData('figjamTierLabel') === '' &&
        child.getPluginData('figjamTierRow') !== '1' &&
        child.getPluginData('figjamTierBoardSection') !== '1' &&
        child.getPluginData('figjamTierTitle') !== '1',
    );
  }

  // Throws rather than making every test null-check.
  function labelText(row: FakeNode): string {
    const cell = label(row);
    if (cell === null) {
      throw new Error(`row ${row.name} has no label`);
    }
    return (cell.text as { characters: string }).characters;
  }

  function label(row: FakeNode): FakeNode | null {
    return (row.children ?? []).find((child) => child.getPluginData('figjamTierLabel') !== '') ?? null;
  }

  // Places a sticky at a position relative to the row's top left.
  function dropIn(row: FakeNode, text: string, dx: number, dy: number): FakeNode {
    const at = absolute(row);
    const sticky = createSticky(text, at.x + dx, at.y + dy);
    settle();
    return sticky;
  }

  // Attaches straight to the board, reproducing FigJam picking the outer section.
  // settle is not called, as it would move the sticky into the inner row.
  function dropOnBoard(box: FakeNode, text: string, dx: number, dy: number): FakeNode {
    const sticky = createSticky(text, 0, 0);
    (box as FakeParent).appendChild(sticky);
    sticky.x = dx;
    sticky.y = dy;
    return sticky;
  }

  // Nesting a section inside another is FigJam's job, so only the outcome is
  // reproduced.
  function moveRowInto(row: FakeNode, box: FakeNode, y: number): void {
    (box as FakeParent).appendChild(row);
    row.x = 0;
    row.y = y;
    settle();
  }

  return {
    figma,
    page: page as unknown as FakeParent,
    send,
    restart,
    change,
    changeVia,
    flush,
    select,
    setCanvasBackground,
    state,
    rows,
    containers,
    rowsOf,
    titleOf,
    items,
    label,
    labelText,
    createSticky,
    dropIn,
    dropOnBoard,
    moveRowInto,
    settle,
    notifications,
    uiMessages,
    absolute,
  };
}
