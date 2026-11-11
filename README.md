# Ímanes de Viagem

Álbuns de fotos de viagens ligados a tags NFC em ímanes de frigorífico. Encosta-se o telemóvel ao íman e o álbum abre no browser, sem login.

- **Frontend:** Vite + JavaScript, alojado no GitHub Pages (PWA)
- **Supabase:** login Google, base de dados com RLS e Edge Functions
- **Cloudflare R2:** ficheiros das fotos e dos vídeos (bucket com leitura pública)
- **GitHub Actions:** deploy, e ping de 3 em 3 dias para o Supabase não pausar

Tudo cabe nos planos grátis.

> ⚠️ **O URL das tags é permanente.** O link gravado nos ímanes é
> `https://<utilizador>.github.io/<repositório>/a/<slug>`.
> **Não mudes o nome do repositório nem o teu utilizador do GitHub** depois de gravares as tags.

---

## Estrutura

```
index.html, vite.config.js      app (o build copia index.html → 404.html para as rotas funcionarem no Pages)
public/                         manifest, service worker, ícones
src/
  main.js                       arranque + rotas
  config.js                     variáveis VITE_* e URL dos ficheiros
  lib/                          supabase, router, upload, image (fotos), video (vídeos), format…
  components/                   grelha, slideshow, barra de espaço, toasts, layout
  pages/                        home, album-public, album-new, album-manage, invite
  styles/main.css
supabase/
  migrations/                   tabelas, funções, RLS
  functions/                    upload-url, confirm-upload, delete-media, delete-album, maintenance
.github/workflows/              deploy.yml, keepalive.yml
```

### Rotas

| Caminho | Quem | O quê |
|---|---|---|
| `/` | todos | sem sessão: entrada; com sessão: os meus álbuns e o espaço usado (só para quem criou algum álbum) |
| `/a/<slug>` | **público** | vista do álbum (link das tags NFC) |
| `/album/novo` | com sessão | criar álbum |
| `/album/<id>` | membros | link NFC, carregar ficheiros, capa, participantes, convites, editar e apagar |
| `/convite/<token>` | todos | aceitar um convite (pede login Google) |

### Permissões

| | Visitante | Participante | Criador (owner) |
|---|:-:|:-:|:-:|
| Ver o álbum pelo link público | ✅ | ✅ | ✅ |
| Adicionar fotos e vídeos | | ✅ | ✅ |
| Apagar fotos/vídeos | | só os que carregou | todos |
| Criar convites | | ✅ | ✅ |
| Editar o álbum, escolher a capa, remover participantes, apagar o álbum | | | ✅ |
| Ver o indicador de espaço | | | ✅ |

---

## Configuração (uma vez)

### 1. Repositório GitHub

1. Cria um repositório (ex.: `imanes`) e envia este código para o branch `main`.
2. Vai a **Settings → Pages → Build and deployment → Source** e escolhe **GitHub Actions**.

O site fica em `https://<utilizador>.github.io/<repositório>/`. Nos passos seguintes, este é o teu `APP_URL`.

### 2. Supabase

1. Cria um projeto em [supabase.com](https://supabase.com) (plano Free).
2. Corre as migrações, **por ordem**. Tens duas formas:
   - No **SQL Editor**, cola e corre cada ficheiro de `supabase/migrations/`.
   - Ou com a CLI:

     ```bash
     npx supabase login
     ```

     ```bash
     npx supabase link --project-ref <ref-do-projeto>
     ```

     ```bash
     npx supabase db push
     ```
3. Configura o login Google:
   1. Na [Google Cloud Console](https://console.cloud.google.com/apis/credentials), cria um **OAuth client ID** do tipo *Web application*.
   2. Em *Authorized redirect URIs*, põe `https://<ref-do-projeto>.supabase.co/auth/v1/callback`.
   3. No Supabase, em **Authentication → Sign In / Providers → Google**, ativa o provider e cola o Client ID e o Client Secret.
4. Em **Authentication → URL Configuration**:
   - **Site URL:** `APP_URL` (ex.: `https://ana.github.io/imanes/`)
   - **Redirect URLs:** `https://ana.github.io/imanes/**` e `http://localhost:5173/**`
5. Em **Project Settings → API**, toma nota do **Project URL** e da **anon / publishable key**.

### 3. Cloudflare R2

1. No painel da Cloudflare, abre **R2** e cria um bucket (ex.: `imanes-media`).
2. Em **Settings → Public access**, ativa o **R2.dev subdomain**. Toma nota do URL (`https://pub-….r2.dev`).
   Também podes usar um domínio próprio, se tiveres um na Cloudflare.
3. Ainda em **Settings**, define a **CORS policy** (troca pelo teu domínio):

   ```json
   [
     {
       "AllowedOrigins": ["https://ana.github.io", "http://localhost:5173"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type", "cache-control"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. Em **R2 → Manage API tokens**, cria um token com permissão **Object Read & Write**, limitado a este bucket.
   Toma nota do **Access Key ID**, do **Secret Access Key** e do **Account ID**.

### 4. Edge Functions

As chaves do R2 ficam só aqui, como segredos do Supabase. **Nunca vão para o frontend.**

Define os segredos:

```bash
npx supabase secrets set R2_ACCOUNT_ID=<account-id> R2_ACCESS_KEY_ID=<access-key> R2_SECRET_ACCESS_KEY=<secret> R2_BUCKET=imanes-media ALLOWED_ORIGINS=https://ana.github.io,http://localhost:5173 MAINTENANCE_SECRET=<texto-aleatório-comprido>
```

Depois publica as funções:

```bash
npx supabase functions deploy
```

O `supabase/config.toml` desativa a verificação automática de JWT, porque cada função valida o utilizador no próprio código. A função `maintenance` é protegida pelo `MAINTENANCE_SECRET`.

Para gerar um segredo aleatório:

```bash
openssl rand -hex 32
```

### 5. Variáveis no GitHub

No repositório, abre **Settings → Secrets and variables → Actions**.

**Variables:** são públicas por natureza; a anon key é protegida pelo RLS.

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key |
| `VITE_MEDIA_BASE_URL` | `https://pub-….r2.dev` (sem `/` no fim) |

**Secrets:**

| Nome | Valor |
|---|---|
| `MAINTENANCE_SECRET` | o mesmo valor do passo 4 |

Depois:

1. Corre o workflow **Deploy (GitHub Pages)** (separador *Actions → Run workflow*) ou faz um push.
2. Corre uma vez à mão o workflow **Keep-alive Supabase**, para confirmar que responde `{"ok":true,…}`.

### 6. Gravar as tags NFC (NTAG213)

1. Na página do álbum, toca em **Copiar link para a tag NFC**.
2. Numa app como a **NFC Tools** (Android ou iPhone), vai a *Escrever → Adicionar registo → URL/URI*, cola o link e escreve na tag.
3. Podes gravar o mesmo link em vários ímanes.
4. **Não bloqueies a tag** (*lock*), para a poderes regravar.

O link tem cerca de 60 caracteres e cabe bem nos ~130 da NTAG213. No iPhone (XS ou mais recente) e no Android com NFC ligado, encostar o telemóvel abre o link no browser.

---

## Desenvolvimento local

```bash
cp .env.example .env.local
```

Preenche os valores em `.env.local` e depois:

```bash
npm install
```

```bash
npm run dev
```

A app abre em http://localhost:5173.

---

## Como funciona o envio de ficheiros

1. **No telemóvel:**
   - **Fotos:** reduzidas para 1600 px, em WebP (ou JPEG se o browser não suportar WebP), com ~300–500 KB e uma miniatura de 480 px. O canvas remove o EXIF, incluindo o GPS; a data da foto é lida antes.
   - **Vídeos:** até 30 s, convertidos para H.264 720p com WebCodecs (biblioteca `mediabunny`). O som AAC do telemóvel é copiado sem reconversão. Se o browser não conseguir converter, é enviado o original, desde que tenha até 30 MB.
2. A função `upload-url` verifica:
   - se o utilizador tem sessão e é membro do álbum;
   - o tipo, o tamanho e a duração do ficheiro;
   - o espaço: com um lock na base de dados, recusa se o total ultrapassar **9,5 GB**.

   Depois cria a linha `pending` e devolve URLs PUT pré-assinados (15 min). O tamanho do ficheiro faz parte da assinatura, por isso não é possível enviar mais do que foi declarado.
3. O browser envia o ficheiro diretamente para o R2.
4. A função `confirm-upload` confirma no R2 o tamanho real e marca o ficheiro como `ready`. A primeira foto de um álbum sem capa passa a ser a capa.
5. Os uploads abandonados (`pending` há mais de 1 h) são apagados pela função `maintenance`, de 3 em 3 dias.

O espaço usado é a soma de `media.size_bytes` (ficheiro + miniatura) e inclui os uploads em curso.

## Limitações conhecidas

- **Vídeos HEVC (.mov) do iPhone:** em browsers sem WebCodecs, o vídeo vai no formato original e pode não reproduzir em alguns Android. Nos iPhones com iOS 16.4 ou mais recente, a conversão para H.264 funciona.
- **Endereço `r2.dev`:** tem limite de pedidos e a Cloudflare não o recomenda para produção. Para uso familiar chega; um domínio próprio resolve isto.
- **Quem tem o link vê o álbum.** O slug tem 16 caracteres aleatórios (~95 bits), por isso não se adivinha. Se um link for partilhado por engano, usa **Gerar novo link público** (depois tens de regravar os ímanes).
