// Figma Plugin API の最小モック。dist/code.js をそのまま読み込んで、
// UI からのメッセージで駆動し、キャンバスの状態を検査できるようにする。
//
// セクションの「幾何的に内包したノードを自動的に子にする」挙動も再現する。
// この挙動に依存した実装（付箋の所属判定、行の削除時の退避）を試すため。

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

let idCounter = 0;
const nextId = () => `${++idCounter}:1`;

function detach(node) {
  if (node.parent === null) return;
  const siblings = node.parent.children;
  siblings.splice(siblings.indexOf(node), 1);
  node.parent = null;
}

function container(node) {
  node.appendChild = (child) => {
    detach(child);
    child.parent = node;
    node.children.push(child);
  };
  return node;
}

export function absolute(node) {
  let x = node.x;
  let y = node.y;
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE') {
    x += parent.x;
    y += parent.y;
    parent = parent.parent;
  }
  return { x, y };
}

export function createHarness() {
  const page = container({
    type: 'PAGE',
    id: '0:1',
    name: 'Page 1',
    children: [],
    parent: null,
    x: 0,
    y: 0,
    selection: [],
    listeners: [],
    on(type, callback) {
      this.listeners.push({ type, callback });
    },
    findAllWithCriteria({ types }) {
      const out = [];
      const walk = (nodes) => {
        for (const node of nodes) {
          if (types.includes(node.type)) out.push(node);
          if (node.children) walk(node.children);
        }
      };
      walk(this.children);
      return out;
    },
  });

  const notifications = [];
  const uiMessages = [];

  function createSection() {
    const section = container({
      type: 'SECTION',
      id: nextId(),
      name: 'Section',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      children: [],
      parent: null,
      fills: [],
      pluginData: {},
      getPluginData(key) {
        return this.pluginData[key] ?? '';
      },
      setPluginData(key, value) {
        this.pluginData[key] = value;
      },
      resizeWithoutConstraints(width, height) {
        this.width = width;
        this.height = height;
      },
      remove() {
        const drop = (node) => {
          for (const child of node.children ?? []) drop(child);
          node.removed = true;
        };
        drop(this);
        detach(this);
      },
    });
    return section;
  }

  function createShapeWithText() {
    return {
      type: 'SHAPE_WITH_TEXT',
      id: nextId(),
      name: 'Shape',
      shapeType: 'SQUARE',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      locked: false,
      parent: null,
      fills: [],
      pluginData: {},
      text: { fontName: { family: 'Inter', style: 'Medium' }, characters: '', fontSize: 0 },
      getPluginData(key) {
        return this.pluginData[key] ?? '';
      },
      setPluginData(key, value) {
        this.pluginData[key] = value;
      },
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    };
  }

  function createText() {
    const text = {
      type: 'TEXT',
      id: nextId(),
      name: 'Text',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      parent: null,
      pluginData: {},
      fontName: { family: 'Inter', style: 'Medium' },
      _characters: '',
      _fontSize: 12,
      get characters() {
        return this._characters;
      },
      set characters(value) {
        this._characters = value;
        this.width = value.length * this._fontSize * 0.6;
        this.height = this._fontSize * 1.2;
      },
      get fontSize() {
        return this._fontSize;
      },
      set fontSize(value) {
        this._fontSize = value;
        this.width = this._characters.length * value * 0.6;
        this.height = value * 1.2;
      },
      getPluginData(key) {
        return this.pluginData[key] ?? '';
      },
      setPluginData(key, value) {
        this.pluginData[key] = value;
      },
      remove() {
        this.removed = true;
        detach(this);
      },
    };
    page.appendChild(text);
    return text;
  }

  const storage = new Map();

  const globalListeners = [];

  const figma = {
    currentPage: page,
    on(type, callback) {
      globalListeners.push({ type, callback });
    },
    root: { children: [page] },
    viewport: {
      center: { x: 0, y: 0 },
      scrollAndZoomIntoView() {},
    },
    clientStorage: {
      async getAsync(key) {
        return storage.get(key);
      },
      async setAsync(key, value) {
        storage.set(key, value);
      },
    },
    ui: {
      onmessage: null,
      postMessage(message) {
        uiMessages.push(message);
      },
    },
    showUI() {},
    notify(text) {
      notifications.push(text);
    },
    createSection,
    createShapeWithText,
    createText,
    async loadFontAsync() {},
    async getNodeByIdAsync(id) {
      const walk = (nodes) => {
        for (const node of nodes) {
          if (node.id === id) return node;
          const found = node.children ? walk(node.children) : null;
          if (found) return found;
        }
        return null;
      };
      return walk(page.children);
    },
  };

  const sandbox = { figma, __html__: '<html></html>', setTimeout, clearTimeout, Date, Math, Infinity, console };
  const code = readFileSync(new URL('../dist/code.js', import.meta.url), 'utf8');
  runInNewContext(code, sandbox);

  // FigJam のセクションは、重なったノードを自動的に子にする。中心が入って
  // いれば取り込み、外に出れば手放す、として近似する。盤面のセクションの中に
  // 行のセクションがあるので、いちばん内側のセクションに属させる。
  function settle() {
    const sections = page.findAllWithCriteria({ types: ['SECTION'] });
    const depthOf = (node) => {
      let depth = 0;
      let parent = node.parent;
      while (parent && parent.type === 'SECTION') {
        depth += 1;
        parent = parent.parent;
      }
      return depth;
    };

    const loose = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'SECTION') walk(node.children);
        else loose.push(node);
      }
    };
    walk(page.children);

    for (const node of loose) {
      const pos = absolute(node);
      const cx = pos.x + node.width / 2;
      const cy = pos.y + node.height / 2;

      let host = null;
      for (const section of sections) {
        const at = absolute(section);
        const inside =
          cx >= at.x && cx <= at.x + section.width && cy >= at.y && cy <= at.y + section.height;
        if (inside && (host === null || depthOf(section) > depthOf(host))) {
          host = section;
        }
      }

      const target = host ?? page;
      if (node.parent !== target) {
        const at = target === page ? { x: 0, y: 0 } : absolute(target);
        target.appendChild(node);
        node.x = pos.x - at.x;
        node.y = pos.y - at.y;
      }
    }
  }

  // 行を別の盤面へ入れる。セクションを別のセクションへ入れ子にするのは
  // FigJam 側の仕事なので、その結果だけを再現する。
  function moveRowInto(row, container, y) {
    container.appendChild(row);
    row.x = 0;
    row.y = y;
    settle();
  }

  // 行の中の座標（左上からの相対）を指定して付箋を置く
  function dropIn(row, text, dx, dy) {
    const at = absolute(row);
    const sticky = createSticky(text, at.x + dx, at.y + dy);
    settle();
    return sticky;
  }

  function createSticky(text, x, y) {
    const sticky = {
      type: 'STICKY',
      id: nextId(),
      name: text,
      text,
      x,
      y,
      width: 240,
      height: 240,
      parent: null,
    };
    page.appendChild(sticky);
    return sticky;
  }

  async function send(message) {
    await figma.ui.onmessage(message);
    settle();
  }

  // キャンバス側でノードが変わったことを通知する。プラグインはこれを拾って
  // デバウンス付きで整列するので、待つときは flush を使う。
  function change(nodes) {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    for (const listener of page.listeners) {
      if (listener.type !== 'nodechange') continue;
      listener.callback({
        nodeChanges: list.map((node) => ({
          type: 'PROPERTY_CHANGE',
          id: node.id,
          origin: 'LOCAL',
          node,
          properties: ['x'],
        })),
      });
    }
  }

  // デバウンスと抑制窓を越えるまで待ってから、セクションの取り込みを反映する。
  async function flush(ms = 500) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    settle();
  }

  // キャンバスでの選択を再現する。パネルの操作対象がこれに追従する。
  function select(nodes) {
    page.selection = Array.isArray(nodes) ? nodes : [nodes];
    for (const listener of globalListeners) {
      if (listener.type === 'selectionchange') {
        listener.callback();
      }
    }
  }

  // vm 側で作られたオブジェクトはプロトタイプがテスト側と違い、deepEqual が
  // 素通りしない。素の値に写して返す。
  function lastUiMessage() {
    const message = uiMessages[uiMessages.length - 1];
    return message === undefined ? undefined : JSON.parse(JSON.stringify(message));
  }

  function items(row) {
    return row.children.filter((child) => child.getPluginData?.('figjamTierLabel') !== '1');
  }

  function label(row) {
    return row.children.find((child) => child.getPluginData?.('figjamTierLabel') === '1') ?? null;
  }

  // 盤面（行を包むセクション）を上から順に
  function containers() {
    return page
      .findAllWithCriteria({ types: ['SECTION'] })
      .filter((s) => s.getPluginData('figjamTierBoardSection') === '1')
      .sort((a, b) => absolute(a).y - absolute(b).y);
  }

  function rowsOf(container) {
    return container.children
      .filter((c) => c.getPluginData?.('figjamTierRow') === '1')
      .sort((a, b) => a.y - b.y);
  }

  function titleOf(container) {
    return container.children.find(
      (c) => c.type === 'TEXT' && c.getPluginData?.('figjamTierTitle') === '1',
    ) ?? null;
  }

  function rows() {
    return page
      .findAllWithCriteria({ types: ['SECTION'] })
      .filter((s) => s.getPluginData('figjamTierRow') === '1')
      .sort((a, b) => a.y - b.y);
  }

  return {
    figma,
    page,
    send,
    change,
    flush,
    select,
    rows,
    containers,
    rowsOf,
    titleOf,
    items,
    label,
    createSticky,
    dropIn,
    moveRowInto,
    settle,
    notifications,
    uiMessages,
    lastUiMessage,
    absolute,
  };
}
