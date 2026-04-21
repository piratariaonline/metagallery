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