-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "responsavelId" TEXT,
    "numTentativas" INTEGER NOT NULL DEFAULT 0,
    "ordemExibicao" INTEGER NOT NULL,
    "acordoAtualId" TEXT,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Task_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "UsuarioCadastrado" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_acordoAtualId_fkey" FOREIGN KEY ("acordoAtualId") REFERENCES "Acordo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Acordo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "tipoAcordoId" TEXT NOT NULL,
    "dataRegistro" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estadoCumprimento" TEXT NOT NULL DEFAULT 'pendente',
    "motivoNaoCumprimentoId" TEXT,
    CONSTRAINT "Acordo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Acordo_tipoAcordoId_fkey" FOREIGN KEY ("tipoAcordoId") REFERENCES "TipoAcordo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Acordo_motivoNaoCumprimentoId_fkey" FOREIGN KEY ("motivoNaoCumprimentoId") REFERENCES "MotivoNaoCumprimento" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TipoAcordo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MotivoNaoCumprimento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UsuarioCadastrado" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nomeLogin" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_acordoAtualId_key" ON "Task"("acordoAtualId");

-- CreateIndex
CREATE INDEX "Task_responsavelId_idx" ON "Task"("responsavelId");

-- CreateIndex
CREATE INDEX "Acordo_taskId_idx" ON "Acordo"("taskId");

-- CreateIndex
CREATE INDEX "Acordo_tipoAcordoId_idx" ON "Acordo"("tipoAcordoId");

-- CreateIndex
CREATE INDEX "Acordo_motivoNaoCumprimentoId_idx" ON "Acordo"("motivoNaoCumprimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "TipoAcordo_nome_key" ON "TipoAcordo"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "MotivoNaoCumprimento_nome_key" ON "MotivoNaoCumprimento"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioCadastrado_nomeLogin_key" ON "UsuarioCadastrado"("nomeLogin");
