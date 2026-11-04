// Small DOM helpers. All text goes in through textContent, never innerHTML.

type AttrValue = string | number | boolean | null | undefined;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export type ToastKind = 'info' | 'pass' | 'fail' | 'warn';

export function toast(message: string, kind: ToastKind = 'info', ms = 4200): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const node = el('div', { class: `toast toast-${kind}`, role: kind === 'fail' ? 'alert' : 'status' }, message);
  host.append(node);
  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 250);
  }, ms);
}

/**
 * Copies text to the clipboard. Uses the Clipboard API where the page allows it (HTTPS or localhost)
 * and falls back to a hidden textarea + execCommand on plain-HTTP pages, such as the preview shared on the network.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the older way */
    }
  }
  const back = document.activeElement as HTMLElement | null;
  const area = el('textarea', { readonly: true, 'aria-hidden': 'true', tabindex: '-1', class: 'copy-buffer' });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  back?.focus({ preventScroll: true });
  return ok;
}

export function startClock(node: HTMLElement): void {
  const tick = (): void => {
    const now = new Date();
    node.textContent = now.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    node.setAttribute('datetime', now.toISOString());
  };
  tick();
  window.setInterval(tick, 10_000);
}
