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

  const storage = new Map();

  const figma = {
    currentPage: page,
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

  // FigJam のセクションは、重なったノードを自動的に子にする。中心が
  // セクションの矩形に入っていれば取り込み、外に出れば手放す、として近似する。
  function settle() {
    const sections = page.findAllWithCriteria({ types: ['SECTION'] });
    for (const section of sections) {
      for (const child of [...section.children]) {
        const pos = absolute(child);
        const cx = pos.x + child.width / 2;
        const cy = pos.y + child.height / 2;
        const inside =
          cx >= section.x && cx <= section.x + section.width && cy >= section.y && cy <= section.y + section.height;
        if (!inside) {
          page.appendChild(child);
          child.x = pos.x;
          child.y = pos.y;
        }
      }
    }
    for (const node of [...page.children]) {
      if (node.type === 'SECTION') continue;
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const host = sections.find(
        (s) => cx >= s.x && cx <= s.x + s.width && cy >= s.y && cy <= s.y + s.height,
      );
      if (host) {
        host.appendChild(node);
        node.x -= host.x;
        node.y -= host.y;
      }
    }
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

  function rows() {
    return page
      .findAllWithCriteria({ types: ['SECTION'] })
      .filter((s) => s.getPluginData('figjamTierRow') === '1')
      .sort((a, b) => a.y - b.y);
  }

  return { figma, page, send, rows, createSticky, settle, notifications, uiMessages, absolute };
}
