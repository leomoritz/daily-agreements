import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CadastroEmLotePanel } from './CadastroEmLotePanel';
import { ApiError } from '../api/errors';
import type { ResultadoLinhaLote } from '../api/types';

const { processarLote } = vi.hoisted(() => ({
  processarLote: vi.fn(),
}));

vi.mock('../api/client', () => ({
  processarLote,
}));

describe('CadastroEmLotePanel', () => {
  it('exibe o relatório com status aceita/rejeitada e o motivo das rejeições (Requisitos 12.5, 12.6)', async () => {
    const relatorio: ResultadoLinhaLote[] = [
      { numeroLinha: 1, linha: 'Revisar contrato', aceita: true, taskId: 'task-1' },
      {
        numeroLinha: 2,
        linha: '',
        aceita: false,
        motivoCodigo: 'TITULO_INVALIDO',
        motivoMensagem: 'Título é obrigatório.',
      },
      {
        numeroLinha: 3,
        linha: 'Enviar para deploy;Tipo Inexistente',
        aceita: false,
        motivoCodigo: 'TIPO_DE_ACORDO_INVALIDO',
        motivoMensagem: 'Tipo_de_Acordo informado não existe.',
      },
    ];
    processarLote.mockResolvedValue(relatorio);

    render(<CadastroEmLotePanel />);

    fireEvent.click(screen.getByRole('button', { name: /cadastro em lote/i }));

    const textarea = screen.getByLabelText(/tasks a cadastrar/i);
    fireEvent.change(textarea, {
      target: { value: 'Revisar contrato\n\nEnviar para deploy;Tipo Inexistente' },
    });

    const botaoSubmit = screen.getByRole('button', { name: /cadastrar em lote/i });
    fireEvent.click(botaoSubmit);

    expect(processarLote).toHaveBeenCalledTimes(1);

    const listaRelatorio = await screen.findByTestId('cadastro-em-lote-relatorio');
    const itens = within(listaRelatorio).getAllByTestId('cadastro-em-lote-linha');
    expect(itens).toHaveLength(3);

    expect(itens[0]).toHaveTextContent('Linha 1:');
    expect(itens[0]).toHaveTextContent('Aceita');
    expect(itens[0]).not.toHaveTextContent('Rejeitada');

    expect(itens[1]).toHaveTextContent('Linha 2:');
    expect(itens[1]).toHaveTextContent('Rejeitada');
    expect(itens[1]).toHaveTextContent('Título é obrigatório.');

    expect(itens[2]).toHaveTextContent('Linha 3:');
    expect(itens[2]).toHaveTextContent('Rejeitada');
    expect(itens[2]).toHaveTextContent('Tipo_de_Acordo informado não existe.');
  });

  it('exibe uma mensagem de erro (sem relatório) quando a requisição falha (ApiError)', async () => {
    processarLote.mockRejectedValue(
      new ApiError(500, 'ERRO_INTERNO', 'Falha ao processar o lote.'),
    );

    render(<CadastroEmLotePanel />);

    fireEvent.click(screen.getByRole('button', { name: /cadastro em lote/i }));

    const textarea = screen.getByLabelText(/tasks a cadastrar/i);
    fireEvent.change(textarea, { target: { value: 'Revisar contrato' } });

    const botaoSubmit = screen.getByRole('button', { name: /cadastrar em lote/i });
    fireEvent.click(botaoSubmit);

    const erro = await screen.findByRole('alert');
    expect(erro).toHaveTextContent('Falha ao processar o lote.');
    expect(screen.queryByTestId('cadastro-em-lote-relatorio')).not.toBeInTheDocument();
  });
});
