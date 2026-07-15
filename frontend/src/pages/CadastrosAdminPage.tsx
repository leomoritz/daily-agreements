// CadastrosAdminPage — página de administração dos três cadastros
// configuráveis (design.md > Frontend Components > CadastrosAdminPage):
// Cadastro_de_Tipos_de_Acordo, Cadastro_de_Motivos_de_Nao_Cumprimento e
// Cadastro_de_Usuários.
//
// Requisitos 10.2-10.5: listar/adicionar/remover Tipos_de_Acordo,
// rejeitando remoção de valores em uso.
// Requisitos 11.2-11.5: listar/adicionar/remover Motivos_de_Nao_Cumprimento,
// rejeitando remoção de valores em uso.
// Requisitos 15.2-15.6: listar/adicionar/remover Usuário_Cadastrado,
// rejeitando remoção de valores em uso como Responsável de alguma Task.
//
// Cada cadastro é renderizado por uma CadastroSection (ver
// ../components/CadastroSection.tsx), que encapsula a lógica comum de
// listar/adicionar/remover compartilhada pelos três cadastros.
//
// Esta página é conectada à navegação principal em App.tsx (tarefa 28.1).

import {
  adicionarMotivo,
  adicionarTipoDeAcordo,
  adicionarUsuario,
  listarMotivos,
  listarTiposDeAcordo,
  listarUsuarios,
  removerMotivo,
  removerTipoDeAcordo,
  removerUsuario,
} from '../api/client';
import type { MotivoNaoCumprimento, TipoAcordo, UsuarioCadastrado } from '../api/types';
import { CadastroSection } from '../components/CadastroSection';
import './CadastrosAdminPage.css';

export function CadastrosAdminPage() {
  return (
    <main className="cadastros-admin-page">
      <h1>Administração de Cadastros</h1>

      <CadastroSection<TipoAcordo>
        id="tipos-de-acordo"
        titulo="Tipos de Acordo"
        nomeItemSingular="Tipo de Acordo"
        listar={listarTiposDeAcordo}
        adicionar={adicionarTipoDeAcordo}
        remover={removerTipoDeAcordo}
        getId={(item) => item.id}
        getNome={(item) => item.nome}
      />

      <CadastroSection<MotivoNaoCumprimento>
        id="motivos-de-nao-cumprimento"
        titulo="Motivos de Não Cumprimento"
        nomeItemSingular="Motivo de Não Cumprimento"
        listar={listarMotivos}
        adicionar={adicionarMotivo}
        remover={removerMotivo}
        getId={(item) => item.id}
        getNome={(item) => item.nome}
      />

      <CadastroSection<UsuarioCadastrado>
        id="usuarios"
        titulo="Usuários"
        nomeItemSingular="Usuário"
        listar={listarUsuarios}
        adicionar={adicionarUsuario}
        remover={removerUsuario}
        getId={(item) => item.id}
        getNome={(item) => item.nomeLogin}
      />
    </main>
  );
}

export default CadastrosAdminPage;
