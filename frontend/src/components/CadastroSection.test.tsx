import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
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

  // Property 20: O cliente preserva a ordem recebida do servidor
  // Validates: Requirements 6.3, 6.6, 6.7
  it('Feature: melhorias-acordos, Property 20: O cliente preserva a ordem recebida do servidor', async () => {
    const itemArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
      nome: fc.string({ minLength: 1, maxLength: 20 }),
    });
    const itensArb = fc.uniqueArray(itemArb, {
      selector: (item) => item.id,
      maxLength: 8,
    });

    await fc.assert(
      fc.asyncProperty(itensArb, async (itens) => {
        const listar = vi.fn().mockResolvedValue(itens);
        const adicionar = vi.fn();

        const { unmount } = render(
          <CadastroSection<ItemCadastro>
            id="usuarios"
            titulo="Usuários"
            nomeItemSingular="Usuário"
            listar={listar}
            adicionar={adicionar}
            getId={(item) => item.id}
            getNome={(item) => item.nome}
          />,
        );

        if (itens.length === 0) {
          await screen.findByText('Nenhum valor cadastrado.');
          expect(screen.queryAllByTestId('cadastro-section-usuarios-item')).toHaveLength(0);
        } else {
          await screen.findAllByTestId('cadastro-section-usuarios-item');

          // Os itens renderizados devem corresponder exatamente, na mesma
          // ordem — sem reordenar, omitir, truncar ou duplicar —, à sequência
          // retornada por `listar` (Requisitos 6.3, 6.6, 6.7).
          const elementosItem = screen.getAllByTestId('cadastro-section-usuarios-item');
          expect(elementosItem).toHaveLength(itens.length);
          elementosItem.forEach((elemento, index) => {
            expect(elemento.textContent).toContain(itens[index].nome);
          });
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
