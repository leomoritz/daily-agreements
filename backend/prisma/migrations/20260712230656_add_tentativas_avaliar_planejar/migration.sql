-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "responsavelId" TEXT,
    "numTentativas" INTEGER NOT NULL DEFAULT 0,
    "tentativasAvaliarPlanejar" INTEGER NOT NULL DEFAULT 0,
    "ordemExibicao" INTEGER NOT NULL,
    "acordoAtualId" TEXT,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Task_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "UsuarioCadastrado" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_acordoAtualId_fkey" FOREIGN KEY ("acordoAtualId") REFERENCES "Acordo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("acordoAtualId", "concluida", "criadaEm", "descricao", "id", "numTentativas", "ordemExibicao", "responsavelId", "titulo") SELECT "acordoAtualId", "concluida", "criadaEm", "descricao", "id", "numTentativas", "ordemExibicao", "responsavelId", "titulo" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_acordoAtualId_key" ON "Task"("acordoAtualId");
CREATE INDEX "Task_responsavelId_idx" ON "Task"("responsavelId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
