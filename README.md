# GTA 7 ONLINE — COSTA AURORA (Ultimate Open World Multiplayer 3D)

> **Nota Legal**: *GTA 7 ONLINE* é um título provisório e demonstrativo de um jogo de mundo aberto multiplayer 3D original para navegadores modernos. Este projeto não possui qualquer vínculo oficial com a Rockstar Games ou Take-Two Interactive. Todos os mapas (*Costa Aurora*), marcas, modelos 3D, veículos, armas, texturas PBR e trilhas de rádio foram construídos de forma original para este projeto.

---

## 1. Visão Geral da Arquitetura

O projeto está organizado como um monorepo TypeScript com 3 workspaces:

- [`shared/`](./shared): Protocolo tipado com **Zod** (`protocol.ts`), catálogo único de preços/armas/veículos/lojas (`catalog.ts`), gerador determinístico de terreno, malha viária, vagas e algoritmo **A\*** de GPS (`world.ts`) e as 10 missões configuráveis via JSON (`missions.json` + `missions.ts`).
- [`server/`](./server): Servidor autoritativo em **Node.js + Fastify + Socket.IO + Drizzle ORM + PostgreSQL (Neon / PGlite)** com hash de senhas **Argon2id**, rate-limiting, validação anti-cheat (velocidade, cadência de tiro, proximidade de lojas/checkpoints, transações idempotentes) e testes automatizados com **Vitest**.
- [`client/`](./client): Cliente 3D em **Three.js (WebGL 2 PBR) + Rapier 3D (WASM) + Vite + WebAudio API**, incluindo Menu Principal cinematográfico **GTA 7** com 6 câmeras ao vivo, Lobby 3D multiplayer, HUD completo, Minimapa Radar + Mapa em Tela Cheia com GPS viário, veículos dirigíveis, barcos, NPCs pedestres, trânsito IA e sistema policial de 1 a 5 estrelas.

---

## 2. Como Executar Localmente

### Pré-requisitos
- **Node.js 20+** e **npm**

### Instalação e Execução (Desenvolvimento)
```bash
# 1. Instalar dependências de todos os workspaces
npm install

# 2. Iniciar servidor (porta 3000) + cliente Vite (porta 5173) simultaneamente
npm run dev
```
> **Banco de Dados Instantâneo**: Se `DATABASE_URL` não estiver definida no `.env`, o servidor inicializa automaticamente um banco PostgreSQL embarcado (**PGlite**) persistido em `server/.data/pglite` e aplica as migrations SQL (`server/drizzle/0000_init.sql`).

Abra `http://localhost:5173` em **dois ou mais navegadores/abas** para testar o fluxo completo de contas, salas, código de convite, Lobby 3D e exploração multiplayer em tempo real.

### Comandos de Qualidade, Build e Testes
```bash
# Executar a suíte completa de testes automatizados (Auth, Economia, Mundo e Multiplayer com clientes reais)
npm test

# Verificar tipagem TypeScript no servidor e no cliente
npm run typecheck

# Gerar build de produção do frontend (client/dist)
npm run build
```

---

## 3. Documentação da API REST (`/api/v1`) & Eventos Socket.IO

### Endpoints REST
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/health` | Pública | Health check e tipo do banco (`postgres` ou `pglite`) |
| `GET` | `/api/v1/server/status` | Pública | Versão do protocolo, região, uptime, salas e jogadores online |
| `POST` | `/api/v1/auth/register` | Pública | Cadastro de usuário com Argon2id + saldo inicial (`$5.000`) |
| `POST` | `/api/v1/auth/login` | Pública | Login e criação de sessão com token opaco (SHA-256 no banco) |
| `POST` | `/api/v1/auth/logout` | Bearer Token | Revoga sessão atual |
| `GET` | `/api/v1/auth/me` | Bearer Token | Valida token e retorna usuário autenticado |
| `GET` | `/api/v1/profile` | Bearer Token | Retorna perfil, aparência 3D, última posição, configurações e saldo |
| `PUT` | `/api/v1/profile/character` | Bearer Token | Salva personalização do personagem 3D |
| `PUT` | `/api/v1/profile/settings` | Bearer Token | Salva configurações gráficas, áudio e controles |
| `GET` | `/api/v1/wallet` | Bearer Token | Saldo e histórico auditável de transações |
| `GET` | `/api/v1/inventory` | Bearer Token | Lista itens, armas, munições e consumíveis |
| `POST` | `/api/v1/inventory/drop` | Bearer Token | Descarta item do inventário |
| `GET` | `/api/v1/shop/catalog` | Pública | Catálogo completo de armas, itens, veículos, imóveis e oficina |
| `POST` | `/api/v1/shop/buy` | Bearer Token | Compra item validando proximidade da loja no servidor |
| `GET` | `/api/v1/vehicles` | Bearer Token | Lista veículos adquiridos na garagem do jogador |
| `POST` | `/api/v1/vehicles/buy` | Bearer Token | Compra veículo na Prestige Motors ou Marina Dourada |
| `POST` | `/api/v1/vehicles/:id/customize` | Bearer Token | Repara, pinta ou faz upgrade de motor na Aurora Customs |
| `GET` | `/api/v1/properties` | Bearer Token | Catálogo de imóveis e propriedades adquiridas |
| `POST` | `/api/v1/properties/buy` | Bearer Token | Compra imóvel/empresa validando proximidade e saldo |
| `POST` | `/api/v1/properties/sell` | Bearer Token | Vende imóvel por 50% do valor |
| `GET` | `/api/v1/missions` | Bearer Token | Lista as 10 missões e o progresso/melhor tempo do jogador |

---

## 4. Guia de Deploy Público Gratuito (Cloudflare Pages + Render + Neon)

### Passo 1 — Banco de Dados PostgreSQL Gratuito (Neon.tech)
1. Crie um projeto gratuito em [neon.tech](https://neon.tech).
2. Copie a string de conexão (`postgresql://usuario:senha@ep-...neon.tech/neondb?sslmode=require`).
3. O servidor executa automaticamente as migrations de `server/drizzle` ao iniciar.

### Passo 2 — Backend Node.js + WebSockets (Render Free Web Service)
1. Suba este repositório no GitHub.
2. No [Render](https://render.com), selecione **New -> Blueprint** (que lerá o arquivo [`render.yaml`](./render.yaml)) ou crie um **Web Service** apontando para o repositório:
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start -w server`
   - **Health Check Path**: `/health`
3. Configure as variáveis de ambiente no Render:
   - `DATABASE_URL`: String do Neon PostgreSQL
   - `CORS_ORIGIN`: URL do seu frontend no Cloudflare Pages (ex.: `https://gta7-online.pages.dev`)

### Passo 3 — Frontend 3D (Cloudflare Pages)
1. No [Cloudflare Pages](https://pages.cloudflare.com), conecte seu repositório GitHub:
   - **Build command**: `npm run build`
   - **Build output directory**: `client/dist`
2. Configure as variáveis de ambiente de build no Cloudflare Pages:
   - `VITE_API_URL`: URL do seu serviço no Render (ex.: `https://gta7-online-server.onrender.com`)
   - `VITE_WS_URL`: URL do seu serviço no Render (ex.: `https://gta7-online-server.onrender.com`)
3. O arquivo `client/public/_redirects` já está configurado para fallback de rotas SPA.

---

## 5. Licenças dos Assets e Conteúdo Original
- **Modelos 3D, Geometrias de Veículos, Humanoides e Arquitetura**: Gerados proceduralmente em código original (`client/src/world/models.ts` e `client/src/world/city.ts`) + suporte nativo a `GLTFLoader` e `AnimationMixer`. Licença MIT/CC0.
- **Texturas PBR (Asfalto, Fachadas, Areia, Grama)**: Geradas proceduralmente via HTML5 Canvas (`client/src/world/textures.ts`). Licença MIT/CC0.
- **Áudio Espacial, Efeitos Sonoros e 4 Estações de Rádio**: Sintetizados em tempo real via WebAudio API (`client/src/audio/sound.ts`). Licença MIT/CC0.
