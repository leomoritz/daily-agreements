-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Acordo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "tipoAcordoId" TEXT NOT NULL,
    "responsavelId" TEXT,
    "dataRegistro" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estadoCumprimento" TEXT NOT NULL DEFAULT 'pendente',
    "motivoNaoCumprimentoId" TEXT,
    CONSTRAINT "Acordo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Acordo_tipoAcordoId_fkey" FOREIGN KEY ("tipoAcordoId") REFERENCES "TipoAcordo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Acordo_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "UsuarioCadastrado" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Acordo_motivoNaoCumprimentoId_fkey" FOREIGN KEY ("motivoNaoCumprimentoId") REFERENCES "MotivoNaoCumprimento" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Acordo" ("dataRegistro", "estadoCumprimento", "id", "motivoNaoCumprimentoId", "taskId", "tipoAcordoId") SELECT "dataRegistro", "estadoCumprimento", "id", "motivoNaoCumprimentoId", "taskId", "tipoAcordoId" FROM "Acordo";
DROP TABLE "Acordo";
ALTER TABLE "new_Acordo" RENAME TO "Acordo";
CREATE INDEX "Acordo_taskId_idx" ON "Acordo"("taskId");
CREATE INDEX "Acordo_tipoAcordoId_idx" ON "Acordo"("tipoAcordoId");
CREATE INDEX "Acordo_responsavelId_idx" ON "Acordo"("responsavelId");
CREATE INDEX "Acordo_motivoNaoCumprimentoId_idx" ON "Acordo"("motivoNaoCumprimentoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;