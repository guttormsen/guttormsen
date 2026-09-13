/** Små UI-byggeklosser: varsler, bekreftelser og nedlasting. */
import { el } from './util.js';

let host = null;

function ensureHost() {
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/**
 * Viser en kort melding nederst på skjermen.
 * @param {string} message
 * @param {{ kind?: 'info'|'ok'|'advarsel'|'feil', duration?: number }} [options]
 */
export function toast(message, { kind = 'info', duration = 4200 } = {}) {
  const node = el('div', { class: `toast toast--${kind}`, text: message });
  ensureHost().append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  const remove = () => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 250);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

/** Laster ned en tekstfil fra nettleseren. */
export function downloadText(filename, text, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Kopierer til utklippstavla, med fallback for nettlesere uten Clipboard API. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = el('textarea', { class: 'visually-hidden' });
    field.value = text;
    document.body.append(field);
    field.select();
    const ok = document.execCommand?.('copy') ?? false;
    field.remove();
    return ok;
  }
}

/** Enkel av/på-knapperad. `options` er `{id, label, hint}`. */
export function segmented(name, options, value, onChange) {
  return el(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map((option) =>
      el('button', {
        type: 'button',
        role: 'radio',
        class: 'segmented__item',
        'aria-checked': String(option.id === value),
        title: option.hint ?? '',
        text: option.label,
        onclick: () => onChange(option.id),
      }),
    ),
  );
}
