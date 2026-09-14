/**
 * Telegram. Ut og inn.
 *
 * Token ligger som hemmelighet i Cloudflare, aldri i koden. Feil herfra skal
 * ikke velte det hun holder på med – blir en melding liggende usendt, er det
 * fortsatt viktigere at dagen ble lagret.
 */

const api = (env, metode) => `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metode}`;

async function kall(env, metode, kropp) {
  if (!env.TELEGRAM_TOKEN) {
    console.warn('Telegram er ikke satt opp – hopper over.');
    return null;
  }
  try {
    const svar = await fetch(api(env, metode), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kropp),
    });
    const data = await svar.json().catch(() => null);
    if (!svar.ok || data?.ok === false) {
      console.warn('Telegram svarte', svar.status, JSON.stringify(data));
      return null;
    }
    return data?.result ?? true;
  } catch (feil) {
    console.warn('Fikk ikke kontakt med Telegram:', feil?.message ?? feil);
    return null;
  }
}

/**
 * Sender en melding.
 *
 * `knapper` er rader med [tekst, data]. De gjør varselet om fra en beskjed til
 * noe man kan svare på uten å åpne noe som helst.
 */
export async function sendTelegram(env, tekst, { stille = false, knapper = null, chat = null } = {}) {
  const kropp = {
    chat_id: chat ?? env.TELEGRAM_CHAT_ID,
    text: tekst,
    disable_notification: stille,
    link_preview_options: { is_disabled: true },
  };
  if (knapper?.length) kropp.reply_markup = tastatur(knapper);
  return Boolean(await kall(env, 'sendMessage', kropp));
}

/** Tar bort «laster»-sirkelen på knappen han nettopp trykket. */
export const kvitterTrykk = (env, id, tekst) =>
  kall(env, 'answerCallbackQuery', { callback_query_id: id, text: tekst });

/**
 * Bytter ut knappene med det han valgte, så meldingen viser hva som ble
 * svart – og så ingen trykker to ganger.
 */
export const byttUtKnapper = (env, chat, melding, tekst) =>
  kall(env, 'editMessageReplyMarkup', {
    chat_id: chat,
    message_id: melding,
    reply_markup: { inline_keyboard: [[{ text: tekst, callback_data: 'gjort' }]] },
  });

const tastatur = (knapper) => ({
  inline_keyboard: knapper.map((rad) => rad.map(([t, d]) => ({ text: t, callback_data: d }))),
});

/**
 * Skriver om meldingen han allerede ser på.
 *
 * Det er det som gjør menyen til en meny: én melding som bytter innhold,
 * i stedet for en ny melding for hvert trykk.
 */
export const endreMelding = (env, chat, melding, tekst, knapper) =>
  kall(env, 'editMessageText', {
    chat_id: chat,
    message_id: melding,
    text: tekst,
    link_preview_options: { is_disabled: true },
    ...(knapper?.length ? { reply_markup: tastatur(knapper) } : {}),
  });

/** Sier fra til Telegram hvor svarene skal sendes. Kjøres av oppsettskriptet. */
export const settWebhook = (env, url, hemmelig) =>
  kall(env, 'setWebhook', {
    url,
    secret_token: hemmelig,
    allowed_updates: ['message', 'callback_query'],
  });
