# spicetify-double-play

Extensão do [Spicetify](https://spicetify.app) que adiciona um 4º modo ao botão de loop do Spotify: repetir a música **uma única vez** antes de passar para a próxima.

## Os 4 modos

Clicando no botão de loop (ou usando o atalho de teclado), o ciclo passa a ser:

| Ícone | Modo | O que faz |
|-------|------|-----------|
| 🔁 apagado | Não repetir | Comportamento padrão |
| 🔁 | Repetir | Repete a playlist/álbum |
| 🔂 | Repetir uma faixa | Repete a faixa atual para sempre |
| 🔂 com selo | **Repetir uma faixa apenas uma vez** | Cada faixa toca **2x** e então avança |

O 4º modo é **contínuo**: enquanto estiver ativo, toda faixa toca duas vezes antes de o player seguir para a próxima. O modo escolhido é lembrado entre reinícios do Spotify.

## Instalação

1. Copie `double-play.js` para a pasta de extensões do Spicetify:

   | Sistema | Pasta |
   |---------|-------|
   | Linux / macOS | `~/.config/spicetify/Extensions/` |
   | Windows | `%appdata%\spicetify\Extensions\` |

   Ou use o caminho exato que o comando `spicetify path userdir` mostrar.

2. Ative e aplique:

   ```bash
   spicetify config extensions double-play.js
   spicetify apply
   ```

## Desinstalação

```bash
spicetify config extensions double-play.js-
spicetify apply
```

## Como funciona

O Spotify não tem uma API de "repetir uma vez", então o modo é emulado em cima do repeat nativo:

1. Quando uma faixa começa, a extensão liga o repeat nativo **"repetir uma faixa"**.
2. Assim que o Spotify reinicia a faixa, a extensão detecta a repetição e **desliga** o repeat.
3. A segunda execução termina com o repeat desligado, então o player avança normalmente.
4. A faixa seguinte reinicia o ciclo.

A detecção da repetição usa o `playbackId` do estado do player, com um fallback baseado no progresso (queda do fim da faixa para o começo) caso o `playbackId` não mude. Arrastar a barra de progresso para trás no meio da música **não** conta como repetição.

O ciclo de modos é interceptado em `Spicetify.Platform.PlayerAPI.setRepeat`, e não por clique no DOM — assim o atalho de teclado também funciona.

## Limitações conhecidas

- Como a extensão manipula o repeat nativo, **outros dispositivos** veem o repeat alternando entre "repetir uma faixa" e "desligado" durante a reprodução. Isso é esperado.
- Se você mudar o repeat por outro dispositivo (Spotify Connect), a extensão sincroniza e **sai** do 4º modo — ele não tem equivalente do outro lado.
- O ícone próprio do 4º modo depende de encontrar o botão de loop no DOM. Se uma atualização do Spotify mudar a marcação, o ciclo de 4 modos continua funcionando, mas sem o ícone distinto; um aviso aparece no console com o ponteiro para ajustar `BUTTON_SELECTORS` em `double-play.js`.

## Depuração

Mude `DEBUG` para `true` no topo de `double-play.js` e reaplique. A extensão passa a registrar cada transição no console do DevTools (`Ctrl+Shift+I` com `spicetify enable-devtools`).

## Licença

MIT — veja [LICENSE](LICENSE).
