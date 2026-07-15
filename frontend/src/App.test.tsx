import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./api/client', () => ({
  obterLista: vi.fn().mockResolvedValue({ taskNova: [], taskComAcordo: [] }),
  obterAtividadesFinalizadas: vi.fn().mockResolvedValue([]),
  listarTiposDeAcordo: vi.fn().mockResolvedValue([]),
  adicionarTipoDeAcordo: vi.fn(),
  removerTipoDeAcordo: vi.fn(),
  listarMotivos: vi.fn().mockResolvedValue([]),
  adicionarMotivo: vi.fn(),
  removerMotivo: vi.fn(),
  listarUsuarios: vi.fn().mockResolvedValue([]),
  adicionarUsuario: vi.fn(),
  removerUsuario: vi.fn(),
}));

describe('project setup', () => {
  it('renders the app without crashing', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /lista de acordos/i }),
    ).toBeInTheDocument();
  });

  it('navega para a Administração de Cadastros e de volta para a Lista de Acordos (tarefa 28.1)', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: /lista de acordos/i });

    fireEvent.click(screen.getByTestId('nav-administracao-de-cadastros'));

    expect(
      await screen.findByRole('heading', { name: /administração de cadastros/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^lista de acordos$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nav-lista-de-acordos'));

    expect(
      await screen.findByRole('heading', { name: /^lista de acordos$/i }),
    ).toBeInTheDocument();
  });

  it('navega para as Atividades Finalizadas e de volta para a Lista de Acordos', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: /lista de acordos/i });

    fireEvent.click(screen.getByTestId('nav-atividades-finalizadas'));

    expect(
      await screen.findByRole('heading', { name: /atividades finalizadas/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^lista de acordos$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nav-lista-de-acordos'));

    expect(
      await screen.findByRole('heading', { name: /^lista de acordos$/i }),
    ).toBeInTheDocument();
  });
});
