// Shared PrismaClient singleton for the Daily Agreements backend.
//
// Repositories should default to this shared instance so the application
// runs with a single connection pool, while still allowing an explicit
// PrismaClient to be injected (e.g. for tests against an isolated SQLite
// file, following the pattern used in prisma/seed.test.ts).

import { PrismaClient } from '../../generated/prisma/index.js';

export const prisma = new PrismaClient();
