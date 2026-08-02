// App — ponto de entrada da aplicação (tarefa 28.1 — wiring final do
// frontend). Alterna entre as duas páginas de topo (`ListaDeAcordosPage`
// e `CadastrosAdminPage`) através de um estado simples, sem depender de
// uma biblioteca de roteamento: o app só tem duas páginas de topo e não
// há requisito de deep-linking (design.md descreve este MVP como
// deliberadamente leve, sem infraestrutura extra), então uma alternância
// baseada em `useState` é suficiente e consistente com a simplicidade do
// restante do projeto.

import { useState } from 'react';
import { ListaDeAcordosPage } from './pages/ListaDeAcordosPage';
import { CadastrosAdminPage } from './pages/CadastrosAdminPage';
import { AtividadesFinalizadasPage } from './pages/AtividadesFinalizadasPage';
import { AcordosNaoAtualizadosPage } from './pages/AcordosNaoAtualizadosPage';
import './App.css';

type Pagina = 'lista' | 'admin' | 'finalizadas' | 'nao-atualizados';

function App() {
  const [pagina, setPagina] = useState<Pagina>('lista');

  return (
    <div className="app">
      <nav className="app__nav" aria-label="Navegação principal">
        <button
          type="button"
          onClick={() => setPagina('lista')}
          className={pagina === 'lista' ? 'app__nav-link app__nav-link--ativo' : 'app__nav-link'}
          aria-current={pagina === 'lista' ? 'page' : undefined}
          data-testid="nav-lista-de-acordos"
        >
          Lista de Acordos
        </button>
        <button
          type="button"
          onClick={() => setPagina('nao-atualizados')}
          className={
            pagina === 'nao-atualizados' ? 'app__nav-link app__nav-link--ativo' : 'app__nav-link'
          }
          aria-current={pagina === 'nao-atualizados' ? 'page' : undefined}
          data-testid="nav-acordos-nao-atualizados"
        >
          Acordos Não Atualizados
        </button>
        <button
          type="button"
          onClick={() => setPagina('finalizadas')}
          className={
            pagina === 'finalizadas' ? 'app__nav-link app__nav-link--ativo' : 'app__nav-link'
          }
          aria-current={pagina === 'finalizadas' ? 'page' : undefined}
          data-testid="nav-atividades-finalizadas"
        >
          Atividades Finalizadas
        </button>
        <button
          type="button"
          onClick={() => setPagina('admin')}
          className={pagina === 'admin' ? 'app__nav-link app__nav-link--ativo' : 'app__nav-link'}
          aria-current={pagina === 'admin' ? 'page' : undefined}
          data-testid="nav-administracao-de-cadastros"
        >
          Administração de Cadastros
        </button>
      </nav>

      {pagina === 'lista' && <ListaDeAcordosPage />}
      {pagina === 'nao-atualizados' && <AcordosNaoAtualizadosPage />}
      {pagina === 'finalizadas' && <AtividadesFinalizadasPage />}
      {pagina === 'admin' && <CadastrosAdminPage />}
    </div>
  );
}

export default App;
