# Repoet inneholder to atskilte prosjekter

| Sti | Hva | Publiseres til |
|---|---|---|
| rota (`src/`, `test/`, `index.html`, `sw.js` …) | **Lykkelig tur** – turappen | GitHub Pages |
| `dagbok/` | En egen, privat app. Ingen sammenheng med turappen. | Cloudflare Workers, egen adresse |

De to skal ikke blandes. `dagbok/` har sin egen `CLAUDE.md` med reglene
som gjelder der – les den før du gjør noe i den mappa, og la den ellers være.

Jobber du med turappen: `dagbok/` finnes ikke for deg. Den er holdt
utenfor lint (`npm run lint` peker på `src test`), utenfor testene
(`test/*.test.mjs`) og utenfor Pages-utlegget (deploy-jobben sletter mappa før
den pakker siden), slik at den aldri havner på turappens adresse.
