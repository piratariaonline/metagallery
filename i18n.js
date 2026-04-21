/* MetaGallery — internationalization
 *
 * Tiny vanilla i18n: a dictionary + helpers, no deps.
 *
 * - `t(key, vars?)` returns the translated string for the active locale.
 * - `applyI18n(root)` walks `[data-i18n]` and `[data-i18n-attr]` elements
 *   and replaces their text / attribute values.
 * - `setLocale(locale)` switches and re-applies; persists to localStorage.
 *
 * Variable substitution uses {name} placeholders.
 *
 * Translations supporting limited inline markup:
 *   - Strings rendered via `applyI18n` use textContent (no HTML).
 *   - Strings rendered via `tHtml(key)` allow **bold**, *em* and
 *     [text](https://link) — useful for the welcome modal copy.
 */

const STORAGE_KEY = 'metagallery.locale';
const FALLBACK = 'en';

const dict = {
    'en': {
        // ---------- Topbar ----------
        'app.toggleSidebar':   'Show files',
        'app.toggleSidebar.aria': 'Toggle file list',
        'app.tag':             'local · private · offline',
        'app.openFolder':      'Open folder',
        'app.openFolder.title':'Open a folder (Chromium browsers)',
        'app.pickFiles':       'Pick files',
        'app.pickFiles.title': 'Pick individual files',
        'app.bsky':            'Bluesky',
        'app.bsky.title':      'Sign in to Bluesky',
        'app.install':         'Install',
        'app.help':            'Help',
        'app.help.title':      'How to use MetaGallery',
        'app.lang.title':      'Language',

        // ---------- Sidebar ----------
        'sidebar.noFolder':    'No folder loaded',
        'sidebar.imageCount':  '{n} image(s)',
        'sidebar.fileCount':   '{n} file(s)',
        'sidebar.filter':      'Filter by filename…',
        'sidebar.filter.clear':'Clear filter',
        'sidebar.opt.title':         'Title',
        'sidebar.opt.title.help':    'Also match the Title / Description metadata field',
        'sidebar.opt.desc':          'Description',
        'sidebar.opt.desc.help':     'Also match the User comment metadata field',
        'sidebar.searching':         'Searching, please wait…',

        // ---------- Gallery ----------
        'gallery.tagline':     "Curated images with native captions, ready to reuse on Bluesky.",
        'gallery.intro':       'Open a folder or pick some image files. Your files never leave your device — everything runs in your browser.',
        'gallery.hint.offline':'Works offline once loaded (PWA, installable)',
        'gallery.hint.formats':'Edits **JPEG** (EXIF + Windows XP tags), **PNG** (tEXt/iTXt + eXIf chunk) and **WebP** (EXIF + XMP)',
        'gallery.hint.chromium':'Folder write-back requires a Chromium browser (Chrome / Edge / Brave / Opera).',
        'gallery.empty.noImages':       'No images loaded.',
        'gallery.empty.noImages.hint':  'Open a folder or pick files to begin.',
        'gallery.empty.noMatches':      'No matches.',
        'gallery.empty.noMatches.hint': 'Try a different filter or untick Title/Description to broaden the search.',
        'gallery.loading':     'Loading folder…',
        'gallery.loadingName': 'Loading {name}…',

        // ---------- Editor ----------
        'editor.close':        'Close',
        'editor.preview':      'Selected picture preview',
        'editor.fs.description':   'Description',
        'editor.fs.authoring':     'Authoring',
        'editor.fs.dateTaken':     'Date taken',
        'editor.fs.camera':        'Camera',
        'editor.fs.location':      'Location (GPS)',
        'editor.f.title':          'Title / Description',
        'editor.f.userComment':    'User comment',
        'editor.f.artist':         'Artist / Author',
        'editor.f.copyright':      'Copyright',
        'editor.f.software':       'Software',
        'editor.f.dateOriginal':   'Date / time (original)',
        'editor.f.make':           'Camera make',
        'editor.f.model':          'Camera model',
        'editor.f.lat':            'Latitude',
        'editor.f.lon':            'Longitude',
        'editor.f.alt':            'Altitude (m)',
        'editor.gps.clear':        'Clear GPS',
        'editor.action.revert':    'Revert',
        'editor.action.revert.title': 'Discard changes',
        'editor.action.save':      'Save',
        'editor.action.save.title':'Save back to original file',
        'editor.action.download':  'Download',
        'editor.action.download.title':'Download a copy with new metadata',

        // ---------- Editor statuses ----------
        'editor.status.reverted':       'Reverted unsaved changes.',
        'editor.status.unsupported':    "Metadata editing isn't supported for {fmt}. Preview only.",
        'editor.status.unsupported.gen':'Saving metadata is not supported for this format.',
        'editor.status.saving':         'Saving…',
        'editor.status.downloaded':     'Downloaded a copy with new metadata.',
        'editor.status.saved':          'Saved to original file ✔',
        'editor.status.saveFailed':     'Save failed: {err}',
        'editor.toast.saved':           'Saved {name}',
        'editor.toast.saveFailed':      'Save failed',

        // ---------- Folder open ----------
        'folder.unsupported':  'Your browser cannot open a folder. Use "Pick files" instead, or try Chrome/Edge.',
        'folder.embedded':     'Folder access is blocked inside an embedded preview. Open the app in a real browser tab.',
        'folder.openFailed':   'Open folder failed: {err}',

        // ---------- Selection bar ----------
        'sel.count':           '{n} / {max} selected',
        'sel.clear':           'Clear',
        'sel.post':            'Post to Bluesky',
        'sel.tooMany':         'Up to {max} images per Bluesky post.',

        // ---------- Bluesky login modal ----------
        'bsky.login.title':         'Sign in to Bluesky',
        'bsky.login.intro':         'Use an {appPwd} (not your main password). OAuth sign-in arrives once the app is deployed.',
        'bsky.login.appPwd':        'app password',
        'bsky.login.handle':        'Handle',
        'bsky.login.password':      'App password',
        'bsky.login.cancel':        'Cancel',
        'bsky.login.submit':        'Sign in',
        'bsky.login.signing':       'Signing in…',
        'bsky.login.success':       'Signed in ✔',
        'bsky.login.signedInAs':    'Signed in as @{handle}',
        'bsky.login.signedOut':     'Signed out of Bluesky.',
        'bsky.login.confirmSignOut':'Signed in as @{handle}. Sign out?',
        'bsky.btn.signedInTitle':   'Signed in as @{handle} — click to sign out',

        // ---------- Bluesky compose modal ----------
        'bsky.compose.cancel':       'Cancel',
        'bsky.compose.post':         'Post',
        'bsky.compose.placeholder':  "What's up?",
        'bsky.compose.replyTo':      'Reply to an existing post',
        'bsky.compose.replyURL':     'https://bsky.app/profile/.../post/...',
        'bsky.compose.replyingTo':   'Replying to',
        'bsky.compose.cancelReply':  'Cancel reply',
        'bsky.compose.altPlaceholder':'Alt text (accessibility description)',
        'bsky.compose.altPrefilled': 'Alt prefilled from metadata',
        'bsky.compose.altCount':     '{n} / {max}',
        'bsky.compose.removeImage':  'Remove image',
        'bsky.compose.removeImage.title':'Remove from post',
        'bsky.compose.tg.everybody': '🌐 Anyone can reply',
        'bsky.compose.tg.following': '👥 Followers can reply',
        'bsky.compose.tg.mentioned': '@ Mentioned only',
        'bsky.compose.tg.nobody':    '🔒 No one can reply',
        'bsky.compose.tg.title':     'Who can reply',
        'bsky.compose.lang.title':   'Post language',
        'bsky.compose.signOut':      'Sign out',
        'bsky.compose.signOut.title':'Sign out of Bluesky',
        'bsky.compose.preparing':    'Preparing images…',
        'bsky.compose.posting':      'Posting…',
        'bsky.compose.posted':       'Posted ✔',
        'bsky.compose.postedToast':  'Posted to Bluesky',
        'bsky.compose.failed':       'Post failed: {err}',
        'bsky.compose.resolving':    'Resolving post…',
        'bsky.compose.noText':       '(no text)',

        // ---------- Welcome / help modal ----------
        'welcome.title':       'Welcome to MetaGallery',
        'welcome.skip':        'Don\'t show again',
        'welcome.gotIt':       'Got it',
        'welcome.intro':       'MetaGallery is a **local, private** photo metadata editor that runs entirely in your browser. Your files never leave your device.',
        'welcome.why':         '**Why bother editing metadata?** Captions you write are saved **into the file itself** (EXIF / XMP). They travel with the image to any service that reads metadata — Windows Properties, macOS Finder, Lightroom, Google Photos and, soon, Bluesky and other social apps.',
        'welcome.editor':      '**The editor** opens when you click any thumbnail. Fill in Title, Description, author, copyright, GPS, etc., then **Save** writes the changes back to the original file (or **Download** if you prefer a copy).',
        'welcome.search':      '**The search** filters by filename and, optionally, by Title and Description fields — so you can quickly find that one photo by what you wrote about it.',
        'welcome.bsky':        '**Post to Bluesky:** long-press (mobile) or shift-click (desktop) thumbnails to select up to four images, then tap **Post to Bluesky**. The image **Description** automatically becomes the post\'s alt text.',
        'welcome.author':      'Made by [@piratariaonline.bsky.social](https://bsky.app/profile/piratariaonline.bsky.social). Open-source, free, no ads, no tracking.',

        // ---------- Selection mark / titles ----------
        'thumb.removeImage.title': 'Remove from post'
    },

    'pt-BR': {
        'app.toggleSidebar':   'Mostrar arquivos',
        'app.toggleSidebar.aria': 'Alternar lista de arquivos',
        'app.tag':             'local · privado · offline',
        'app.openFolder':      'Abrir pasta',
        'app.openFolder.title':'Abrir uma pasta (navegadores Chromium)',
        'app.pickFiles':       'Escolher arquivos',
        'app.pickFiles.title': 'Selecionar arquivos individualmente',
        'app.bsky':            'Bluesky',
        'app.bsky.title':      'Entrar no Bluesky',
        'app.install':         'Instalar',
        'app.help':            'Ajuda',
        'app.help.title':      'Como usar o MetaGallery',
        'app.lang.title':      'Idioma',

        'sidebar.noFolder':    'Nenhuma pasta carregada',
        'sidebar.imageCount':  '{n} imagem(ns)',
        'sidebar.fileCount':   '{n} arquivo(s)',
        'sidebar.filter':      'Filtrar pelo nome do arquivo…',
        'sidebar.filter.clear':'Limpar filtro',
        'sidebar.opt.title':         'Título',
        'sidebar.opt.title.help':    'Também buscar no campo Título / Descrição dos metadados',
        'sidebar.opt.desc':          'Descrição',
        'sidebar.opt.desc.help':     'Também buscar no campo Comentário do usuário',
        'sidebar.searching':         'Buscando, aguarde…',

        'gallery.tagline':     'Curadoria de imagens com descrição nativa para reuso no Bluesky',
        'gallery.intro':       'Abra uma pasta ou escolha alguns arquivos de imagem. Seus arquivos nunca saem do seu dispositivo — tudo roda no navegador.',
        'gallery.hint.offline':'Funciona offline depois de carregado (PWA, instalável)',
        'gallery.hint.formats':'Edita **JPEG** (EXIF + tags XP do Windows), **PNG** (tEXt/iTXt + chunk eXIf) e **WebP** (EXIF + XMP)',
        'gallery.hint.chromium':'Salvar de volta na pasta requer navegador Chromium (Chrome / Edge / Brave / Opera).',
        'gallery.empty.noImages':       'Nenhuma imagem carregada.',
        'gallery.empty.noImages.hint':  'Abra uma pasta ou escolha arquivos para começar.',
        'gallery.empty.noMatches':      'Nenhum resultado.',
        'gallery.empty.noMatches.hint': 'Tente outro filtro ou desmarque Título/Descrição para ampliar a busca.',
        'gallery.loading':     'Carregando pasta…',
        'gallery.loadingName': 'Carregando {name}…',

        'editor.close':        'Fechar',
        'editor.preview':      'Pré-visualização da imagem selecionada',
        'editor.fs.description':   'Descrição',
        'editor.fs.authoring':     'Autoria',
        'editor.fs.dateTaken':     'Data da captura',
        'editor.fs.camera':        'Câmera',
        'editor.fs.location':      'Localização (GPS)',
        'editor.f.title':          'Título / Descrição',
        'editor.f.userComment':    'Comentário do usuário',
        'editor.f.artist':         'Artista / Autor',
        'editor.f.copyright':      'Direitos autorais',
        'editor.f.software':       'Software',
        'editor.f.dateOriginal':   'Data / hora (original)',
        'editor.f.make':           'Marca da câmera',
        'editor.f.model':          'Modelo da câmera',
        'editor.f.lat':            'Latitude',
        'editor.f.lon':            'Longitude',
        'editor.f.alt':            'Altitude (m)',
        'editor.gps.clear':        'Limpar GPS',
        'editor.action.revert':    'Reverter',
        'editor.action.revert.title': 'Descartar alterações',
        'editor.action.save':      'Salvar',
        'editor.action.save.title':'Salvar no arquivo original',
        'editor.action.download':  'Baixar',
        'editor.action.download.title':'Baixar uma cópia com os novos metadados',

        'editor.status.reverted':       'Alterações descartadas.',
        'editor.status.unsupported':    'Edição de metadados não suportada para {fmt}. Apenas pré-visualização.',
        'editor.status.unsupported.gen':'Salvar metadados não é suportado para este formato.',
        'editor.status.saving':         'Salvando…',
        'editor.status.downloaded':     'Cópia baixada com os novos metadados.',
        'editor.status.saved':          'Salvo no arquivo original ✔',
        'editor.status.saveFailed':     'Falha ao salvar: {err}',
        'editor.toast.saved':           '{name} salvo',
        'editor.toast.saveFailed':      'Falha ao salvar',

        'folder.unsupported':  'Seu navegador não consegue abrir uma pasta. Use "Escolher arquivos" ou tente Chrome/Edge.',
        'folder.embedded':     'Acesso à pasta bloqueado em pré-visualização incorporada. Abra o app em uma aba real do navegador.',
        'folder.openFailed':   'Falha ao abrir pasta: {err}',

        'sel.count':           '{n} / {max} selecionada(s)',
        'sel.clear':           'Limpar',
        'sel.post':            'Postar no Bluesky',
        'sel.tooMany':         'Até {max} imagens por post no Bluesky.',

        'bsky.login.title':         'Entrar no Bluesky',
        'bsky.login.intro':         'Use uma {appPwd} (não a senha principal). O login OAuth chega quando o app for publicado.',
        'bsky.login.appPwd':        'senha de app',
        'bsky.login.handle':        'Handle',
        'bsky.login.password':      'Senha de app',
        'bsky.login.cancel':        'Cancelar',
        'bsky.login.submit':        'Entrar',
        'bsky.login.signing':       'Entrando…',
        'bsky.login.success':       'Conectado ✔',
        'bsky.login.signedInAs':    'Conectado como @{handle}',
        'bsky.login.signedOut':     'Desconectado do Bluesky.',
        'bsky.login.confirmSignOut':'Conectado como @{handle}. Desconectar?',
        'bsky.btn.signedInTitle':   'Conectado como @{handle} — clique para sair',

        'bsky.compose.cancel':       'Cancelar',
        'bsky.compose.post':         'Postar',
        'bsky.compose.placeholder':  'Qual a boa?',
        'bsky.compose.replyTo':      'Responder a um post existente',
        'bsky.compose.replyURL':     'https://bsky.app/profile/.../post/...',
        'bsky.compose.replyingTo':   'Respondendo a',
        'bsky.compose.cancelReply':  'Cancelar resposta',
        'bsky.compose.altPlaceholder':'Texto alternativo (descrição de acessibilidade)',
        'bsky.compose.altPrefilled': 'Alt preenchido a partir dos metadados',
        'bsky.compose.altCount':     '{n} / {max}',
        'bsky.compose.removeImage':  'Remover imagem',
        'bsky.compose.removeImage.title':'Remover do post',
        'bsky.compose.tg.everybody': '🌐 Qualquer um pode responder',
        'bsky.compose.tg.following': '👥 Seguidores podem responder',
        'bsky.compose.tg.mentioned': '@ Apenas mencionados',
        'bsky.compose.tg.nobody':    '🔒 Ninguém pode responder',
        'bsky.compose.tg.title':     'Quem pode responder',
        'bsky.compose.lang.title':   'Idioma do post',
        'bsky.compose.signOut':      'Sair',
        'bsky.compose.signOut.title':'Sair do Bluesky',
        'bsky.compose.preparing':    'Preparando imagens…',
        'bsky.compose.posting':      'Postando…',
        'bsky.compose.posted':       'Postado ✔',
        'bsky.compose.postedToast':  'Post enviado ao Bluesky',
        'bsky.compose.failed':       'Falha ao postar: {err}',
        'bsky.compose.resolving':    'Carregando post…',
        'bsky.compose.noText':       '(sem texto)',

        'welcome.title':       'Bem-vindo(a) ao MetaGallery',
        'welcome.skip':        'Não mostrar de novo',
        'welcome.gotIt':       'Entendi',
        'welcome.intro':       'O MetaGallery é um editor de metadados de fotos **local e privado** que roda inteiro no seu navegador. Seus arquivos nunca saem do seu dispositivo.',
        'welcome.why':         '**Por que editar metadados?** As legendas que você escreve ficam gravadas **dentro do próprio arquivo** (EXIF / XMP). Elas viajam com a imagem para qualquer serviço que leia metadados — Propriedades do Windows, Finder do macOS, Lightroom, Google Fotos e, em breve, Bluesky e outras redes sociais.',
        'welcome.editor':      '**O editor** abre quando você clica em qualquer miniatura. Preencha Título, Descrição, autor, direitos autorais, GPS, etc., e **Salvar** grava as alterações no arquivo original (ou **Baixar** se preferir uma cópia).',
        'welcome.search':      '**A busca** filtra pelo nome do arquivo e, opcionalmente, pelos campos Título e Descrição — ótimo para achar rapidinho aquela foto pelo que você escreveu sobre ela.',
        'welcome.bsky':        '**Postar no Bluesky:** segure (no celular) ou shift-clique (no desktop) nas miniaturas para selecionar até quatro imagens e toque em **Postar no Bluesky**. A **Descrição** da imagem vira automaticamente o texto alternativo do post.',
        'welcome.author':      'Feito por [@piratariaonline.bsky.social](https://bsky.app/profile/piratariaonline.bsky.social). Código aberto, gratuito, sem anúncios e sem rastreamento.',

        'thumb.removeImage.title': 'Remover do post'
    }
};

let currentLocale = detectInitialLocale();

function detectInitialLocale() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && dict[stored]) return stored;
    } catch {}
    const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (nav.startsWith('pt')) return 'pt-BR';
    return 'en';
}

export function getLocale() { return currentLocale; }
export function getAvailableLocales() { return Object.keys(dict); }

export function setLocale(locale) {
    if (!dict[locale]) return false;
    currentLocale = locale;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch {}
    document.documentElement.lang = locale === 'pt-BR' ? 'pt-BR' : 'en';
    applyI18n();
    document.dispatchEvent(new CustomEvent('localechange', { detail: { locale } }));
    return true;
}

export function t(key, vars) {
    const s = dict[currentLocale]?.[key] ?? dict[FALLBACK]?.[key] ?? key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/** Like `t()` but renders **bold**, *em* and [text](href) as HTML.
 *  Inputs are HTML-escaped first, then markup is converted, so user-controlled
 *  variables remain safe. */
export function tHtml(key, vars) {
    const raw = t(key, vars);
    const esc = raw
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return esc
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
            (_, txt, href) => `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
}

/** Walk a DOM root and apply translations to every element with i18n attrs.
 *  Supported attributes:
 *    - data-i18n="key"             → element.textContent
 *    - data-i18n-html="key"        → element.innerHTML (with limited markup)
 *    - data-i18n-attr="attr:key,attr:key" → element.setAttribute(attr, t(key))
 */
export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = tHtml(el.dataset.i18nHtml);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
        const spec = el.dataset.i18nAttr;
        spec.split(',').forEach(pair => {
            const [attr, key] = pair.split(':').map(s => s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        });
    });
}
