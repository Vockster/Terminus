// A deliberately small DOM double for sidebar controllers. It models only what
// those controllers rely on: element trees, class selectors, bubbling events,
// `hidden`, and focus that a hidden or detached element cannot keep.

function classSelector(selector) {
  const names = selector.split(",").map((part) => part.trim());
  for (const name of names) {
    if (!/^\.[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`Fake DOM supports class selectors only: ${selector}`);
    }
  }
  return names.map((name) => name.slice(1));
}

export function createFakeDocument() {
  let focused = null;

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.placeholder = "";
      this.type = "";
      this.draggable = false;
      this.className = "";
      this.textContent = "";
      this.style = {
        properties: new Map(),
        setProperty: (name, value) => this.style.properties.set(name, value)
      };
    }

    get classList() {
      const names = () => this.className.split(/\s+/).filter(Boolean);
      return {
        contains: (name) => names().includes(name),
        add: (...added) => {
          this.className = [...new Set([...names(), ...added])].join(" ");
        },
        remove: (...removed) => {
          this.className = names().filter((name) => !removed.includes(name)).join(" ");
        }
      };
    }

    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === document.body;
    }

    get nextElementSibling() {
      const siblings = this.parentNode?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    #adopt(nodes) {
      const adopted = [];
      for (const node of nodes) {
        if (node.isFragment) {
          adopted.push(...node.children.splice(0));
        } else {
          adopted.push(node);
        }
      }
      for (const node of adopted) {
        node.parentNode?.removeChild(node);
        node.parentNode = this;
      }
      return adopted;
    }

    append(...nodes) {
      this.children.push(...this.#adopt(nodes));
    }

    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this.append(...nodes);
    }

    insertBefore(node, reference) {
      const [adopted] = this.#adopt([node]);
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, adopted);
    }

    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
      node.parentNode = null;
    }

    contains(node) {
      for (let current = node; current; current = current.parentNode) {
        if (current === this) return true;
      }
      return false;
    }

    matches(selector) {
      return classSelector(selector).some((name) => this.classList.contains(name));
    }

    closest(selector) {
      for (let current = this; current; current = current.parentNode) {
        if (current.matches?.(selector)) return current;
      }
      return null;
    }

    querySelectorAll(selector) {
      const found = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    dispatchEvent(event) {
      event.target ??= this;
      for (let node = this; node && !event.propagationStopped; node = node.parentNode) {
        for (const listener of node.listeners?.get(event.type) ?? []) {
          listener(event);
        }
      }
      return !event.defaultPrevented;
    }

    focus() {
      if (this.isConnected && !this.disabled && visible(this)) focused = this;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent(createEvent("click"));
    }
  }

  function visible(element) {
    for (let node = element; node; node = node.parentNode) {
      if (node.hidden) return false;
    }
    return true;
  }

  const document = {
    body: null,
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment() {
      const fragment = new FakeElement("#fragment");
      fragment.isFragment = true;
      return fragment;
    },
    get activeElement() {
      if (focused && focused.isConnected && visible(focused)) return focused;
      return document.body;
    }
  };
  document.body = new FakeElement("body");
  return document;
}

export function createEvent(type, properties = {}) {
  return {
    type,
    target: null,
    defaultPrevented: false,
    propagationStopped: false,
    isComposing: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...properties
  };
}

export function element(document, tagName, { id, className, hidden = false } = {}, children = []) {
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (className) node.className = className;
  node.hidden = hidden;
  node.append(...children);
  return node;
}
