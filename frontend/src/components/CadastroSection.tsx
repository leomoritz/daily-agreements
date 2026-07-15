// CadastroSection — seção reutilizável de listar/adicionar/remover para os
// três cadastros configuráveis (design.md > Frontend Components >
// CadastrosAdminPage), que compartilham a mesma forma de validação
// (design.md > Key Design Decisions, item 4): Cadastro_de_Tipos_de_Acordo,
// Cadastro_de_Motivos_de_Nao_Cumprimento e Cadastro_de_Usuários.
//
// Requisitos 10.2-10.5, 11.2-11.5, 15.2-15.6: listar valores cadastrados,
// adicionar um novo valor exibindo o erro de validação retornado pela API
// em caso de rejeição (vazio, acima do limite, duplicado), e — quando a
// prop `remover` é informada — remover um valor exibindo o erro (ex.: "em
// uso") sem removê-lo da lista exibida em caso de falha.
//
// A prop `remover` é opcional para permitir reutilização por cadastros
// sem operação de remoção; atualmente os três cadastros configuráveis
// (Tipos_de_Acordo, Motivos_de_Nao_Cumprimento, Usuários) a utilizam.

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/errors';
import './CadastroSection.css';

type StatusCarregamento = 'carregando' | 'sucesso' | 'erro';

export interface CadastroSectionProps<T> {
  /** Identificador usado em ids/data-testid (ex.: "tipos-de-acordo"). */
  id: string;
  /** Título da seção, exibido como cabeçalho (ex.: "Tipos de Acordo"). */
  titulo: string;
  /** Nome no singular, usado em labels e mensagens (ex.: "Tipo de Acordo"). */
  nomeItemSingular: string;
  /** GET — retorna todos os valores cadastrados. */
  listar: () => Promise<T[]>;
  /** POST — adiciona um novo valor; deve rejeitar (ApiError) em caso de valor inválido. */
  adicionar: (valor: string) => Promise<T>;
  /**
   * DELETE — remove um valor pelo id. Quando omitida, nenhuma ação de
   * remoção é exibida (caso do Cadastro_de_Usuários neste MVP).
   */
  remover?: (id: string) => Promise<void>;
  /** Extrai o identificador único de um item. */
  getId: (item: T) => string;
  /** Extrai o texto exibido de um item. */
  getNome: (item: T) => string;
}

export function CadastroSection<T>({
  id,
  titulo,
  nomeItemSingular,
  listar,
  adicionar,
  remover,
  getId,
  getNome,
}: CadastroSectionProps<T>) {
  const [itens, setItens] = useState<T[]>([]);
  const [statusCarregamento, setStatusCarregamento] = useState<StatusCarregamento>('carregando');
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const [valorNovoItem, setValorNovoItem] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [erroAdicao, setErroAdicao] = useState<string | null>(null);

  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [errosRemocao, setErrosRemocao] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelado = false;

    setStatusCarregamento('carregando');
    setErroCarregamento(null);

    listar()
      .then((resultado) => {
        if (cancelado) return;
        setItens(resultado);
        setStatusCarregamento('sucesso');
      })
      .catch((error: unknown) => {
        if (cancelado) return;
        const mensagem =
          error instanceof ApiError
            ? error.message
            : `Não foi possível carregar ${titulo}.`;
        setErroCarregamento(mensagem);
        setStatusCarregamento('erro');
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErroAdicao(null);
    setAdicionando(true);

    try {
      const novoItem = await adicionar(valorNovoItem);
      setItens((atual) => [...atual, novoItem]);
      setValorNovoItem('');
    } catch (error) {
      const mensagem =
        error instanceof ApiError
          ? error.message
          : `Não foi possível adicionar ${nomeItemSingular}.`;
      setErroAdicao(mensagem);
    } finally {
      setAdicionando(false);
    }
  }

  async function handleRemover(item: T) {
    if (!remover) return;
    const itemId = getId(item);

    setErrosRemocao((atual) => {
      if (!(itemId in atual)) return atual;
      const resto = { ...atual };
      delete resto[itemId];
      return resto;
    });
    setRemovendoId(itemId);

    try {
      await remover(itemId);
      setItens((atual) => atual.filter((existente) => getId(existente) !== itemId));
    } catch (error) {
      const mensagem =
        error instanceof ApiError
          ? error.message
          : `Não foi possível remover ${nomeItemSingular}.`;
      setErrosRemocao((atual) => ({ ...atual, [itemId]: mensagem }));
    } finally {
      setRemovendoId(null);
    }
  }

  const inputId = `cadastro-section-${id}-input`;

  return (
    <section className="cadastro-section" data-testid={`cadastro-section-${id}`}>
      <h2>{titulo}</h2>

      {statusCarregamento === 'carregando' && (
        <p role="status">Carregando {titulo}...</p>
      )}

      {statusCarregamento === 'erro' && (
        <p role="alert" className="cadastro-section__erro">
          {erroCarregamento}
        </p>
      )}

      {statusCarregamento === 'sucesso' && (
        <>
          {itens.length === 0 ? (
            <p className="cadastro-section__vazio">Nenhum valor cadastrado.</p>
          ) : (
            <ul
              className="cadastro-section__lista"
              data-testid={`cadastro-section-${id}-lista`}
            >
              {itens.map((item) => {
                const itemId = getId(item);
                const erroRemocaoItem = errosRemocao[itemId];
                return (
                  <li
                    key={itemId}
                    className="cadastro-section__item"
                    data-testid={`cadastro-section-${id}-item`}
                  >
                    <div className="cadastro-section__item-linha">
                      <span>{getNome(item)}</span>
                      {remover && (
                        <button
                          type="button"
                          aria-label={`Remover ${getNome(item)}`}
                          disabled={removendoId === itemId}
                          onClick={() => handleRemover(item)}
                          data-testid={`cadastro-section-${id}-remover-${itemId}`}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    {erroRemocaoItem && (
                      <p
                        role="alert"
                        className="cadastro-section__erro"
                        data-testid={`cadastro-section-${id}-erro-remocao-${itemId}`}
                      >
                        {erroRemocaoItem}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form
            onSubmit={handleSubmit}
            className="cadastro-section__form"
            data-testid={`cadastro-section-${id}-form`}
          >
            <label htmlFor={inputId}>Novo {nomeItemSingular}</label>
            <div className="cadastro-section__form-linha">
              <input
                id={inputId}
                type="text"
                value={valorNovoItem}
                onChange={(event) => setValorNovoItem(event.target.value)}
                data-testid={`cadastro-section-${id}-input`}
              />
              <button type="submit" disabled={adicionando}>
                Adicionar
              </button>
            </div>
            {erroAdicao && (
              <p
                role="alert"
                className="cadastro-section__erro"
                data-testid={`cadastro-section-${id}-erro-adicao`}
              >
                {erroAdicao}
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}

export default CadastroSection;
