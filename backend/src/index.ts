import express from 'express';
import cors from 'cors';

import { errorHandler } from './middleware/errorHandler.js';
import {
  motivosDeNaoCumprimentoRouter,
  tiposDeAcordoRouter,
  usuariosRouter,
} from './routes/cadastroRoutes.js';
import { tasksRouter } from './routes/taskRoutes.js';

const app = express();

app.use(
  cors({
    origin: [
      'http://localhost:8081',    ]
   })
);

app.use(express.json());

const PORT = process.env.PORT ?? 3001;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/tasks', tasksRouter);
app.use('/tipos-de-acordo', tiposDeAcordoRouter);
app.use('/motivos-de-nao-cumprimento', motivosDeNaoCumprimentoRouter);
app.use('/usuarios', usuariosRouter);

// Routes are registered above this line (added in later tasks).
// The error handler must always be the last middleware registered.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Daily Agreements backend listening on port ${PORT}`);
});

export { app };
