# MetaGallery

Um web app **independente**, **somente front-end** e com suporte a **PWA** para
editar metadados (EXIF / XMP / chunks PNG) das suas fotos **locais**. Nada é
enviado para servidor — toda a leitura e escrita acontece no seu navegador.

🌐 Versão online: <https://metagallery.alanmm.dev/>

## Recursos

- 📁 Abra uma pasta inteira (navegadores Chromium, via File System Access API)
    ou escolha arquivos individuais (qualquer navegador).
- 🖼 Galeria de miniaturas + lista lateral de arquivos com filtro por nome
    e busca opcional por Título / Descrição.
- ✏ Edita os campos de metadados:
    - Título / Descrição, Comentário do usuário
    - Artista / Autor, Direitos autorais, Software
    - Data da captura (DateTimeOriginal)
    - Marca / Modelo da câmera
    - GPS (latitude, longitude, altitude — com botão "Limpar GPS")
- 💾 **Salva no arquivo original** (Chromium) **ou** ⬇ baixa uma cópia editada
    (qualquer navegador, incluindo Firefox/Safari).
- 🦋 **Posta no Bluesky** com seleção múltipla (até 4 imagens), respostas a
    posts existentes, threadgate (quem pode responder), idioma do post e o
    texto alternativo já preenchido a partir do **Comentário do usuário** ou
    da **Descrição** dos metadados.
- 🔐 Login via **OAuth** (AT Protocol) na versão publicada; senha de app no
    desenvolvimento local.
- 🌍 Interface em **Português (Brasil)** e **Inglês** com troca em tempo real.
- 📲 PWA instalável — funciona offline depois de carregada.
- 🔒 100% no seu lado. Sem servidor, sem rastreamento, sem upload.

## Formatos suportados

| Formato | Pré-visualização | Editar metadados | Observações                          |
|---------|:---------------:|:----------------:|--------------------------------------|
| JPEG    |        ✅       |        ✅        | EXIF + tags XP do Windows (`piexifjs`) |
| PNG     |        ✅       |        ✅        | tEXt / iTXt + chunk eXIf             |
| WebP    |        ✅       |        ✅        | EXIF + XMP                            |
| GIF / AVIF / BMP | ✅ | ❌ (somente leitura) | Visualização apenas |

## Como rodar

São arquivos estáticos puros — qualquer servidor estático serve. Da raiz do
projeto:

```powershell
# Python
python -m http.server 5173
# ou Node
npx serve .
```

Abra <http://localhost:5173>.

### Desenvolvimento com recarga automática + HTTPS (para testar PWA no celular)

O repositório já vem preparado para [`mkcert`](https://github.com/FiloSottile/mkcert)
— assim você ganha o cadeado verde em `localhost` e no seu IP da LAN, que é
requisito para testar o prompt de instalação do PWA no Chrome do Android.

Setup único:

```powershell
winget install FiloSottile.mkcert
mkcert -install                                      # adiciona a CA local ao Windows
mkdir .certs ; cd .certs
mkcert -cert-file dev.pem -key-file dev-key.pem `
       localhost 127.0.0.1 <SEU-IP-DA-LAN>           # ex: 192.168.0.5
```

Depois rode o servidor de desenvolvimento:

```powershell
npx live-server --port=5173 --host=0.0.0.0 --no-browser `
                --https=./live-server-https.cjs
```

- Desktop: <https://localhost:5173>
- Celular (mesma rede Wi-Fi): `https://<SEU-IP-DA-LAN>:5173`

Para o celular confiar no certificado, copie `%LOCALAPPDATA%\mkcert\rootCA.pem`
para o aparelho e instale em **Configurações → Segurança → Criptografia e
credenciais → Instalar um certificado → Certificado CA**. A partir daí qualquer
certificado emitido pelo mkcert nesse PC será confiável no celular.

> ⚠ A File System Access API exige um **contexto seguro**
> (`https://` ou `http://localhost`).
>
> Salvar no arquivo original funciona hoje em Chrome / Edge / Brave / Opera.
> Em Firefox / Safari você é redirecionado automaticamente para o fluxo de
> **baixar cópia**.

## Configuração inicial: vendoring do `piexifjs`

Baixe `piexif.js` (ou o minificado `piexif.min.js`) de
<https://github.com/hMatoba/piexifjs> e coloque em:

```
vendor/piexif.min.js
```

(É carregado pelo `index.html`.)

## Bundle do OAuth do Bluesky

A integração OAuth do AT Protocol depende de um bundle próprio do
`@atproto/oauth-client-browser` + `@atproto/api`, gerado com `esbuild` e
versionado em `vendor/atproto-oauth.bundle.js`. Para regerar:

```powershell
npm install
npm run build:vendor
```

O app continua sendo **sem build** — esse passo só é necessário quando se
deseja atualizar a versão das libs do AT Protocol.

## Ícones PNG opcionais para o prompt de instalação

Para um prompt de instalação de PWA mais bonito, adicione
`icons/icon-192.png` e `icons/icon-512.png`. O ícone SVG já incluído cobre a UI.

## Estrutura de arquivos

```
index.html
styles.css
app.js
i18n.js
metadata.js
thumbs.js
searchIndex.js
bluesky.js
oauth.js
sw.js
manifest.webmanifest
client-metadata.json          (descritor OAuth servido em produção)
icons/icon.svg
vendor/piexif.min.js          (você fornece)
vendor/atproto-oauth.bundle.js (gerado por `npm run build:vendor`)
```

## Notas e limitações

- Edição de metadados via JPEG usa `piexifjs`; PNG e WebP usam parsers próprios
    embutidos no `metadata.js`. AVIF/GIF/BMP ficam apenas como pré-visualização.
- O fluxo "Escolher arquivos" não consegue salvar no local original
    (segurança do navegador). Use **Baixar cópia** nesse caso.
- O envio para o Bluesky redimensiona as imagens para no máximo 2000 px no maior
    lado, com qualidade JPEG ajustada automaticamente para caber no limite de
    ~976 KB por blob da rede.
- O OAuth nativo do Bluesky exige `https://` e um `client-metadata.json`
    publicado no domínio (já incluído para `metagallery.alanmm.dev`). Em
    desenvolvimento local o app cai automaticamente para login com senha de app.

## Licença

Código aberto, sem propaganda, sem rastreamento. vibecodado por
[@piratariaonline.bsky.social](https://bsky.app/profile/piratariaonline.bsky.social) numa tarde de feriado pra tentar resolver uma inconveniência sobre acessibilidade na rede.