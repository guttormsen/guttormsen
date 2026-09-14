/**
 * Telegram. Én funksjon, ett kall.
 *
 * Token ligger som hemmelighet i Cloudflare, aldri i koden. Feil herfra skal
 * ikke velte det hun holder på med – blir meldingen liggende usendt, er det
 * fortsatt viktigere at dagen ble lagret.
 */

export async function sendTelegram(env, tekst, { stille = false } = {}) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn('Telegram er ikke satt opp – hopper over varselet.');
    return false;
  }
  try {
    const svar = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: tekst,
        disable_notification: stille,
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!svar.ok) {
      console.warn('Telegram svarte', svar.status, await svar.text());
      return false;
    }
    return true;
  } catch (feil) {
    console.warn('Fikk ikke sendt til Telegram:', feil?.message ?? feil);
    return false;
  }
}
