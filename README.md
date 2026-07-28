# [SIMPLIFICADO] - Publicação da Aplicação em Windows Server

## Etapa 1 - Instalar Node.js

Baixe a versão **LTS** do Node.js.

Valide a instalação:

```powershell
node -v
npm -v
```

Exemplo:

```text
v22.x.x
10.x.x
```

---

## Etapa 2 - Estrutura de Diretórios

Sugestão:

```text
C:\Apps\MeuSistema
│
├── backend
├── frontend
└── data
```

Copie o monorepo para:

```text
C:\Apps\MeuSistema
```

---

## Etapa 3 - Configurar SQLite

Crie o diretório:

```text
C:\Apps\MeuSistema\data
```

Configure o datasource do Prisma:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

Arquivo `.env`:

```env
DATABASE_URL="file:../data/database.sqlite"
```

Ou utilizando caminho absoluto:

```env
DATABASE_URL="file:C:/Apps/MeuSistema/data/database.sqlite"
```

> Recomenda-se utilizar caminho absoluto em produção.

---

## Etapa 4 - Publicar Backend

Entrar no diretório do backend:

```powershell
cd C:\Apps\MeuSistema\backend
```

Instalar dependências:

```powershell
npm install
```

Gerar build:

```powershell
npm run build
```

- Obs: Se der erro no build, executar primeiro os comandos  do prisma abaixo e depois retornar no comando de build.

Executar migrations:

```powershell
npx prisma migrate deploy
```

Gerar Prisma Client:

```powershell
npx prisma generate
```

Testar aplicação:

```powershell
npm run start
```

Ou:

```powershell
node dist/index.js
```

Validar:

```text
http://localhost:3001
```

---

## Etapa 5 - Ajustar CORS

Permissão ampla:

```typescript
app.use(
  cors({
    origin: [
      'http://localhost:8081',
      'http://vwt001appdhc003:8081'
    ]
  })
);
```

---

## Etapa 6 - Configurar Frontend

Entrar no diretório:

```powershell
cd C:\Apps\MeuSistema\frontend
```

Instalar dependências:

```powershell
npm install
```

Criar arquivo `.env`:

```env
VITE_API_URL=http://nomeDoServidor:3001
```

Ou:

```env
VITE_API_URL=http://IP_DO_SERVIDOR:3001
```

Exemplo:

```env
VITE_API_URL=http://192.168.1.10:3001
```

---

## Etapa 7 - Gerar Build do Frontend

```powershell
npm run build
```

Será criado o diretório:

```text
dist
```

---

## Etapa 8 - Instalar Servidor Web Simples

Instalar:

```powershell
npm install -g serve
```

Testar:

```powershell
serve -s dist -l 8081
```

Acessar:

```text
http://localhost:8081
```

---

## Etapa 9 - Instalar PM2

Instalar:

```powershell
npm install -g pm2
```

---

## Etapa 10 - Subir Backend com PM2

Dentro do diretório do backend:

```powershell
pm2 start dist/main.js --name backend
```

Verificar:

```powershell
pm2 ls
```

---

## Etapa 11 - Subir Frontend com PM2

Executar:

```powershell
pm2 start serve --name frontend -- -s dist -l 8081
```

Verificar:

```powershell
pm2 ls
```

Resultado esperado:

```text
frontend   online
backend    online
```

---

## Etapa 12 - Persistir PM2 Após Reinicialização

Salvar configuração atual:

```powershell
pm2 save
```

Instalar suporte para inicialização automática no Windows:

```powershell
npm install -g pm2-windows-startup
```

Executar:

```powershell
pm2-startup install
```

Após reinicialização do servidor:

```text
Backend sobe sozinho
Frontend sobe sozinho
```

---

## Etapa 13 - Liberar Firewall

### Backend (porta 3001)

```powershell
New-NetFirewallRule `
  -DisplayName "Backend 3001" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3001 `
  -Action Allow
```

### Frontend (porta 8081)

```powershell
New-NetFirewallRule `
  -DisplayName "Frontend 8081" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8081 `
  -Action Allow
```

---

## Etapa 14 - Descobrir Nome do Servidor

```powershell
hostname
```

Exemplo:

```text
SRV-HCM
```

---

## Etapa 15 - Testar pela Rede

De outro computador da rede:

```text
http://SRV-HCM:8081
```

Ou:

```text
http://192.168.1.10:8081
```

---

# Melhoria Recomendada para Produção

Em vez de expor:

```text
Frontend -> 8081
Backend  -> 3001
```

Exponha apenas o frontend.

No backend:

```typescript
app.listen(3001, '127.0.0.1');
```

Ou bloqueie a porta `3001` no firewall.

Fluxo recomendado:

```text
Usuário
   |
 8081
   |
Frontend
   |
 3001
   |
Backend
   |
SQLite
```

Dessa forma, os usuários não conseguem acessar a API diretamente pela rede.

---

# Processo de Atualização

## Backend

```powershell
git pull
npm install
npm run build
pm2 restart backend
```

## Frontend

```powershell
git pull
npm install
npm run build
pm2 restart frontend
```

---

# Considerações Finais

Para um cenário de:

- Aplicação interna
- Poucos usuários simultâneos
- Banco SQLite
- Servidor Windows
- Sem Docker
- Sem WSL

Esta é uma das arquiteturas mais simples, estáveis e com menor custo operacional.

A principal evolução recomendada futuramente seria substituir o **SQLite** por **PostgreSQL** caso o sistema passe a ter muitos acessos simultâneos ou necessite de maior robustez, escalabilidade e recursos avançados de banco de dados.