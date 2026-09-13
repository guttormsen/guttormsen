/**
 * Stedsnavnsøk som tilgjengelig combobox (ARIA 1.2-mønsteret).
 * Piltaster blar i treffene, Enter velger, Escape lukker.
 */
import { searchPlaces } from './api/stedsnavn.js';
import { debounce, el, render } from './util.js';

export function createSearch({ input, listbox, status }, { onPick } = {}) {
  let results = [];
  let active = -1;
  let controller = null;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listbox.id);
  listbox.setAttribute('role', 'listbox');

  function close() {
    results = [];
    active = -1;
    listbox.hidden = true;
    render(listbox);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function highlight(index) {
    active = index;
    Array.from(listbox.children).forEach((node, i) => {
      const selected = i === index;
      node.setAttribute('aria-selected', String(selected));
      node.classList.toggle('is-active', selected);
      if (selected) node.scrollIntoView({ block: 'nearest' });
    });
    if (index >= 0) input.setAttribute('aria-activedescendant', listbox.children[index].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function show(places, query) {
    results = places;
    active = -1;
    if (!places.length) {
      listbox.hidden = true;
      render(listbox);
      input.setAttribute('aria-expanded', 'false');
      status.textContent = query ? `Ingen steder heter «${query}».` : '';
      return;
    }
    render(
      listbox,
      places.map((place, index) =>
        el(
          'li',
          {
            id: `sted-${index}`,
            role: 'option',
            class: 'search__option',
            'aria-selected': 'false',
            onmousedown: (event) => {
              event.preventDefault();
              pick(index);
            },
          },
          [
            el('span', { class: 'search__name', text: place.name }),
            el('span', {
              class: 'search__meta',
              text: [place.type, place.municipality, place.county].filter(Boolean).join(' · '),
            }),
          ],
        ),
      ),
    );
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = `${places.length} ${places.length === 1 ? 'treff' : 'treff'} på «${query}».`;
  }

  function pick(index) {
    const place = results[index];
    if (!place) return;
    input.value = place.name;
    close();
    status.textContent = `Viser ${place.name}.`;
    onPick?.(place);
  }

  const run = debounce(async (query) => {
    controller?.abort();
    controller = new AbortController();
    try {
      const places = await searchPlaces(query, { signal: controller.signal });
      show(places, query);
    } catch (error) {
      if (controller.signal.aborted) return;
      status.textContent = 'Søket feilet. Sjekk nettforbindelsen.';
      console.warn('Stedsnavnsøk feilet', error);
    }
  }, 220);

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (query.length < 2) {
      run.cancel();
      controller?.abort();
      close();
      status.textContent = '';
      return;
    }
    run(query);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      highlight((active + 1) % results.length);
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && results.length) {
      highlight(active <= 0 ? results.length - 1 : active - 1);
      event.preventDefault();
    } else if (event.key === 'Enter') {
      if (active >= 0) {
        pick(active);
        event.preventDefault();
      } else if (results.length === 1) {
        pick(0);
        event.preventDefault();
      }
    } else if (event.key === 'Escape') {
      close();
      status.textContent = '';
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  return { close };
}
