// Figma Plugin API の最小モック。ビルド済みの build/main.js をそのまま読み込んで、
// UI からのイベントで駆動し、キャンバスの状態を検査できるようにする。
//
// セクションの「幾何的に内包したノードを自動的に子にする」挙動（入れ子も含む）
// も再現する。この挙動に依存した実装を試すため。
//
// モックは実物の形に合わせること。ずれていると、そこに依存したバグをテストが
// 素通りさせる。下の ModeledProps / 型アサーションがその歯止め。

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import type { PanelState } from '../src/events';

// プラグインが実際に触るプロパティ。ここに挙げたものは、実物の型と一致して
// いなければコンパイルで落ちる（値の型も、存在そのものも）。
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
  // テストから読むもの。実物にもあるが、モックでは必要な分だけ宣言する。
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

// モックが実物のサブセットとして通ることを保証する歯止め
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
    // 実物の PageNode は backgrounds を持つ。FigJam のライトの既定は実測 #E5E5E5。
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
    // 文字とフォントサイズからサイズを決める。実物のテキストノードも文字を
    // 入れると寸法が変わるので、そこだけ真似る。
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

  // プラグインを開き直す。前回の実行が覚えていたこと（整列が最後に書いた位置、
  // どの付箋がどの行にいたか）は失われ、イベントの購読も張り直しになる。
  function restart(): void {
    page.listeners.length = 0;
    globalListeners.length = 0;
    boot();
  }

  boot();

  // FigJam のセクションは、重なったノードを自動的に子にする。中心が入って
  // いれば取り込み、外に出れば手放す、として近似する。盤面のセクションの中に
  // 行のセクションがあるので、いちばん内側のセクションに属させる。
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

  // キャンバス側でノードが変わったことを通知する。プラグインはこれを拾って
  // デバウンス付きで整列するので、待つときは flush を使う。
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

  // デバウンスと反響の判定を越えるまで待ってから、セクションの取り込みを反映する。
  async function flush(ms = 600): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    settle();
  }

  // キャンバス背景を差し替える。新しい盤面の配色がこれで決まる。
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

  // キャンバスでの選択を再現する。パネルの操作対象がこれに追従する。
  function select(nodes: FakeNode | FakeNode[]): void {
    page.selection = Array.isArray(nodes) ? nodes : [nodes];
    for (const listener of globalListeners) {
      if (listener.type === 'selectionchange') {
        listener.callback(undefined);
      }
    }
  }

  // UI から main へイベントを送る。封筒は create-figma-plugin の [name, ...args]。
  async function send(name: string, ...args: unknown[]): Promise<void> {
    if (figma.ui.onmessage === null) {
      throw new Error('plugin did not subscribe to ui messages');
    }
    figma.ui.onmessage([name, ...args]);
    // ハンドラは非同期なので、進むまで待つ
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    settle();
  }

  // main が最後に送ってきたパネルの状態
  function state(): PanelState {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      const message = uiMessages[i];
      if (Array.isArray(message) && message[0] === 'STATE') {
        return JSON.parse(JSON.stringify(message[1])) as PanelState;
      }
    }
    throw new Error('no STATE message yet');
  }

  // 盤面（行を包むセクション）を上から順に
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

  // 色セルは持ち主の行 ID を持つ（空でなければ色セル）
  function items(row: FakeNode): FakeNode[] {
    return (row.children ?? []).filter(
      (child) =>
        child.getPluginData('figjamTierLabel') === '' &&
        child.getPluginData('figjamTierRow') !== '1' &&
        child.getPluginData('figjamTierBoardSection') !== '1' &&
        child.getPluginData('figjamTierTitle') !== '1',
    );
  }

  // 色セルの文字。無ければ落とす（テストから毎回 null 検査したくない）
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

  // 行の中の座標（左上からの相対）を指定して付箋を置く
  function dropIn(row: FakeNode, text: string, dx: number, dy: number): FakeNode {
    const at = absolute(row);
    const sticky = createSticky(text, at.x + dx, at.y + dy);
    settle();
    return sticky;
  }

  // 盤面（外側のセクション）に直接ぶら下げる。FigJam が入れ子のうち外側に
  // 付けた場合を再現する。settle は呼ばない（呼ぶと内側の行へ移ってしまう）。
  function dropOnBoard(box: FakeNode, text: string, dx: number, dy: number): FakeNode {
    const sticky = createSticky(text, 0, 0);
    (box as FakeParent).appendChild(sticky);
    sticky.x = dx;
    sticky.y = dy;
    return sticky;
  }

  // 行を別の盤面へ入れる。セクションを別のセクションへ入れ子にするのは
  // FigJam 側の仕事なので、その結果だけを再現する。
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
