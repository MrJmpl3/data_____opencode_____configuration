import { createRenderer } from 'solid-js/universal';

export type MemoryNode = {
  kind: 'element' | 'text';
  type: string;
  value?: string;
  props: Record<string, unknown>;
  children: MemoryNode[];
  parent?: MemoryNode;
};

const renderer = createRenderer<MemoryNode>({
  createElement: (type) => ({ kind: 'element', type, props: {}, children: [] }),
  createTextNode: (value) => ({ kind: 'text', type: '#text', value, props: {}, children: [] }),
  replaceText: (node, value) => {
    node.value = value;
  },
  isTextNode: (node) => node.kind === 'text',
  setProperty: (node, name, value) => {
    node.props[name] = value;
  },
  insertNode: (parent, node, anchor) => {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index === -1) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  removeNode: (parent, node) => {
    parent.children = parent.children.filter((child) => child !== node);
    node.parent = undefined;
  },
  getParentNode: (node) => node.parent,
  getFirstChild: (node) => node.children[0],
  getNextSibling: (node) => {
    if (!node.parent) return undefined;
    const index = node.parent.children.indexOf(node);
    return index >= 0 ? node.parent.children[index + 1] : undefined;
  },
});

export const jsx = (
  type: string | ((props: Record<string, unknown>) => MemoryNode),
  props: Record<string, unknown> = {},
) => {
  if (typeof type === 'function') return renderer.createComponent(type, props);
  const node = renderer.createElement(type);
  renderer.spread(node, props);
  return node;
};

export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = (props: { children?: MemoryNode }) => props.children ?? null;

export const renderMemory = (view: () => MemoryNode): { root: MemoryNode; dispose: () => void } => {
  const root: MemoryNode = { kind: 'element', type: 'root', props: {}, children: [] };
  return { root, dispose: renderer.render(view, root) };
};

export const memoryText = (node: MemoryNode): string =>
  node.kind === 'text' ? (node.value ?? '') : node.children.map(memoryText).join('');

export const memoryElements = (node: MemoryNode, type?: string): MemoryNode[] => {
  const children = node.children.flatMap((child) => memoryElements(child, type));
  return node.kind === 'element' && (type === undefined || node.type === type) ? [node, ...children] : children;
};
