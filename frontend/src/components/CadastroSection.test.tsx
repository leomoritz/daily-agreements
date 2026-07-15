import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CadastroSection } from './CadastroSection';
import { ApiError } from '../api/errors';

interface ItemCadastro {
  id: string;
  nome: string;
}

function criarItem(overrides: Partial<ItemCadastro> = {}): ItemCadastro {
  return { id: 'item-1', nome: 'Avaliar e planejar', ...overrides };
}

describe('CadastroSection', () => {
  it('exibe o erro de adição e não adiciona o item quando `adicionar` rejeita (duplicado/limite) (Requisitos 10.3, 11.3, 15.3, 15.5)', async () => {
    const itemExistente = criarItem();
    const listar = vi.fn().mockResolvedValue([itemExistente]);
    const adicionar = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'VALOR_DUPLICADO', 'Valor já cadastrado.'));

    render(
      <CadastroSection<ItemCadastro>
        id="tipos-de-acordo"
        titulo="Tipos de Acordo"
        nomeItemSingular="Tipo de Acordo"
        listar={listar}
        adicionar={adicionar}
        getId={(item) => item.id}
        getNome={(item) => item.nome}
      />,
    );

    const input = await screen.findByTestId('cadastro-section-tipos-de-acordo-input');
    fireEvent.change(input, { target: { value: 'Avaliar e planejar' } });
    fireEvent.submit(screen.getByTestId('cadastro-section-tipos-de-acordo-form'));

    const erro = await screen.findByTestId('cadastro-section-tipos-de-acordo-erro-adicao');
    expect(erro).toHaveTextContent('Valor já cadastrado.');

    const itens = screen.getAllByTestId('cadastro-section-tipos-de-acordo-item');
    expect(itens).toHaveLength(1);
    expect(screen.getByText('Avaliar e planejar')).toBeInTheDocument();
    expect(adicionar).toHaveBeenCalledTimes(1);
  });

  it('exibe o erro de remoção e mantém o item na lista quando `remover` rejeita (valor em uso) (Requisitos 10.5, 11.5, 15.5)', async () => {
    const item = criarItem();
    const listar = vi.fn().mockResolvedValue([item]);
    const adicionar = vi.fn();
    const remover = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'VALOR_EM_USO', 'Valor em uso por um Acordo.'));

    render(
      <CadastroSection<ItemCadastro>
        id="tipos-de-acordo"
        titulo="Tipos de Acordo"
        nomeItemSingular="Tipo de Acordo"
        listar={listar}
        adicionar={adicionar}
        remover={remover}
        getId={(item) => item.id}
        getNome={(item) => item.nome}
      />,
    );

    const botaoRemover = await screen.findByTestId(
      `cadastro-section-tipos-de-acordo-remover-${item.id}`,
    );
    fireEvent.click(botaoRemover);

    await waitFor(() => expect(remover).toHaveBeenCalledTimes(1));

    const erro = await screen.findByTestId(
      `cadastro-section-tipos-de-acordo-erro-remocao-${item.id}`,
    );
    expect(erro).toHaveTextContent('Valor em uso por um Acordo.');

    const itens = screen.getAllByTestId('cadastro-section-tipos-de-acordo-item');
    expect(itens).toHaveLength(1);
    expect(screen.getByText('Avaliar e planejar')).toBeInTheDocument();
  });
});
