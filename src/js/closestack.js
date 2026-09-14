/**
 * Ett sted å samle «lukk det øverste laget».
 *
 * Lagt til hjemskjerm har appen ingen nettleserlinje, og da er tilbakeknappen
 * på Android – eller sveipen fra kanten på iPhone – den eneste veien tilbake.
 * Uten dette lukker den hele appen midt i en tur. Her får hvert lag som åpnes
 * si fra, og en lukkeforespørsel tar det øverste først.
 *
 * Nyere nettlesere har CloseWatcher, som er laget nettopp for dette og som
 * også fanger Escape. Der den mangler, legger vi en oppføring i historikken
 * per lag og hører etter popstate. Begge veier ender i samme stabel.
 */

const HAS_WATCHER = typeof globalThis.CloseWatcher === 'function';

/** Merke på historikkoppføringene våre, så vi ikke tar andres. */
const MARK = 'lykkeligtur-lag';

export function createCloseStack({ hasWatcher = HAS_WATCHER, history = globalThis.history } = {}) {
  /** @type {{ name: string, close: () => void }[]} */
  const layers = [];
  let watcher = null;
  /** Sant mens vi selv rygger i historikken, så popstate ikke lukker to lag. */
  let unwinding = false;

  function arm() {
    if (!hasWatcher || watcher || !layers.length) return;
    watcher = new globalThis.CloseWatcher();
    watcher.onclose = () => {
      watcher = null;
      pop();
      // Er det flere lag igjen, må neste forespørsel også fanges.
      arm();
    };
  }

  function disarm() {
    if (!watcher) return;
    watcher.destroy?.();
    watcher = null;
  }

  /** Lukker det øverste laget. Returnerer navnet, eller null om alt var lukket. */
  function pop() {
    const layer = layers.pop();
    if (!layer) return null;
    layer.close();
    if (!layers.length) disarm();
    return layer.name;
  }

  /**
   * Melder inn et lag som er åpnet. Kall den i samme handling som åpner laget –
   * både CloseWatcher og pushState krever at brukeren nettopp gjorde noe.
   *
   * @param {string} name
   * @param {() => void} close rydder opp i laget. Kalles én gang.
   * @returns {() => void} kall denne når laget lukkes på egen hånd
   */
  function push(name, close) {
    // Samme lag skal ikke ligge to ganger.
    const already = layers.findIndex((layer) => layer.name === name);
    if (already >= 0) layers.splice(already, 1);

    const layer = { name, close };
    layers.push(layer);
    if (hasWatcher) arm();
    else if (history) history.pushState({ [MARK]: layers.length }, '');

    return () => {
      const index = layers.indexOf(layer);
      if (index < 0) return;
      layers.splice(index, 1);
      if (!layers.length) disarm();
      // Historikkoppføringen ryddes bort så tilbake ikke blir et tomt trykk.
      if (!hasWatcher && history) {
        unwinding = true;
        history.back();
      }
    };
  }

  if (!hasWatcher) {
    globalThis.addEventListener?.('popstate', () => {
      if (unwinding) {
        unwinding = false;
        return;
      }
      pop();
    });
  }

  return {
    push,
    /** Lukker øverste lag. Brukes av Escape der CloseWatcher mangler. */
    pop,
    get depth() {
      return layers.length;
    },
    /** Navnene nedenfra og opp – nyttig i tester. */
    get names() {
      return layers.map((layer) => layer.name);
    },
    get usesWatcher() {
      return hasWatcher;
    },
  };
}
