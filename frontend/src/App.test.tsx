import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./api/client', () => ({
  obterLista: vi.fn().mockResolvedValue({ taskNova: [], taskComAcordo: [] }),
  obterAtividadesFinalizadas: vi.fn().mockResolvedValue([]),
  obterAcordosNaoAtualizados: vi.fn().mockResolvedValue([]),
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

  it('exibe a aba "Acordos Não Atualizados" entre "Lista de Acordos" e "Atividades Finalizadas" (tarefa 13.5)', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: /lista de acordos/i });

    const nav = screen.getByRole('navigation', { name: /navegação principal/i });
    const botoes = within(nav).getAllByRole('button');
    const rotulos = botoes.map((botao) => botao.textContent);

    expect(rotulos.indexOf('Acordos Não Atualizados')).toBe(
      rotulos.indexOf('Lista de Acordos') + 1,
    );
    expect(rotulos.indexOf('Acordos Não Atualizados')).toBe(
      rotulos.indexOf('Atividades Finalizadas') - 1,
    );
  });

  it('navega para os Acordos Não Atualizados e de volta para a Lista de Acordos', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: /lista de acordos/i });

    fireEvent.click(screen.getByTestId('nav-acordos-nao-atualizados'));

    expect(
      await screen.findByRole('heading', { name: /acordos não atualizados/i }),
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
