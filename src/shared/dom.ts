// Minimal DOM helpers (no framework; must run on old TV browser engines).

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  testid?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.id) el.id = props.id;
    if (props.testid) el.setAttribute('data-testid', props.testid);
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) for (const k in props.attrs) el.setAttribute(k, props.attrs[k]);
    if (props.on) {
      for (const k in props.on) {
        const fn = props.on[k as keyof HTMLElementEventMap];
        if (fn) el.addEventListener(k, fn as EventListener);
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function mount(root: HTMLElement, ...nodes: Node[]): void {
  root.textContent = '';
  for (const n of nodes) root.appendChild(n);
}
