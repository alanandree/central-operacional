# Central Operacional — v2.0

Plataforma web para gestão de ocorrências do SAC, SLA com dias úteis/feriados/pausas, cadastro de motoristas com documentos e validade, WhatsApp Business Cloud API com triagem e pré-cadastro, assistente de IA, relatórios, LGPD e notificações.

## Instalação

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api
- Saúde: http://localhost:4000/api/health

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

Altere a senha em **Configurações → Segurança** ou em **Perfil → Alterar senha**. Trocar/redefinir senha revoga as sessões antigas.

## Banco de dados

SQLite local em `data/central.db`, criado automaticamente com migrações versionadas (`schema_migrations`). A persistência é real; nenhum dado de demonstração é inserido. Defina `DATA_DIR` para usar outro diretório de dados. A arquitetura separa o acesso a dados em `server/db.ts` para permitir migração futura para PostgreSQL/Supabase.

Tabelas principais: `occurrences`, `occurrence_history`, `occurrence_messages`, `occurrence_attachments`, `sla_pauses`, `drivers`, `driver_documents`, `driver_registration_flows`, `whatsapp_messages`, `ai_suggestions`, `privacy_requests`, `notifications`, `files`, `settings` e `activity_logs`.

## SLA

- Horário comercial, dias úteis e feriados configuráveis em **Configurações → SLA**.
- Fator de prazo por prioridade (`Baixa`, `Normal`, `Alta`, `Urgente`).
- Status configuráveis pausam o prazo: `Aguardando cliente`, `Aguardando transportadora` e `Aguardando motorista` por padrão.
- O backend recalcula `due_at`, registra pausas em `sla_pauses` e expõe `sla` em cada ocorrência.
- Filtros: `sla=overdue`, `sla=paused`, `sort=due`, `sort=priority`.
- Testes do motor: `npm test`.

## Motoristas

- Cadastro com foto, CNH, validade e documentos com arquivo real privado.
- Documentos com status `pendente`, `aprovado` ou `rejeitado`, notas e revisão por administrador.
- Alertas de CNH/documentos próximos do vencimento (`document_alert_days`).
- Aprovação bloqueada quando documentos obrigatórios não foram revisados/aprovados ou quando a CNH está vencida.
- Pré-cadastro via WhatsApp com consentimento explícito e envio de documentos.

## WhatsApp

Configuração em **WhatsApp**:

- `GET /api/whatsapp/status` mostra credenciais presentes, verificação e capacidades reais.
- `POST /api/whatsapp/verify` consulta a Graph API e marca a integração como verificada.
- Webhook: `GET/POST /api/webhooks/whatsapp` com verificação de token e assinatura `X-Hub-Signature-256`.
- Mensagens são deduplicadas por `wa_message_id`, com mídia baixada da Graph API, validada e armazenada em arquivos privados.
- Triagem automática cria `ai_suggestions`; nenhuma ocorrência é criada sem confirmação humana.
- Aprovar sugestão cria ocorrência; vincular associa a uma ocorrência existente; rejeitar registra o motivo.
- Pré-cadastro de motorista pelo WhatsApp: consentimento → nome → CPF → telefone → endereço → CNH/validade → fotos dos documentos.
- Envio fora da janela de 24 horas exige template aprovado (`central_operacional_update` e `central_driver_registration` por padrão).

A aplicação **não** usa QR Code, WhatsApp Web, scraping ou bibliotecas não oficiais. Sem credenciais, todas as operações externas retornam erro explícito; a importação manual e a triagem por regras locais continuam funcionando.

Grupos: a Cloud API nem sempre permite ler mensagens de grupos. Verifique a modalidade do número. Quando grupo não for suportado, use importação manual, encaminhamento para canal compatível ou criação rápida de ocorrência.

## Inteligência artificial

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (padrão: `https://api.openai.com/v1`)
- `OPENAI_MODEL` (padrão: `gpt-4o-mini`)

Com IA configurada: extração estruturada de mensagens, resumos, respostas sugeridas, similaridade de ocorrências, alertas de SLA e relatório executivo usam o modelo real.

Sem `OPENAI_API_KEY`:

- A triagem continua disponível por **regras locais determinísticas** e a interface identifica a fonte como `regras`.
- Endpoints que dependem de geração (`summarize`, `reply`, relatório com IA) retornam `503`; o relatório é gerado apenas com dados reais do banco e identificado como `dados`.

Nenhuma análise é simulada e nada é inventado.

## E-mail

- `RESEND_API_KEY` (opcional)
- `EMAIL_FROM` (opcional)

Sem provedor de e-mail, a recuperação de senha devolve um token apenas em desenvolvimento (`NODE_ENV` diferente de `production`), com aviso explícito na resposta.

## Segurança e LGPD

- JWT HS256 com `issuer`, `audience`, `jti` e revogação de sessões.
- Rate limit em login, recuperação de senha, troca de senha, WhatsApp e IA.
- Headers de segurança; CORS restritivo por `CORS_ORIGIN`.
- Uploads com limite de 15 MB e validação por assinatura do arquivo (magic bytes).
- Dados sensíveis são omitidos dos logs de auditoria.
- Exportação de dados e solicitações de privacidade em **Configurações → LGPD** (`/privacy/export`, `/privacy-requests`).

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

### Obrigatórias/recomendadas

- `JWT_SECRET`: chave longa e aleatória.
- `APP_URL`: URL pública da aplicação, usada em links e webhooks.
- `CORS_ORIGIN`: origens permitidas separadas por vírgula; vazio = restritivo.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: usuário inicial.

### WhatsApp

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_API_VERSION` (padrão: `v21.0`)
- `APP_SECRET` (usado para validar a assinatura `X-Hub-Signature-256`)

## Estrutura

- `server/`: API REST, autenticação, banco, SLA, triagem, integrações e uploads privados.
- `src/`: interface React + TypeScript + Tailwind + Lucide + Recharts.
- `tests/`: testes do motor de SLA.
- `data/`: banco SQLite e arquivos enviados (não versionados).

## Scripts

- `npm run dev`: API + frontend em modo de desenvolvimento.
- `npm run typecheck`: checagem de tipos.
- `npm run lint`: alias da checagem de tipos.
- `npm test`: testes automatizados.
- `npm run build`: build de produção do frontend.
- `npm start`: API em produção servindo o build.
