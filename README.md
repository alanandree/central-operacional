# Central Operacional

Plataforma web para gestão de ocorrências do SAC, cadastro de motoristas, documentos, prazos/SLA, WhatsApp Business Cloud API, assistente de IA, relatórios e notificações.

## Instalação

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api

Para produção:

```bash
npm run build
npm start
```

O Express serve a pasta `dist` quando `NODE_ENV=production`.

## Primeiro acesso

Usuário inicial criado automaticamente na primeira execução:

- E-mail: `admin@empresa.com`
- Senha: `admin1234`

Altere a senha em **Configurações → Segurança** ou em **Perfil → Alterar senha**.

## Banco de dados

SQLite local em `data/central.db`, criado automaticamente. A persistência é real; nenhum dado de demonstração é inserido. Defina `DATA_DIR` para usar outro diretório de dados. A arquitetura separa o acesso a dados em `server/db.ts` para permitir migração futura para PostgreSQL/Supabase.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

### Obrigatórias

- `JWT_SECRET`: chave longa e aleatória.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: usuário inicial.

### WhatsApp Cloud API

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `APP_SECRET` (usado para validar a assinatura `X-Hub-Signature-256`)

Webhook: `POST/GET /api/webhooks/whatsapp`.

A aplicação **não** usa QR Code, WhatsApp Web, scraping ou bibliotecas não oficiais. Se as variáveis não estiverem preenchidas, a página WhatsApp mostra o status real como “não configurado” e o envio de mensagens retorna erro explícito.

Grupos: a Cloud API nem sempre permite ler mensagens de grupos. Verifique a modalidade do seu número. Quando grupo não for suportado, use importação manual, encaminhamento para canal compatível ou criação rápida de ocorrência.

### Inteligência artificial

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (padrão: `https://api.openai.com/v1`)
- `OPENAI_MODEL` (padrão: `gpt-4o-mini`)

Sem `OPENAI_API_KEY`, os endpoints de IA retornam `503` e a interface exibe “IA desativada”. Nenhuma análise é simulada.

### E-mail

- `RESEND_API_KEY` (opcional)

Sem provedor de e-mail, a recuperação de senha devolve um token apenas em desenvolvimento (`NODE_ENV` diferente de `production`), com aviso explícito na resposta.

## Estrutura

- `server/`: API REST, autenticação, banco, integrações e uploads privados.
- `src/`: interface React + TypeScript + Tailwind + Lucide + Recharts.
- `data/`: banco SQLite e arquivos enviados (não versionados).

## Scripts

- `npm run dev`: API + frontend em modo de desenvolvimento.
- `npm run typecheck`: checagem de tipos.
- `npm run lint`: alias da checagem de tipos.
- `npm run build`: build de produção do frontend.
- `npm start`: API em produção servindo o build.
