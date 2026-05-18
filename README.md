# Nexu API

API em `Node.js ESM + Express + Prisma` com autenticacao `Bearer JWT`, refresh token rotativo, controle de acesso por perfil e indices no banco para acelerar consultas.

## Recursos

- JWT de curta duracao para acesso e refresh token opaco com rotacao
- Hash de senha com Argon2
- Rate limit global e reforcado no login
- Lock temporario de conta apos excesso de tentativas
- Auditoria de eventos sensiveis
- Validacao de payloads com Zod
- Prisma com índices para usuários, sessões, leads e tickets
- CRUD inicial para usuários, cadastros, leads e tickets
- Controle de acesso por modulo com cargos base `basic`, `leader` e `admin`
- Presets de acesso padrao e customizaveis
- Override de permissão por usuário
- Lixeira com restauracao e exclusao permanente separadas por permissao

## Subir localmente

1. Opcional: copie `.env.example` para `.env`
   Sem `.env`, a API e o Prisma usam `postgresql://postgres:postgres@localhost:5432/nexu_next?schema=public` como `DATABASE_URL` padrao para desenvolvimento local
2. Instale dependencias:

```bash
npm install
```

3. Gere o client do Prisma e crie o banco:

```bash
npm run prisma:generate
npm run db:init
```

4. Rode o seed:

```bash
npm run db:seed
```

5. Inicie a API:

```bash
npm run dev
```

## Credenciais iniciais

- `gabriel@nexu.com.br` / `Nexu@12345`
- `moara@nexu.com.br` / `Nexu@12345`
- `bianca@nexu.com.br` / `Nexu@12345`

## Cargos e acesso

- `basic`: acesso somente aos módulos liberados; por padrão não exclui itens
- `leader`: pode receber módulos em `manage` e acessar a lixeira para restaurar itens, mas não fazer exclusão permanente
- `admin`: acesso total a todos os módulos, usuários, presets, lixeira e exclusão permanente

## Modulos padrao

- `DASHBOARD`
- `COMMERCIAL`
- `FINANCEIRO`
- `IMPLANTACAO`
- `SUPORTE`
- `DESENVOLVIMENTO`
- `CADASTROS`
- `USUARIOS`
- `LIXEIRA`

## Rotas principais

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/users`
- `POST /api/users`
- `GET /api/catalog/items`
- `GET /api/catalog/tags`
- `GET /api/catalog/origins`
- `GET /api/catalog/sdrs`
- `GET /api/catalog/indicators`
- `GET /api/leads`
- `POST /api/leads`
- `GET /api/tickets`
- `POST /api/tickets`
- `GET /api/access/modules`
- `POST /api/access/modules`
- `GET /api/access/presets`
- `POST /api/access/presets`
- `GET /api/access/users/:id`
- `PUT /api/access/users/:id`
- `GET /api/trash`
- `POST /api/trash/:id/restore`
- `DELETE /api/trash/:id`

## Exemplo de login

```bash
curl -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"gabriel@nexu.com.br\",\"password\":\"Nexu@12345\"}"
```

## Observações de segurança

- Troque `JWT_ACCESS_SECRET` antes de producao
- Em producao, prefira banco gerenciado e rotacao de segredos
- O schema principal do Prisma esta configurado para PostgreSQL
- Neste ambiente Windows + Node atual, o `prisma db push` pode falhar com erro generico de engine; por isso o bootstrap local usa `npm run db:init`
