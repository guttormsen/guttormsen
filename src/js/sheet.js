/**
 * Bunnarket på mobil.
 *
 * Et ark som bare kan åpnes ved å treffe en tynn strek er tungvint. Dette kan
 * dras, kastes og settes i tre stillinger: så vidt synlig, halvveis og helt
 * oppe. Stillingen huskes ikke mellom økter – man vil nesten alltid begynne
 * med å se kartet.
 */

/** Andel av arkets høyde som er synlig i hver stilling. */
const SNAPS = { peek: 0, half: 0.55, full: 1 };

/** Fart i piksler per millisekund som regnes som et kast. */
const FLICK_SPEED = 0.45;

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement} grabber flaten man drar i
 * @param {{
 *   peekHeight: () => number,
 *   isActive?: () => boolean,
 *   onChange?: (state: string) => void,
 * }} options
 */
export function createSheet(panel, grabber, { peekHeight, isActive = () => true, onChange } = {}) {
  let state = 'peek';
  let dragging = false;
  let startY = 0;
  let startOffset = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;

  /** Hvor langt ned arket er skjøvet i hver stilling, i piksler. */
  const offsetFor = (name) => {
    const height = panel.offsetHeight;
    const peek = peekHeight();
    const hidden = Math.max(0, height - peek);
    if (name === 'full') return 0;
    if (name === 'half') return Math.max(0, hidden * (1 - SNAPS.half));
    return hidden;
  };

  /**
   * Hvor mange piksler av skjermens underkant arket dekker akkurat nå.
   * Alt som ligger i kartet – «Start turen», stinavnet, meldinger – leser
   * verdien og legger seg rett over arket i stedet for å bli gjemt bak det.
   */
  function publish(covered) {
    document.documentElement.style.setProperty('--sheet-cover', `${Math.round(Math.max(0, covered))}px`);
  }

  function apply(offset, animate = true) {
    if (!isActive()) {
      // På skrivebord er panelet en vanlig spalte ved siden av kartet.
      panel.style.transition = '';
      panel.style.transform = '';
      publish(0);
      return;
    }
    const pushed = Math.max(0, offset);
    panel.style.transition = animate ? '' : 'none';
    panel.style.transform = `translateY(${pushed}px)`;
    publish(panel.offsetHeight - pushed);
  }

  function go(name, { notify = true } = {}) {
    state = name;
    panel.dataset.sheet = name;
    document.body.dataset.sheet = name;
    panel.classList.toggle('is-open', name !== 'peek');
    apply(offsetFor(name));
    if (notify) onChange?.(name);
  }

  /** Nærmeste stilling til en posisjon, med fart tatt i betraktning. */
  function settle(offset) {
    if (Math.abs(velocity) > FLICK_SPEED) {
      // Et kast oppover åpner, et kast nedover lukker – ett hakk om gangen.
      const order = ['peek', 'half', 'full'];
      const index = order.indexOf(state);
      return order[Math.min(order.length - 1, Math.max(0, index + (velocity < 0 ? 1 : -1)))];
    }
    return ['peek', 'half', 'full']
      .map((name) => ({ name, distance: Math.abs(offsetFor(name) - offset) }))
      .sort((a, b) => a.distance - b.distance)[0].name;
  }

  grabber.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    startOffset = offsetFor(state);
    grabber.setPointerCapture(event.pointerId);
    panel.style.transition = 'none';
  });

  grabber.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    const elapsed = event.timeStamp - lastTime;
    if (elapsed > 0) velocity = (event.clientY - lastY) / elapsed;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    // Litt motstand når man drar forbi ytterstillingene.
    const raw = startOffset + delta;
    const max = offsetFor('peek');
    const eased = raw < 0 ? raw / 3 : raw > max ? max + (raw - max) / 3 : raw;
    apply(eased, false);
    event.preventDefault();
  });

  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    grabber.releasePointerCapture?.(event.pointerId);
    const moved = Math.abs(event.clientY - startY);
    // Kort trykk uten bevegelse er et trykk, ikke et drag.
    if (moved < 6) {
      go(state === 'peek' ? 'half' : 'peek');
      return;
    }
    go(settle(startOffset + (event.clientY - startY)));
  };
  grabber.addEventListener('pointerup', end);
  grabber.addEventListener('pointercancel', end);

  // Stillingene måles i piksler, så de må regnes om når skjermen endrer seg.
  const reflow = () => apply(offsetFor(state), false);
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);
  document.body.dataset.sheet = state;
  reflow();

  return {
    go,
    reflow,
    get state() {
      return state;
    },
    /** Åpner arket hvis det er lukket, men drar det ikke lenger ned. */
    atLeast(name) {
      const order = ['peek', 'half', 'full'];
      if (order.indexOf(name) > order.indexOf(state)) go(name);
    },
  };
}
