# Requirements Document

## Introduction

Este documento descreve os requisitos do MVP da extensão "Daily Agreements", uma aplicação que apoia a condução de dailies do time de desenvolvimento com base em acordos objetivos por atividade (task).

O modelo de trabalho do time é centrado em compromissos rastreáveis: cada task revisada na daily possui um acordo anterior que é avaliado (cumprido ou não cumprido) e, quando aplicável, recebe um novo acordo para o próximo ciclo. O foco não está no relato individual de cada pessoa, mas em garantir que toda atividade tenha um próximo passo claro e cobrável, com um Responsável identificável por etapa.

Neste primeiro MVP, a aplicação NÃO realiza integração com o Azure Boards. Todas as tasks e acordos são gerenciados de forma independente dentro da própria aplicação. A integração com Azure Boards (leitura de atividades, gravação de acordos e filtragem por classificação de acordo) é um objetivo de evolução futura, fora do escopo deste documento. O Sistema é uma ferramenta de apoio à condução da daily e não pretende substituir o Azure Boards como ferramenta de gestão de trabalho.

## Glossary

- **Sistema**: A aplicação "Daily Agreements", responsável por gerenciar tasks e acordos de daily.
- **Task**: Uma atividade de trabalho do time, cadastrada no Sistema, sobre a qual acordos de daily são firmados. Além do título e da descrição, uma Task possui um Responsável atual (opcional), um Nº_Tentativas e uma Ordem_de_Exibição.
- **Acordo**: Um compromisso objetivo registrado para uma Task, composto por um Tipo_de_Acordo, uma data de registro e um estado de cumprimento.
- **Tipo_de_Acordo**: Uma classificação do Acordo, cujos valores válidos são mantidos no Cadastro_de_Tipos_de_Acordo. Esse cadastro é inicializado com os valores "Avaliar e planejar", "Enviar para code review", "Enviar para review", "Enviar para deploy" e "Finalizar", podendo receber novos valores cadastrados por um Usuário.
- **Acordo_Atual**: O Acordo mais recente registrado para uma Task, ainda não avaliado na daily seguinte.
- **Daily**: A sessão em que o time revisa o Acordo_Atual de cada Task e registra seu cumprimento.
- **Task_Nova**: Uma Task que ainda não possui nenhum Acordo registrado.
- **Task_Com_Acordo**: Uma Task que possui um Acordo_Atual pendente de avaliação.
- **Lista_de_Acordos**: A visualização apresentada durante a Daily contendo as Tasks agrupadas por Task_Nova e Task_Com_Acordo, ordenadas pela Ordem_de_Exibição vigente e filtráveis por título ou Responsável.
- **Usuário**: Qualquer membro do time de desenvolvimento que utiliza o Sistema para registrar ou avaliar Acordos.
- **Cadastro_de_Usuários**: O conjunto configurável de Usuário_Cadastrado válidos para seleção como Responsável, inicializado com um Usuário_Cadastrado semeado (disponível desde a inicialização do Sistema) e passível de receber novos Usuário_Cadastrado adicionados por um Usuário. O Cadastro_de_Usuários é exclusivamente um registro de referência para preencher o seletor de Responsável; este MVP NÃO inclui autenticação, tela de login, sessão de usuário ou controle de acesso, e nenhuma senha é armazenada para nenhum Usuário_Cadastrado.
- **Usuário_Cadastrado**: Uma entrada do Cadastro_de_Usuários, identificada por um nome/login único (sem diferenciar maiúsculas de minúsculas), que pode ser selecionada como Responsável de uma Task. Não deve ser confundido com o termo "Usuário", que se refere ao ator genérico que executa ações no Sistema.
- **Responsável**: O Usuário_Cadastrado que assumiu o compromisso do Acordo_Atual de uma Task, referenciado a partir do Cadastro_de_Usuários. É opcional, pode ser definido na criação da Task e pode ser alterado a cada novo Acordo registrado, refletindo a mudança de responsabilidade ao longo das etapas da Task.
- **Nº_Tentativas**: Um contador inteiro, associado a cada Task, que representa quantas vezes um Acordo dessa Task já foi avaliado como não cumprido. É inicializado em zero na criação da Task e incrementado a cada avaliação como não cumprido.
- **Motivo_de_Nao_Cumprimento**: Um valor selecionado pelo Usuário, dentre os mantidos no Cadastro_de_Motivos_de_Nao_Cumprimento, que descreve a causa de um Acordo ter sido avaliado como não cumprido.
- **Cadastro_de_Tipos_de_Acordo**: O conjunto configurável de valores válidos de Tipo_de_Acordo, inicializado com valores semeados e passível de receber novos valores adicionados por um Usuário.
- **Cadastro_de_Motivos_de_Nao_Cumprimento**: O conjunto configurável de valores válidos de Motivo_de_Nao_Cumprimento, inicializado com valores semeados e passível de receber novos valores adicionados por um Usuário.
- **Ordem_de_Exibição**: O atributo que determina a posição relativa de uma Task na Lista_de_Acordos, definida pela ordem de cadastro em lote ou alterada por reordenação manual (arrastar e soltar).

## Requirements

### Requisito 1: Cadastro de Task

**User Story:** Como membro do time, eu quero cadastrar uma task no Sistema, para que ela possa receber acordos de daily.

#### Critérios de Aceitação

1. QUANDO um Usuário submete um título de Task cujo comprimento, após a remoção de espaços em branco no início e no fim (trim), esteja entre 1 e 200 caracteres, O Sistema DEVE criar uma nova Task com o título resultante do trim e classificá-la como Task_Nova.
2. SE um Usuário submete um título de Task que, após o trim, resulte em uma string vazia, ENTÃO O Sistema DEVE rejeitar a criação da Task, exibir uma mensagem de erro indicando que o título é obrigatório e manter a lista de Tasks inalterada.
3. SE um Usuário submete um título de Task cujo comprimento, após o trim, seja superior a 200 caracteres, ENTÃO O Sistema DEVE rejeitar a criação da Task, exibir uma mensagem de erro indicando que o título excede o limite máximo de 200 caracteres e manter a lista de Tasks inalterada.
4. QUANDO uma Task é criada, O Sistema DEVE atribuir a ela um identificador único que não pode coincidir com o identificador de nenhuma outra Task existente no Sistema.
5. ONDE uma descrição opcional é fornecida na criação da Task e seu comprimento não exceda 2000 caracteres, O Sistema DEVE armazenar essa descrição junto à Task.
6. SE uma descrição opcional fornecida na criação da Task exceder 2000 caracteres, ENTÃO O Sistema DEVE rejeitar a criação da Task e exibir uma mensagem de erro indicando que a descrição excede o limite máximo de 2000 caracteres.
7. ONDE um Responsável é informado na criação da Task e corresponde a um Usuário_Cadastrado existente no Cadastro_de_Usuários, O Sistema DEVE armazenar essa referência como o Responsável atual da Task.
8. SE um Responsável informado na criação da Task não corresponder a nenhum Usuário_Cadastrado existente no Cadastro_de_Usuários, ENTÃO O Sistema DEVE rejeitar a criação da Task e exibir uma mensagem de erro indicando que o Responsável informado não está cadastrado.
9. QUANDO uma Task é criada, O Sistema DEVE inicializar o Nº_Tentativas dessa Task com o valor zero.

### Requisito 2: Registro de Acordo para Task Nova

**User Story:** Como membro do time, eu quero registrar o primeiro acordo de uma task nova, para que ela passe a ter um compromisso rastreável.

#### Critérios de Aceitação

1. QUANDO um Usuário registra um Acordo com um Tipo_de_Acordo válido para uma Task classificada como Task_Nova, O Sistema DEVE definir esse Acordo como o Acordo_Atual da Task e reclassificá-la como Task_Com_Acordo.
2. SE um Usuário tenta registrar um Acordo com um Tipo_de_Acordo que não pertence ao Cadastro_de_Tipos_de_Acordo, ENTÃO O Sistema DEVE rejeitar o registro, informar que o Tipo_de_Acordo é inválido e manter o estado da Task inalterado.
3. QUANDO um Acordo é registrado, O Sistema DEVE gerar automaticamente a data de registro do Acordo com base no instante em que o registro ocorre, sem permitir que o Usuário forneça ou sobrescreva esse valor.
4. SE um Usuário tenta registrar um Acordo para uma Task que não existe no Sistema, ENTÃO O Sistema DEVE rejeitar o registro, informar que a Task não foi encontrada e manter o estado do Sistema inalterado.
5. SE um Usuário tenta registrar um primeiro Acordo para uma Task que já está classificada como Task_Com_Acordo, ENTÃO O Sistema DEVE rejeitar o registro, informar que a Task já possui um Acordo_Atual pendente de avaliação e manter o Acordo_Atual existente inalterado.
6. O Sistema NÃO DEVE exigir o registro de um Acordo no momento da criação de uma Task, permitindo que uma Task_Nova permaneça sem Acordo por tempo indeterminado até que um Acordo seja registrado para ela, inclusive durante uma apresentação da Daily.

### Requisito 3: Revisão do Acordo Atual na Daily

**User Story:** Como time, eu quero revisar o acordo anterior de cada task com acordo, para que a conversa da daily seja objetiva sobre cumprimento e próximos passos.

#### Critérios de Aceitação

1. QUANDO a Lista_de_Acordos é apresentada, O Sistema DEVE exibir, para cada Task_Com_Acordo, o título da Task, o Tipo_de_Acordo, a data de registro do Acordo_Atual e o Responsável atual da Task, quando houver.
2. QUANDO a Lista_de_Acordos é apresentada, O Sistema DEVE agrupar as Tasks em exatamente dois grupos distintos e identificáveis: Task_Nova e Task_Com_Acordo.
3. QUANDO a Lista_de_Acordos é apresentada, O Sistema DEVE exibir, para cada Task_Nova, o título da Task e o Responsável atual da Task, quando houver, no grupo Task_Nova.
4. SE o grupo Task_Nova ou o grupo Task_Com_Acordo não contém nenhuma Task, ENTÃO O Sistema DEVE exibir esse grupo vazio, com uma indicação de que não há Tasks nessa categoria, sem removê-lo da Lista_de_Acordos.
5. QUANDO a Lista_de_Acordos é apresentada, O Sistema DEVE exibir as Tasks de cada grupo ordenadas de acordo com a Ordem_de_Exibição vigente.
6. QUANDO o Acordo_Atual de uma Task_Com_Acordo estiver marcado como não cumprido, O Sistema DEVE exibir essa Task na Lista_de_Acordos com um indicador visual de alerta (fundo vermelho) e o valor atual do Nº_Tentativas dessa Task.

### Requisito 4: Avaliação de Cumprimento do Acordo

**User Story:** Como membro do time, eu quero marcar se o acordo atual de uma task foi cumprido ou não, para que o próximo passo da task seja definido de forma objetiva.

#### Critérios de Aceitação

1. QUANDO um Usuário marca o Acordo_Atual de uma Task_Com_Acordo como cumprido, O Sistema DEVE registrar esse Acordo como cumprido, mantendo-o como Acordo_Atual da Task até que um novo Acordo seja registrado ou a Task seja removida.
2. QUANDO um Usuário marca o Acordo_Atual de uma Task_Com_Acordo como não cumprido, O Sistema DEVE registrar esse Acordo como não cumprido, manter a Task visível na Lista_de_Acordos e mantê-lo como Acordo_Atual da Task até que um novo Acordo seja registrado ou a Task seja removida.
3. QUANDO um Usuário marca o Acordo_Atual de uma Task_Com_Acordo como não cumprido, O Sistema DEVE incrementar em 1 o Nº_Tentativas dessa Task.
4. O Sistema DEVE manter o Nº_Tentativas de uma Task inalterado em qualquer avaliação diferente de "não cumprido", alterando-o apenas por incremento, conforme o critério 3 deste Requisito.
5. ONDE um Motivo_de_Nao_Cumprimento pertencente ao Cadastro_de_Motivos_de_Nao_Cumprimento é selecionado pelo Usuário ao marcar um Acordo como não cumprido, O Sistema DEVE armazenar esse Motivo_de_Nao_Cumprimento associado ao Acordo.
6. ONDE nenhum Motivo_de_Nao_Cumprimento é selecionado pelo Usuário ao marcar um Acordo como não cumprido, O Sistema DEVE registrar a avaliação como não cumprido sem nenhum Motivo_de_Nao_Cumprimento associado ao Acordo.
7. SE um Usuário tenta associar a um Acordo marcado como não cumprido um Motivo_de_Nao_Cumprimento que não pertence ao Cadastro_de_Motivos_de_Nao_Cumprimento, ENTÃO O Sistema DEVE rejeitar o registro do motivo, informar que o motivo é inválido e preservar a avaliação de cumprimento já registrada para o Acordo.
8. SE um Usuário tenta avaliar o cumprimento de uma Task que não possui Acordo_Atual, ENTÃO O Sistema DEVE rejeitar a operação, informar que a Task não possui Acordo_Atual e manter o estado da Task inalterado.

### Requisito 5: Registro do Próximo Acordo

**User Story:** Como membro do time, eu quero registrar o próximo acordo de uma task após avaliar o acordo anterior, para que toda atividade continue tendo um compromisso rastreável e um responsável identificado.

#### Critérios de Aceitação

1. QUANDO o Acordo_Atual de uma Task é avaliado como cumprido e seu Tipo_de_Acordo é diferente de "Finalizar", O Sistema DEVE registrar o novo Acordo submetido pelo Usuário para essa Task e defini-lo como o novo Acordo_Atual.
2. QUANDO o Acordo_Atual de uma Task é avaliado como não cumprido, O Sistema DEVE registrar o novo Acordo submetido pelo Usuário para essa Task, representando o próximo compromisso, e defini-lo como o novo Acordo_Atual.
3. QUANDO um novo Acordo é registrado para uma Task cujo Acordo_Atual já foi avaliado, independentemente do desfecho da avaliação (cumprido ou não cumprido), O Sistema DEVE substituir o Acordo_Atual pelo novo Acordo.
4. SE um Usuário tenta registrar um novo Acordo com um Tipo_de_Acordo que não pertence ao Cadastro_de_Tipos_de_Acordo, ENTÃO O Sistema DEVE rejeitar o registro, informar que o Tipo_de_Acordo é inválido e manter o Acordo_Atual da Task inalterado.
5. SE um Usuário tenta registrar um novo Acordo para uma Task cujo Acordo_Atual ainda não foi avaliado, ENTÃO O Sistema DEVE rejeitar o registro e manter o Acordo_Atual da Task inalterado.
6. ONDE um Responsável é informado pelo Usuário ao registrar um novo Acordo para uma Task e corresponde a um Usuário_Cadastrado existente no Cadastro_de_Usuários, O Sistema DEVE atualizar o Responsável atual dessa Task para essa referência.
7. ONDE nenhum Responsável é informado pelo Usuário ao registrar um novo Acordo para uma Task, O Sistema DEVE manter o Responsável atual dessa Task inalterado.
8. SE um Responsável informado pelo Usuário ao registrar um novo Acordo não corresponder a nenhum Usuário_Cadastrado existente no Cadastro_de_Usuários, ENTÃO O Sistema DEVE rejeitar o registro do novo Acordo, exibir uma mensagem de erro indicando que o Responsável informado não está cadastrado e manter o Acordo_Atual e o Responsável atual da Task inalterados.

### Requisito 6: Remoção de Task Finalizada

**User Story:** Como time, eu quero que tasks com acordo "Finalizar" cumprido saiam da lista de acordos, para que a daily foque somente em atividades ainda em andamento.

#### Critérios de Aceitação

1. QUANDO o Acordo_Atual de uma Task tem Tipo_de_Acordo igual a "Finalizar" e é avaliado como cumprido, O Sistema DEVE remover essa Task da Lista_de_Acordos, de modo que ela não seja exibida nem na apresentação corrente nem em apresentações futuras da Lista_de_Acordos.
2. ENQUANTO uma Task permanecer removida da Lista_de_Acordos por conclusão, O Sistema NÃO DEVE exibi-la em nenhum dos grupos (Task_Nova ou Task_Com_Acordo) de qualquer apresentação da Lista_de_Acordos.
3. QUANDO uma Task é removida da Lista_de_Acordos por conclusão, O Sistema DEVE manter essa Task e todo o seu histórico de Acordos armazenados e disponíveis para consulta, ainda que ela não seja mais exibida na Lista_de_Acordos.

### Requisito 7: Histórico de Acordos por Task

**User Story:** Como membro do time, eu quero consultar o histórico de acordos de uma task, para que eu possa entender sua evolução ao longo do tempo.

#### Critérios de Aceitação

1. QUANDO um Usuário solicita o histórico de uma Task existente, O Sistema DEVE retornar todos os Acordos já registrados para essa Task, incluindo o Acordo_Atual quando houver, ordenados pela data de registro do mais antigo para o mais recente.
2. QUANDO o Sistema retorna o histórico de uma Task, O Sistema DEVE incluir, para cada Acordo, o Tipo_de_Acordo, o Responsável registrado no momento do Acordo quando houver, a data de registro e o estado de cumprimento.
3. QUANDO um Acordo é substituído por um novo Acordo, O Sistema DEVE preservar o Acordo anterior no histórico da Task.
4. QUANDO um Usuário solicita o histórico de uma Task que não possui nenhum Acordo registrado, O Sistema DEVE retornar uma lista vazia.
5. SE um Usuário solicita o histórico de uma Task que não existe no Sistema, ENTÃO O Sistema DEVE rejeitar a operação e informar que a Task não foi encontrada.
6. QUANDO o Responsável atual de uma Task muda ao registrar um novo Acordo, O Sistema DEVE manter inalterado o Responsável registrado nos Acordos anteriores dessa Task.

### Requisito 8: Classificação de Tasks na Lista de Acordos

**User Story:** Como time, eu quero visualizar as tasks classificadas por situação de acordo, para que eu saiba rapidamente quais precisam de um primeiro acordo e quais precisam de avaliação.

#### Critérios de Aceitação

1. O Sistema DEVE classificar cada Task que não tenha sido removida da Lista_de_Acordos (por conclusão do Acordo "Finalizar" ou por remoção manual do Usuário) exatamente em uma das seguintes categorias: Task_Nova ou Task_Com_Acordo.
2. QUANDO uma Task_Nova recebe seu primeiro Acordo, O Sistema DEVE reclassificá-la como Task_Com_Acordo antes de qualquer apresentação subsequente da Lista_de_Acordos, sem exigir ação adicional do Usuário.
3. ENQUANTO o Acordo_Atual de uma Task_Com_Acordo já tiver sido avaliado como cumprido ou não cumprido e ainda não tiver sido substituído por um novo Acordo, O Sistema DEVE manter essa Task classificada como Task_Com_Acordo.

### Requisito 9: Edição e Remoção Manual de Task

**User Story:** Como membro do time, eu quero editar ou remover uma task cadastrada incorretamente, para que a lista de acordos reflita apenas atividades válidas.

#### Critérios de Aceitação

1. QUANDO um Usuário edita o título de uma Task existente para um valor não vazio e com no máximo 200 caracteres, O Sistema DEVE atualizar o título dessa Task para o novo valor.
2. SE um Usuário tenta editar o título de uma Task para um valor vazio, composto somente por espaços em branco, ou com mais de 200 caracteres, ENTÃO O Sistema DEVE rejeitar a edição e manter o título anterior.
3. SE um Usuário tenta editar o título de uma Task cujo identificador não corresponde a nenhuma Task existente, ENTÃO O Sistema DEVE rejeitar a edição e informar que a Task não foi encontrada.
4. QUANDO um Usuário remove manualmente uma Task existente, O Sistema DEVE excluir permanentemente essa Task da Lista_de_Acordos e de qualquer consulta futura, incluindo todo o seu histórico de Acordos associado.
5. SE um Usuário tenta remover uma Task cujo identificador não corresponde a nenhuma Task existente, ENTÃO O Sistema DEVE rejeitar a remoção e informar que a Task não foi encontrada.
6. QUANDO um Usuário edita o Responsável de uma Task existente para um valor vazio ou para um Usuário_Cadastrado existente no Cadastro_de_Usuários, O Sistema DEVE atualizar o Responsável atual dessa Task para o novo valor, permitindo que o Responsável fique sem valor definido.
7. SE um Usuário tenta editar o Responsável de uma Task para um valor que não corresponda a nenhum Usuário_Cadastrado existente no Cadastro_de_Usuários e que não seja um valor vazio, ENTÃO O Sistema DEVE rejeitar a edição, exibir uma mensagem de erro indicando que o Responsável informado não está cadastrado e manter o Responsável anterior.

### Requisito 10: Cadastro de Tipos de Acordo

**User Story:** Como membro do time, eu quero gerenciar os tipos de acordo disponíveis, para que o fluxo de trabalho representado pelas etapas da daily possa ser adaptado conforme a necessidade do time.

#### Critérios de Aceitação

1. O Sistema DEVE inicializar o Cadastro_de_Tipos_de_Acordo com os valores "Avaliar e planejar", "Enviar para code review", "Enviar para review", "Enviar para deploy" e "Finalizar".
2. QUANDO um Usuário submete um novo Tipo_de_Acordo cujo título, após trim, esteja entre 1 e 100 caracteres e não coincida com nenhum valor já existente no Cadastro_de_Tipos_de_Acordo, sem diferenciar maiúsculas de minúsculas, O Sistema DEVE adicionar esse valor ao Cadastro_de_Tipos_de_Acordo.
3. SE um Usuário submete um novo Tipo_de_Acordo cujo título, após trim, seja uma string vazia, exceda 100 caracteres, ou já exista no Cadastro_de_Tipos_de_Acordo, sem diferenciar maiúsculas de minúsculas, ENTÃO O Sistema DEVE rejeitar a inclusão e informar o motivo da rejeição.
4. QUANDO o Cadastro_de_Tipos_de_Acordo é consultado, O Sistema DEVE retornar todos os valores atualmente cadastrados, incluindo os valores semeados e os adicionados posteriormente.
5. SE um Usuário tenta remover do Cadastro_de_Tipos_de_Acordo um Tipo_de_Acordo associado a algum Acordo já registrado no Sistema, ENTÃO O Sistema DEVE rejeitar a remoção e informar que o Tipo_de_Acordo está em uso.

### Requisito 11: Cadastro de Motivos de Não Cumprimento

**User Story:** Como membro do time, eu quero gerenciar os motivos de não cumprimento disponíveis, para que a avaliação de acordos reflita as causas reais observadas pelo time.

#### Critérios de Aceitação

1. O Sistema DEVE inicializar o Cadastro_de_Motivos_de_Nao_Cumprimento com os valores "Dependência externa", "Requisito não previsto", "Problema ambiente", "Falta de conhecimento negócio" e "Falta de conhecimento técnico".
2. QUANDO um Usuário submete um novo Motivo_de_Nao_Cumprimento cujo título, após trim, esteja entre 1 e 100 caracteres e não coincida com nenhum valor já existente no Cadastro_de_Motivos_de_Nao_Cumprimento, sem diferenciar maiúsculas de minúsculas, O Sistema DEVE adicionar esse valor ao Cadastro_de_Motivos_de_Nao_Cumprimento.
3. SE um Usuário submete um novo Motivo_de_Nao_Cumprimento cujo título, após trim, seja uma string vazia, exceda 100 caracteres, ou já exista no Cadastro_de_Motivos_de_Nao_Cumprimento, sem diferenciar maiúsculas de minúsculas, ENTÃO O Sistema DEVE rejeitar a inclusão e informar o motivo da rejeição.
4. QUANDO o Cadastro_de_Motivos_de_Nao_Cumprimento é consultado, O Sistema DEVE retornar todos os valores atualmente cadastrados, incluindo os valores semeados e os adicionados posteriormente.
5. SE um Usuário tenta remover do Cadastro_de_Motivos_de_Nao_Cumprimento um Motivo_de_Nao_Cumprimento associado a algum Acordo já registrado no Sistema, ENTÃO O Sistema DEVE rejeitar a remoção e informar que o motivo está em uso.

### Requisito 12: Cadastro em Lote de Tasks

**User Story:** Como membro do time, eu quero colar uma lista de linhas para cadastrar várias tasks de uma só vez, para que eu não precise cadastrar cada task manualmente antes da daily.

#### Critérios de Aceitação

1. QUANDO um Usuário submete um bloco de texto contendo uma ou mais linhas para cadastro em lote, O Sistema DEVE processar cada linha como o cadastro de uma Task distinta, na mesma ordem em que as linhas aparecem no bloco de texto.
2. QUANDO uma linha do bloco de texto contém o caractere ";", O Sistema DEVE interpretar a parte da linha anterior ao ";" como o título da Task e a parte posterior ao ";", após trim, como o Tipo_de_Acordo a ser registrado para essa Task.
3. QUANDO uma linha do bloco de texto não contém o caractere ";", O Sistema DEVE interpretar a linha inteira, após trim, como o título da Task e criar essa Task sem nenhum Acordo, classificando-a como Task_Nova.
4. O Sistema DEVE validar o título de cada linha do cadastro em lote de acordo com os mesmos limites de comprimento definidos no Requisito 1 (entre 1 e 200 caracteres após trim).
5. SE o título de uma linha do cadastro em lote, após trim, resultar em uma string vazia ou exceder 200 caracteres, ENTÃO O Sistema DEVE rejeitar o cadastro dessa linha específica, sem impedir o cadastro das demais linhas válidas do mesmo lote, e informar ao Usuário quais linhas foram rejeitadas e o motivo da rejeição.
6. SE o Tipo_de_Acordo informado após o ";" em uma linha não pertencer ao Cadastro_de_Tipos_de_Acordo, ENTÃO O Sistema DEVE rejeitar o cadastro dessa linha específica, sem impedir o cadastro das demais linhas válidas do mesmo lote, e informar ao Usuário quais linhas foram rejeitadas e o motivo da rejeição.
7. QUANDO uma Task é criada a partir do cadastro em lote com um Tipo_de_Acordo válido informado na linha correspondente, O Sistema DEVE registrar um Acordo com esse Tipo_de_Acordo para a Task, definir esse Acordo como o Acordo_Atual e classificar a Task como Task_Com_Acordo.
8. QUANDO Tasks são criadas por meio do cadastro em lote, O Sistema DEVE atribuir a cada uma delas uma Ordem_de_Exibição consistente com a ordem em que apareceram no bloco de texto, posicionando-as na Lista_de_Acordos de acordo com essa ordem.

### Requisito 13: Busca e Filtro de Tasks

**User Story:** Como membro do time, eu quero buscar tasks pelo título ou pelo responsável, para que eu encontre rapidamente uma task específica durante a daily.

#### Critérios de Aceitação

1. QUANDO um Usuário informa um termo de busca, O Sistema DEVE filtrar a Lista_de_Acordos exibindo apenas as Tasks cujo título contenha o termo informado, sem diferenciar letras maiúsculas de minúsculas.
2. QUANDO um Usuário informa um termo de busca, O Sistema DEVE filtrar a Lista_de_Acordos exibindo também as Tasks cujo Responsável atual, identificado pelo nome/login do Usuário_Cadastrado correspondente no Cadastro_de_Usuários, contenha o termo informado, sem diferenciar letras maiúsculas de minúsculas.
3. SE nenhuma Task corresponder ao termo de busca informado, ENTÃO O Sistema DEVE exibir a Lista_de_Acordos vazia, com uma indicação de que nenhuma Task foi encontrada.
4. QUANDO o termo de busca é removido ou limpo pelo Usuário, O Sistema DEVE voltar a exibir todas as Tasks na Lista_de_Acordos, respeitando a classificação em Task_Nova/Task_Com_Acordo e a Ordem_de_Exibição vigentes.

### Requisito 14: Reordenação Manual de Tasks

**User Story:** Como membro do time, eu quero reordenar manualmente as tasks na lista de acordos, para que a ordem de apresentação da daily reflita a prioridade definida pelo time.

#### Critérios de Aceitação

1. QUANDO um Usuário arrasta uma Task para uma nova posição dentro da Lista_de_Acordos e solta, O Sistema DEVE atualizar a Ordem_de_Exibição dessa Task e das demais Tasks afetadas para refletir a nova posição.
2. QUANDO a Ordem_de_Exibição de uma Task é atualizada por reordenação manual, O Sistema DEVE persistir essa ordem para todas as apresentações futuras da Lista_de_Acordos, até que uma nova reordenação manual, um novo cadastro em lote, ou a remoção da Task ocorra.
3. SE um Usuário tenta reordenar uma Task cujo identificador não corresponde a nenhuma Task existente, ENTÃO O Sistema DEVE rejeitar a reordenação e informar que a Task não foi encontrada.

### Requisito 15: Cadastro de Usuários

**User Story:** Como membro do time, eu quero cadastrar usuários no Sistema, para que eles possam ser selecionados como Responsável nas tasks.

#### Critérios de Aceitação

1. O Sistema DEVE inicializar o Cadastro_de_Usuários com um Usuário_Cadastrado semeado, disponível desde a inicialização do Sistema, de modo que o Sistema seja utilizável imediatamente sem exigir um cadastro prévio de usuários.
2. QUANDO um Usuário submete um novo Usuário_Cadastrado cujo nome/login, após trim, esteja entre 1 e 100 caracteres e não coincida com nenhum valor já existente no Cadastro_de_Usuários, sem diferenciar maiúsculas de minúsculas, O Sistema DEVE adicionar esse valor ao Cadastro_de_Usuários.
3. SE um Usuário submete um novo Usuário_Cadastrado cujo nome/login, após trim, seja uma string vazia, ENTÃO O Sistema DEVE rejeitar a inclusão e exibir uma mensagem de erro indicando que o nome/login é obrigatório.
4. SE um Usuário submete um novo Usuário_Cadastrado cujo nome/login, após trim, exceda 100 caracteres, ENTÃO O Sistema DEVE rejeitar a inclusão e exibir uma mensagem de erro indicando que o nome/login excede o limite máximo de 100 caracteres.
5. SE um Usuário submete um novo Usuário_Cadastrado cujo nome/login, após trim, já exista no Cadastro_de_Usuários, sem diferenciar maiúsculas de minúsculas, ENTÃO O Sistema DEVE rejeitar a inclusão e exibir uma mensagem de erro indicando que o nome/login já está cadastrado.
6. QUANDO o Cadastro_de_Usuários é consultado, O Sistema DEVE retornar todos os Usuário_Cadastrado atualmente cadastrados, incluindo o Usuário_Cadastrado semeado e os adicionados posteriormente.
7. O Cadastro_de_Usuários DEVE armazenar, para cada Usuário_Cadastrado, apenas informação identificadora (como nome/login), sem incluir senha, tela de login, sessão de usuário ou qualquer mecanismo de controle de acesso, sendo autenticação e autorização um escopo explicitamente adiado para uma fase futura, fora do escopo deste MVP.
8. SE um Usuário tenta remover do Cadastro_de_Usuários um Usuário_Cadastrado referenciado como Responsável de alguma Task existente no Sistema, ENTÃO O Sistema DEVE rejeitar a remoção e informar que o Usuário_Cadastrado está em uso.
