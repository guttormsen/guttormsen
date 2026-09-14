import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloseStack } from '../src/js/closestack.js';

/** Enkel historikk som teller oppføringer, slik nettleseren gjør. */
function fakeHistory() {
  const entries = [];
  const listeners = [];
  globalThis.addEventListener = (type, fn) => {
    if (type === 'popstate') listeners.push(fn);
  };
  return {
    entries,
    pushState: (state) => entries.push(state),
    back: () => {
      entries.pop();
      for (const fn of listeners) fn({});
    },
    /** Som når brukeren selv trykker tilbake. */
    userBack: () => {
      entries.pop();
      for (const fn of listeners) fn({});
    },
  };
}

test('lukker det øverste laget først', () => {
  const lukket = [];
  const stack = createCloseStack({ hasWatcher: false, history: fakeHistory() });
  stack.push('ark', () => lukket.push('ark'));
  stack.push('filtre', () => lukket.push('filtre'));

  assert.deepEqual(stack.names, ['ark', 'filtre']);
  assert.equal(stack.pop(), 'filtre');
  assert.deepEqual(lukket, ['filtre']);
  assert.equal(stack.pop(), 'ark');
  assert.deepEqual(lukket, ['filtre', 'ark']);
});

test('tom stabel sier fra i stedet for å lukke noe', () => {
  const stack = createCloseStack({ hasWatcher: false, history: fakeHistory() });
  assert.equal(stack.pop(), null);
  assert.equal(stack.depth, 0);
});

test('samme lag ligger bare én gang', () => {
  const stack = createCloseStack({ hasWatcher: false, history: fakeHistory() });
  stack.push('kartlag', () => {});
  stack.push('kartlag', () => {});
  assert.deepEqual(stack.names, ['kartlag']);
});

test('et lag som lukkes selv, forsvinner fra stabelen', () => {
  const lukket = [];
  const stack = createCloseStack({ hasWatcher: false, history: fakeHistory() });
  const slippArk = stack.push('ark', () => lukket.push('ark'));
  stack.push('filtre', () => lukket.push('filtre'));

  slippArk();
  assert.deepEqual(stack.names, ['filtre']);
  // Laget lukket seg selv; stabelen skal ikke lukke det en gang til.
  assert.deepEqual(lukket, []);
});

test('legger én historikkoppføring per lag uten CloseWatcher', () => {
  const history = fakeHistory();
  const stack = createCloseStack({ hasWatcher: false, history });
  stack.push('ark', () => {});
  stack.push('filtre', () => {});
  assert.equal(history.entries.length, 2);
});

test('tilbake i historikken lukker ett lag om gangen', () => {
  const lukket = [];
  const history = fakeHistory();
  const stack = createCloseStack({ hasWatcher: false, history });
  stack.push('ark', () => lukket.push('ark'));
  stack.push('filtre', () => lukket.push('filtre'));

  history.userBack();
  assert.deepEqual(lukket, ['filtre']);
  assert.deepEqual(stack.names, ['ark']);

  history.userBack();
  assert.deepEqual(lukket, ['filtre', 'ark']);
  assert.equal(stack.depth, 0);
});

test('vår egen rygging teller ikke som et tilbaketrykk', () => {
  const lukket = [];
  const history = fakeHistory();
  const stack = createCloseStack({ hasWatcher: false, history });
  stack.push('ark', () => lukket.push('ark'));
  const slippFiltre = stack.push('filtre', () => lukket.push('filtre'));

  // Brukeren trykket «Vis turer» i stedet for tilbake.
  slippFiltre();
  assert.deepEqual(stack.names, ['ark'], 'arket skal fortsatt ligge der');
  assert.deepEqual(lukket, [], 'ingen skal lukkes to ganger');
});

test('CloseWatcher brukes når nettleseren har den', () => {
  const lukket = [];
  let laget = null;
  class FakeWatcher {
    constructor() {
      laget = this;
      this.onclose = null;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  globalThis.CloseWatcher = FakeWatcher;
  try {
    const stack = createCloseStack({ hasWatcher: true });
    assert.equal(stack.usesWatcher, true);
    stack.push('ark', () => lukket.push('ark'));
    stack.push('filtre', () => lukket.push('filtre'));

    // Én lukkeforespørsel fra systemet – Escape eller tilbakeknappen.
    laget.onclose();
    assert.deepEqual(lukket, ['filtre']);
    // Nytt lag igjen er væpnet, så neste tilbake tar arket.
    laget.onclose();
    assert.deepEqual(lukket, ['filtre', 'ark']);
    assert.equal(stack.depth, 0);
  } finally {
    delete globalThis.CloseWatcher;
  }
});
