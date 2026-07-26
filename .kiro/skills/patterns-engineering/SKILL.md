---
inclusion: always
name: patterns-engineering
description: "Use esta skill para implementar tarefas no backend e frontend seguindo boas práticas de padrões de projeto, padrões de arquitetura, clean code e SOLID"
---

# Skill: Diretrizes Profissionais para Geração, Revisão e Refatoração de Código

## Descrição

Esta skill define um conjunto padronizado de diretrizes de engenharia de software para apoiar o Microsoft 365 Copilot na geração, revisão, refatoração e avaliação técnica de código em projetos Backend e Frontend.

A skill é neutra em relação à linguagem de programação e aplicável a ecossistemas como C#, Java, TypeScript, JavaScript, Python, Go e Kotlin, além de frameworks modernos de Backend e Frontend.

---

## 1. Objetivo da Skill

### 1.1 Propósito

Orientar o Copilot a produzir análises, recomendações e implementações com alto padrão técnico, priorizando:

- Clean Code.
- SOLID.
- Design Patterns com uso pragmático.
- Domain Driven Design quando aplicável.
- Arquitetura Hexagonal e Clean Architecture.
- Testabilidade.
- Observabilidade.
- Segurança de aplicações.
- Performance sustentável.
- Manutenibilidade e evolução contínua.

### 1.2 Escopo

Esta skill deve ser utilizada para:

- Geração de código Backend e Frontend.
- Revisão de Pull Requests.
- Refatoração de código legado.
- Avaliação arquitetural de implementações.
- Definição de padrões de projeto.
- Análise de riscos técnicos.
- Sugestão de melhorias de segurança, performance e qualidade.
- Apoio à construção de APIs, componentes, serviços, módulos, testes e integrações.

### 1.3 Benefícios Esperados

A aplicação desta skill deve contribuir para:

- Código mais legível e fácil de entender.
- Redução de acoplamento e duplicação.
- Maior testabilidade.
- Melhor separação de responsabilidades.
- Menor risco de regressões.
- Melhor experiência de manutenção.
- Decisões arquiteturais mais conscientes.
- Uso adequado de padrões de projeto.
- Maior segurança e robustez das aplicações.
- Melhor rastreabilidade em produção.

### 1.4 Situações de Uso

Utilize esta skill quando o Copilot for solicitado a:

- Criar uma funcionalidade nova.
- Revisar código existente.
- Melhorar a qualidade de uma implementação.
- Refatorar classes, serviços, componentes ou módulos.
- Avaliar a aderência a SOLID, Clean Code ou arquitetura.
- Sugerir Design Patterns.
- Avaliar APIs, persistência, testes, logs, segurança ou performance.
- Identificar anti-patterns.
- Criar checklists técnicos.
- Apoiar decisões de arquitetura Backend ou Frontend.

---

## 2. Princípios Fundamentais

## 2.1 Clean Code

### 2.1.1 Nomenclatura

#### Regras

- Use nomes claros, específicos e orientados ao domínio.
- Evite abreviações obscuras.
- Prefira nomes que revelem intenção.
- Use verbos para métodos/funções e substantivos para entidades, objetos ou componentes.
- Evite nomes genéricos como `data`, `item`, `obj`, `manager`, `helper` ou `processor` sem contexto claro.

#### Exemplo correto

```pseudo
calculateInvoiceTotal(invoice)
findActiveCustomersByCompany(companyId)
createRecruitmentRequest(command)
```

#### Exemplo incorreto

```pseudo
calc(x)
doStuff(data)
process(obj)
```

---

### 2.1.2 Legibilidade

#### Regras

- O código deve ser compreensível sem depender excessivamente de comentários.
- Comentários devem explicar decisões, restrições ou contexto, não o óbvio.
- Prefira expressões simples a encadeamentos complexos.
- Evite blocos longos e aninhamentos profundos.
- Extraia métodos menores quando uma operação tiver múltiplas intenções.

#### Exemplo correto

```pseudo
if customer.isEligibleForDiscount():
    applyDiscount(order, customer)
```

#### Exemplo incorreto

```pseudo
if customer.status == "ACTIVE" and customer.orders > 10 and customer.blocked == false and order.total > 100:
    order.total = order.total * 0.9
```

---

### 2.1.3 Simplicidade

#### Regras

- Priorize a solução mais simples que resolva corretamente o problema.
- Evite abstrações prematuras.
- Não introduza Design Patterns sem necessidade real.
- Reduza complexidade acidental.
- Prefira código explícito e direto quando a flexibilidade futura não estiver justificada.

#### Diretriz

> Simplicidade não significa código ingênuo. Significa remover complexidade que não agrega valor ao domínio, ao produto ou à operação.

---

### 2.1.4 Responsabilidade Única

#### Regras

- Cada classe, função, componente ou módulo deve ter um motivo claro para existir.
- Evite misturar regra de negócio, acesso a dados, apresentação, validação, logging e orquestração no mesmo bloco.
- Separe responsabilidades por intenção, não apenas por tipo técnico.

#### Exemplo correto

```pseudo
OrderService -> coordena caso de uso
OrderRepository -> persiste dados
OrderValidator -> valida entrada
OrderPolicy -> aplica regra de negócio
```

#### Exemplo incorreto

```pseudo
OrderController -> valida entrada, calcula imposto, salva no banco, envia e-mail e formata resposta HTTP
```

---

### 2.1.5 Eliminação de Duplicação

#### Regras

- Elimine duplicações de lógica de negócio.
- Centralize regras recorrentes em políticas, serviços de domínio, hooks, utilitários ou componentes reutilizáveis.
- Evite duplicação por cópia e cola.
- Não extraia abstrações apenas porque duas estruturas parecem semelhantes; confirme se elas possuem a mesma razão de mudança.

#### Diretriz

> Duplicação de lógica de negócio é mais perigosa do que duplicação estrutural superficial.

---

### 2.1.6 Modularização

#### Regras

- Organize código em módulos coesos.
- Cada módulo deve representar uma capacidade técnica ou de negócio clara.
- Evite módulos genéricos excessivos como `common`, `shared` ou `utils` sem critérios.
- Defina fronteiras explícitas entre módulos.
- Minimize dependências cruzadas.

---

### 2.1.7 Coesão

#### Regras

- Elementos dentro do mesmo módulo devem mudar pelos mesmos motivos.
- Mantenha regras relacionadas próximas entre si.
- Evite classes ou componentes que agrupam responsabilidades não relacionadas.

---

### 2.1.8 Baixo Acoplamento

#### Regras

- Dependa de abstrações quando houver variação real de implementação.
- Evite dependências diretas entre camadas inadequadas.
- Use interfaces, contratos, portas ou adaptadores quando a dependência externa puder mudar.
- Evite que detalhes de infraestrutura contaminem regras de negócio.

---

## 2.2 SOLID

## 2.2.1 SRP — Single Responsibility Principle

### Descrição

Uma unidade de código deve ter apenas uma razão para mudar.

### Aplicação Prática

- Separe validação, regra de negócio, persistência, apresentação e integração.
- Evite classes ou componentes que concentram várias responsabilidades.
- Em Frontend, evite componentes que buscam dados, mantêm estado complexo, aplicam regra de negócio e renderizam múltiplas seções não relacionadas.

### Exemplo correto

```pseudo
class CreateOrderUseCase:
    def execute(command):
        order = orderFactory.create(command)
        orderRepository.save(order)
        return order
```

### Exemplo incorreto

```pseudo
class OrderController:
    def create(request):
        validate(request)
        calculateTaxes(request)
        saveToDatabase(request)
        sendEmail(request)
        return httpResponse(request)
```

---

## 2.2.2 OCP — Open/Closed Principle

### Descrição

Entidades de software devem estar abertas para extensão e fechadas para modificação.

### Aplicação Prática

- Use polimorfismo, Strategy, configuração ou composição quando novas variações forem frequentes.
- Evite alterar blocos condicionais grandes sempre que surgir uma nova regra.
- Aplique OCP quando houver variabilidade real e recorrente.

### Exemplo correto

```pseudo
interface DiscountStrategy:
    calculate(order)

class LoyaltyDiscountStrategy implements DiscountStrategy:
    calculate(order):
        return order.total * 0.10

class SeasonalDiscountStrategy implements DiscountStrategy:
    calculate(order):
        return order.total * 0.15
```

### Exemplo incorreto

```pseudo
function calculateDiscount(order, type):
    if type == "LOYALTY":
        return order.total * 0.10
    if type == "SEASONAL":
        return order.total * 0.15
    if type == "PARTNER":
        return order.total * 0.20
```

---

## 2.2.3 LSP — Liskov Substitution Principle

### Descrição

Subtipos devem poder substituir seus tipos base sem quebrar o comportamento esperado.

### Aplicação Prática

- Não crie subclasses que invalidam contratos da classe base.
- Evite sobrescrever métodos com comportamentos incompatíveis.
- Prefira composição quando a relação “é um” não for verdadeira.

### Exemplo correto

```pseudo
interface PaymentMethod:
    pay(amount)

class CreditCardPayment implements PaymentMethod:
    pay(amount):
        authorizeAndCapture(amount)

class PixPayment implements PaymentMethod:
    pay(amount):
        generateInstantPayment(amount)
```

### Exemplo incorreto

```pseudo
class ReadOnlyRepository extends Repository:
    save(entity):
        throw UnsupportedOperationException()
```

---

## 2.2.4 ISP — Interface Segregation Principle

### Descrição

Clientes não devem depender de interfaces que não utilizam.

### Aplicação Prática

- Crie interfaces pequenas e específicas.
- Evite contratos genéricos com muitos métodos.
- Separe capacidades de leitura, escrita, notificação, exportação ou processamento quando necessário.

### Exemplo correto

```pseudo
interface CustomerReader:
    findById(id)

interface CustomerWriter:
    save(customer)
```

### Exemplo incorreto

```pseudo
interface CustomerRepository:
    findById(id)
    save(customer)
    delete(id)
    exportToCsv()
    sendNotification()
    generateReport()
```

---

## 2.2.5 DIP — Dependency Inversion Principle

### Descrição

Módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de abstrações.

### Aplicação Prática

- Casos de uso devem depender de contratos, não de frameworks, bancos de dados ou clientes HTTP concretos.
- Infraestrutura deve implementar portas definidas pela aplicação ou domínio.
- Use injeção de dependência quando isso aumentar testabilidade e flexibilidade.

### Exemplo correto

```pseudo
class CreateCustomerUseCase:
    def __init__(self, customerRepository: CustomerRepository):
        self.customerRepository = customerRepository
```

### Exemplo incorreto

```pseudo
class CreateCustomerUseCase:
    def __init__(self):
        self.customerRepository = SqlCustomerRepository()
```

---

# 3. Design Patterns

## 3.1 Diretrizes Gerais

Design Patterns devem ser usados para resolver problemas recorrentes com clareza, não para demonstrar sofisticação técnica.

### Regras

- Recomende um padrão somente quando ele resolver um problema real.
- Evite aplicar padrões por antecipação sem evidência de variação, complexidade ou repetição.
- Prefira composição a herança quando possível.
- Explique o trade-off do padrão recomendado.
- Se uma solução simples for suficiente, não introduza padrão adicional.

---

## 3.2 Padrões de Criação

### 3.2.1 Factory Method

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando a criação de objetos variar conforme tipo, contexto, configuração ou regra de negócio. |
| Quando evitar | Quando a criação for simples, direta e sem variações relevantes. |
| Benefícios | Centraliza criação, reduz acoplamento e melhora extensibilidade. |
| Riscos de uso incorreto | Criar fábricas desnecessárias e aumentar complexidade sem ganho real. |

#### Exemplo

```pseudo
class PaymentFactory:
    create(type):
        if type == "CARD": return CardPayment()
        if type == "PIX": return PixPayment()
```

---

### 3.2.2 Abstract Factory

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando famílias de objetos relacionados precisam ser criadas de forma consistente. |
| Quando evitar | Quando existe apenas um produto ou poucas variações independentes. |
| Benefícios | Garante compatibilidade entre objetos da mesma família. |
| Riscos de uso incorreto | Hierarquias artificiais e excesso de interfaces. |

---

### 3.2.3 Builder

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando a construção de um objeto envolve muitos parâmetros, etapas ou configurações opcionais. |
| Quando evitar | Quando o objeto é simples ou possui poucos atributos obrigatórios. |
| Benefícios | Aumenta legibilidade e evita construtores extensos. |
| Riscos de uso incorreto | Criar builders para objetos triviais. |

#### Exemplo

```pseudo
OrderBuilder()
    .withCustomer(customer)
    .withItems(items)
    .withDiscount(discount)
    .build()
```

---

### 3.2.4 Singleton

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando deve existir uma única instância compartilhada e controlada, como configuração imutável ou registrador. |
| Quando evitar | Quando introduz estado global mutável, dificulta testes ou cria acoplamento oculto. |
| Benefícios | Controla ciclo de vida de instância única. |
| Riscos de uso incorreto | Estado global, baixa testabilidade, concorrência problemática e dependências implícitas. |

#### Ressalva

> Prefira injeção de dependência e gerenciamento de ciclo de vida pelo container/framework sempre que possível.

---

## 3.3 Padrões Estruturais

### 3.3.1 Adapter

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando uma interface externa ou legado precisa ser compatibilizada com o contrato interno da aplicação. |
| Quando evitar | Quando os contratos já são compatíveis ou a adaptação não agrega isolamento. |
| Benefícios | Isola dependências externas e reduz impacto de mudanças. |
| Riscos de uso incorreto | Adaptadores que vazam detalhes externos para o domínio. |

---

### 3.3.2 Facade

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando há subsistemas complexos que precisam ser expostos por uma interface simples. |
| Quando evitar | Quando a fachada apenas repassa chamadas sem simplificar nada. |
| Benefícios | Reduz complexidade para clientes e centraliza orquestração. |
| Riscos de uso incorreto | Transformar a fachada em God Class. |

---

### 3.3.3 Decorator

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando comportamentos adicionais precisam ser combinados dinamicamente sem alterar a classe original. |
| Quando evitar | Quando uma simples composição ou configuração resolve o problema. |
| Benefícios | Promove extensão flexível por composição. |
| Riscos de uso incorreto | Cadeias difíceis de depurar e excesso de indireção. |

---

### 3.3.4 Proxy

| Critério | Diretriz |
|---|---|
| Quando utilizar | Para controlar acesso, cache, lazy loading, segurança, tracing ou comunicação remota. |
| Quando evitar | Quando não há necessidade de intermediação. |
| Benefícios | Adiciona controle sem alterar o objeto real. |
| Riscos de uso incorreto | Ocultar custo de chamadas remotas ou efeitos colaterais. |

---

## 3.4 Padrões Comportamentais

### 3.4.1 Strategy

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando existem algoritmos ou regras intercambiáveis. |
| Quando evitar | Quando há apenas uma variação ou regras simples e estáveis. |
| Benefícios | Reduz condicionais e melhora extensibilidade. |
| Riscos de uso incorreto | Criar muitas classes para regras triviais. |

---

### 3.4.2 Observer

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando múltiplos interessados precisam reagir a eventos sem acoplamento direto. |
| Quando evitar | Quando o fluxo precisa ser estritamente síncrono, simples e explícito. |
| Benefícios | Desacopla emissores e consumidores. |
| Riscos de uso incorreto | Fluxos difíceis de rastrear e efeitos colaterais inesperados. |

---

### 3.4.3 Command

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando uma ação precisa ser encapsulada, enfileirada, auditada, desfeita ou reexecutada. |
| Quando evitar | Quando uma chamada direta é suficiente. |
| Benefícios | Facilita histórico, filas, auditoria e extensibilidade. |
| Riscos de uso incorreto | Verbosidade excessiva e abstração desnecessária. |

---

### 3.4.4 Mediator

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando múltiplos objetos ou componentes interagem de forma complexa e precisam de coordenação central. |
| Quando evitar | Quando a comunicação direta é simples e clara. |
| Benefícios | Reduz dependências muitos-para-muitos. |
| Riscos de uso incorreto | Mediador virar ponto central de regra de negócio excessiva. |

---

### 3.4.5 State

| Critério | Diretriz |
|---|---|
| Quando utilizar | Quando o comportamento de um objeto muda conforme seu estado interno. |
| Quando evitar | Quando os estados são poucos, simples e sem comportamento relevante. |
| Benefícios | Organiza transições e reduz condicionais complexas. |
| Riscos de uso incorreto | Criar múltiplas classes para fluxo simples. |

---

# 4. Regras para Backend

## 4.1 Arquitetura

### 4.1.1 Clean Architecture

#### Regras

- Separe domínio, aplicação, infraestrutura e interfaces externas.
- Regras de negócio não devem depender de frameworks.
- Casos de uso devem representar intenções do sistema.
- Controllers devem ser adaptadores de entrada, não locais de regra de negócio.
- Infraestrutura deve implementar contratos definidos por camadas internas.

#### Estrutura conceitual recomendada

```text
domain/
  entities/
  value-objects/
  domain-services/
  domain-events/
application/
  use-cases/
  ports/
  dtos/
infrastructure/
  persistence/
  messaging/
  http-clients/
interfaces/
  controllers/
  presenters/
```

---

### 4.1.2 Hexagonal Architecture

#### Regras

- Modele a aplicação por portas e adaptadores.
- Portas de entrada representam casos de uso disponíveis.
- Portas de saída representam dependências externas necessárias.
- Adaptadores conectam HTTP, filas, banco de dados, cache, arquivos ou serviços externos.
- O domínio não deve conhecer adaptadores concretos.

---

### 4.1.3 Domain Driven Design

#### Regras

- Use linguagem ubíqua alinhada ao negócio.
- Modele agregados com invariantes claras.
- Evite entidades anêmicas quando houver comportamento de domínio relevante.
- Use Value Objects para conceitos imutáveis e comparáveis por valor.
- Use Domain Services apenas quando a regra não pertencer naturalmente a uma entidade ou Value Object.
- Defina Bounded Contexts para evitar modelos ambíguos.

#### Quando aplicar DDD com maior profundidade

- Domínio complexo.
- Muitas regras de negócio.
- Alta necessidade de evolução.
- Ambiguidade de conceitos entre áreas.
- Integração entre contextos distintos.

#### Quando evitar excesso de DDD

- CRUD simples.
- Protótipos descartáveis.
- Domínio com baixa complexidade.
- Sistemas sem regras relevantes.

---

### 4.1.4 CQRS

#### Regras

- Considere CQRS quando leitura e escrita possuem modelos, performance ou escalabilidade diferentes.
- Separe comandos de consultas quando isso reduzir complexidade.
- Não aplique CQRS apenas por padrão arquitetural.
- Garanta consistência esperada quando houver modelos separados.

#### Quando utilizar

- Consultas complexas e otimizadas.
- Escritas com regras de negócio ricas.
- Necessidade de modelos de leitura específicos.
- Alta escala ou separação clara entre operações.

#### Quando evitar

- CRUD simples.
- Baixa complexidade.
- Equipe sem maturidade operacional para lidar com consistência eventual.

---

## 4.2 APIs

### 4.2.1 REST

#### Regras

- Use recursos claros e substantivos nas URLs.
- Use métodos HTTP corretamente.
- Retorne status codes apropriados.
- Evite expor detalhes internos no contrato público.
- Mantenha consistência de nomes, formatos e erros.

#### Exemplo

```http
GET /api/v1/customers/{customerId}/orders
POST /api/v1/orders
PATCH /api/v1/orders/{orderId}/status
```

---

### 4.2.2 Versionamento

#### Regras

- Versione APIs quando mudanças incompatíveis forem necessárias.
- Prefira versionamento explícito e previsível.
- Documente ciclo de depreciação.
- Evite quebrar consumidores sem plano de migração.

---

### 4.2.3 Contratos

#### Regras

- Defina contratos de entrada e saída claramente.
- Use DTOs para separar contrato externo do modelo interno.
- Documente campos obrigatórios, opcionais, formatos e exemplos.
- Evite retornar entidades de domínio diretamente.

---

### 4.2.4 Tratamento de Erros

#### Regras

- Retorne erros padronizados.
- Não exponha stack trace ou detalhes sensíveis ao cliente.
- Diferencie erros de validação, negócio, autenticação, autorização e falhas internas.
- Inclua identificador de correlação quando possível.

#### Exemplo de erro padronizado

```json
{
  "code": "ORDER_NOT_FOUND",
  "message": "Pedido não encontrado.",
  "correlationId": "b3f7c3f2-8b1e-4a7d-9f2a-0c2e6d2f9a11"
}
```

---

### 4.2.5 Validação

#### Regras

- Valide entrada na borda da aplicação.
- Reforce invariantes no domínio.
- Não confie em validações apenas no Frontend.
- Normalize e sanitize entradas quando necessário.
- Retorne mensagens claras e seguras.

---

### 4.2.6 Idempotência

#### Regras

- Implemente idempotência para operações críticas ou suscetíveis a retry.
- Use chaves idempotentes em operações de criação sensíveis.
- Garanta que reprocessamentos não gerem duplicidades indevidas.
- Documente endpoints idempotentes.

---

## 4.3 Persistência

### 4.3.1 Repository Pattern

#### Regras

- Use repositories para abstrair acesso a dados quando houver regra de domínio ou necessidade de isolamento.
- Evite repositories que apenas espelham operações CRUD do ORM sem ganho claro.
- Repositories devem trabalhar com agregados ou modelos adequados ao domínio.
- Não vaze detalhes do ORM para o domínio.

---

### 4.3.2 Unit of Work

#### Regras

- Use Unit of Work para coordenar transações envolvendo múltiplos repositórios ou operações.
- Garanta atomicidade quando várias alterações fizerem parte do mesmo caso de uso.
- Evite transações longas e desnecessárias.

---

### 4.3.3 Abstração de Acesso a Dados

#### Regras

- O domínio e os casos de uso não devem depender diretamente de banco de dados, ORM ou SDKs externos.
- Encapsule queries complexas em adaptadores apropriados.
- Separe modelos de escrita e leitura quando necessário.
- Controle migrations, índices e constraints como parte da evolução do sistema.

---

## 4.4 Logging

### 4.4.1 Logs Estruturados

#### Regras

- Use logs em formato estruturado sempre que possível.
- Inclua dados relevantes para diagnóstico.
- Não registre dados sensíveis, senhas, tokens ou informações pessoais desnecessárias.
- Use níveis adequados: debug, info, warn, error.

### 4.4.2 Correlação

#### Regras

- Propague correlation ID ou trace ID entre serviços.
- Inclua identificadores de requisição, usuário técnico ou tenant quando aplicável e seguro.
- Facilite rastreamento ponta a ponta.

### 4.4.3 Rastreabilidade

#### Regras

- Registre eventos importantes de negócio e falhas relevantes.
- Garanta observabilidade em integrações externas.
- Monitore latência, taxa de erro, throughput e disponibilidade.

---

## 4.5 Performance

### 4.5.1 Caching

#### Regras

- Use cache para dados frequentemente acessados e pouco voláteis.
- Defina TTL e estratégia de invalidação.
- Evite cachear dados sensíveis sem proteção adequada.
- Monitore taxa de acerto e impacto real.

### 4.5.2 Paginação

#### Regras

- Nunca retorne coleções potencialmente grandes sem paginação.
- Defina limites máximos de página.
- Considere cursor-based pagination para grandes volumes ou ordenações instáveis.

### 4.5.3 Consultas Eficientes

#### Regras

- Evite N+1 queries.
- Use índices adequados.
- Selecione apenas campos necessários.
- Analise planos de execução para consultas críticas.
- Evite carregar agregados ou relacionamentos desnecessários.

---

## 4.6 Segurança

### 4.6.1 Autenticação

#### Regras

- Use mecanismos robustos e padronizados.
- Não implemente criptografia ou autenticação caseira sem necessidade e conhecimento especializado.
- Proteja tokens e sessões.
- Aplique expiração e rotação quando apropriado.

### 4.6.2 Autorização

#### Regras

- Valide permissões no Backend.
- Aplique princípio do menor privilégio.
- Verifique autorização em nível de recurso quando necessário.
- Não dependa apenas de ocultação de funcionalidades no Frontend.

### 4.6.3 Validação de Entrada

#### Regras

- Trate toda entrada externa como não confiável.
- Use validação positiva sempre que possível.
- Sanitize conteúdo quando aplicado em HTML, SQL, comandos ou integrações.

### 4.6.4 Proteção contra Vulnerabilidades Comuns

#### Regras

- Previna SQL Injection usando queries parametrizadas ou ORM corretamente configurado.
- Previna XSS escapando conteúdo e validando entradas.
- Previna CSRF quando usar cookies/sessões em navegadores.
- Proteja APIs contra brute force e abuso com rate limiting quando aplicável.
- Configure CORS de forma restritiva.
- Não exponha secrets em código, logs ou respostas.

---

# 5. Regras para Frontend

## 5.1 Componentização

### 5.1.1 Componentes Reutilizáveis

#### Regras

- Crie componentes pequenos, coesos e com responsabilidade clara.
- Separe componentes de apresentação de componentes de orquestração quando necessário.
- Extraia componentes reutilizáveis apenas quando houver reutilização real ou ganho claro de legibilidade.
- Evite componentes genéricos demais que acumulam muitas variações.

---

### 5.1.2 Composição sobre Herança

#### Regras

- Prefira composição de componentes a hierarquias rígidas.
- Use children, slots, render props ou composição equivalente conforme o framework.
- Evite herança para reutilização visual ou comportamental no Frontend.

---

## 5.2 Gerenciamento de Estado

### 5.2.1 Estado Local

#### Regras

- Mantenha estado o mais próximo possível de onde é usado.
- Use estado local para interações simples e isoladas.
- Evite promover estado para global sem necessidade.

### 5.2.2 Estado Global

#### Regras

- Use estado global apenas para informações compartilhadas entre múltiplas áreas da aplicação.
- Separe estado de UI, estado de sessão, cache de servidor e regras de negócio.
- Evite transformar store global em banco de dados informal do Frontend.

### 5.2.3 Separação de Responsabilidades

#### Regras

- Separe busca de dados, transformação, regra de exibição e renderização.
- Encapsule chamadas remotas em services, hooks, queries ou adapters.
- Evite componentes que contenham lógica extensa de negócio.

---

## 5.3 Estrutura de Projeto

### 5.3.1 Organização por Domínio

#### Regras

- Prefira organização por domínio ou feature em aplicações médias e grandes.
- Mantenha arquivos relacionados próximos.
- Separe componentes compartilhados de componentes específicos do domínio.

#### Estrutura conceitual recomendada

```text
src/
  app/
  shared/
    components/
    hooks/
    utils/
  domains/
    customers/
      components/
      services/
      hooks/
      pages/
      types/
```

---

### 5.3.2 Modularização

#### Regras

- Cada módulo deve ter uma API pública clara.
- Evite imports profundos entre domínios.
- Não permita dependências circulares.
- Padronize boundaries entre módulos.

### 5.3.3 Escalabilidade

#### Regras

- Defina convenções consistentes para nomes, pastas, estilos e testes.
- Minimize acoplamento entre páginas, componentes e serviços.
- Organize rotas, layouts e carregamento de dados de forma previsível.

---

## 5.4 Performance

### 5.4.1 Lazy Loading

#### Regras

- Use lazy loading para rotas, módulos pesados e componentes raramente acessados.
- Evite carregar bibliotecas grandes no bundle inicial sem necessidade.
- Monitore impacto no tempo de carregamento.

### 5.4.2 Memoização

#### Regras

- Use memoização para cálculos caros ou renderizações frequentes.
- Não aplique memoização indiscriminadamente.
- Valide se a otimização reduz trabalho real.

### 5.4.3 Renderização Eficiente

#### Regras

- Evite re-renderizações desnecessárias.
- Use chaves estáveis em listas.
- Divida componentes grandes.
- Evite criar funções, objetos ou arrays complexos repetidamente em renderizações críticas quando isso causar impacto mensurável.

---

## 5.5 Acessibilidade

### 5.5.1 WCAG

#### Regras

- Busque conformidade com WCAG em critérios aplicáveis.
- Garanta contraste adequado.
- Forneça alternativas textuais para elementos não textuais.
- Não dependa apenas de cor para transmitir informação.

### 5.5.2 Semântica HTML

#### Regras

- Use elementos semânticos apropriados.
- Prefira botões reais para ações e links reais para navegação.
- Use labels associados a campos de formulário.
- Estruture headings de forma hierárquica.

### 5.5.3 Navegação por Teclado

#### Regras

- Todos os elementos interativos devem ser acessíveis por teclado.
- Preserve indicação visual de foco.
- Garanta ordem lógica de tabulação.
- Evite armadilhas de foco em modais ou overlays.

---

## 5.6 Segurança

### 5.6.1 Proteção contra XSS

#### Regras

- Evite renderizar HTML bruto.
- Sanitize conteúdo quando HTML dinâmico for inevitável.
- Escape dados vindos de usuários ou fontes externas.
- Use mecanismos seguros do framework.

### 5.6.2 Validações

#### Regras

- Validações no Frontend melhoram experiência, mas não substituem validações no Backend.
- Mensagens devem ser claras e não revelar detalhes sensíveis.
- Normalize entradas antes de enviar quando necessário.

### 5.6.3 Tratamento Seguro de Dados

#### Regras

- Não armazene tokens sensíveis de forma insegura.
- Evite expor dados internos no estado global ou logs do navegador.
- Não inclua secrets em bundles Frontend.
- Trate permissões como responsabilidade do Backend, ainda que o Frontend controle a experiência visual.

---

# 6. Regras de Testes

## 6.1 Backend

### 6.1.1 Testes Unitários

#### Regras

- Teste regras de negócio isoladamente.
- Priorize casos de uso, entidades, Value Objects, policies e services críticos.
- Use mocks/fakes para dependências externas.
- Testes devem ser determinísticos e rápidos.

### 6.1.2 Testes de Integração

#### Regras

- Teste integração com banco de dados, filas, cache e serviços externos simulados quando relevante.
- Valide transações, queries, migrations e serialização.
- Use ambiente controlado e dados previsíveis.

### 6.1.3 Testes de Contrato

#### Regras

- Use testes de contrato para APIs consumidas por outros sistemas.
- Valide compatibilidade de payloads, status codes e campos obrigatórios.
- Proteja consumidores contra mudanças incompatíveis.

---

## 6.2 Frontend

### 6.2.1 Testes Unitários

#### Regras

- Teste funções puras, formatadores, validadores, hooks e regras isoladas.
- Evite testar detalhes internos irrelevantes.
- Prefira testes orientados ao comportamento.

### 6.2.2 Testes de Componentes

#### Regras

- Teste renderização, interação e estados visuais importantes.
- Priorize acessibilidade nas queries de teste.
- Teste estados de carregamento, erro, vazio e sucesso.

### 6.2.3 Testes End-to-End

#### Regras

- Cubra fluxos críticos do usuário.
- Mantenha poucos testes E2E, focados em jornadas de alto valor.
- Evite dependência de dados instáveis.
- Use mocks controlados quando integrações externas forem instáveis.

---

## 6.3 Métricas Recomendadas

| Métrica | Recomendação |
|---|---|
| Cobertura unitária em domínio/casos de uso críticos | Alta prioridade; idealmente acima de 80%, ajustada ao contexto. |
| Cobertura global | Deve ser acompanhada, mas não usada isoladamente como indicador de qualidade. |
| Testes de contrato para APIs públicas | Obrigatórios quando há consumidores externos ou múltiplos times. |
| Testes E2E | Cobrir fluxos críticos, evitando excesso e fragilidade. |
| Mutation testing | Recomendado para módulos críticos quando disponível. |
| Tempo de execução da suíte | Deve permanecer adequado ao ciclo de desenvolvimento e CI/CD. |
| Flakiness | Testes instáveis devem ser corrigidos ou removidos temporariamente com justificativa. |

---

# 7. Code Review Checklist

## 7.1 Clean Code

- [ ] Os nomes revelam intenção?
- [ ] O código é legível sem comentários excessivos?
- [ ] Há funções, classes ou componentes grandes demais?
- [ ] Existe duplicação de lógica de negócio?
- [ ] As responsabilidades estão bem separadas?
- [ ] O código evita complexidade desnecessária?

## 7.2 SOLID

- [ ] Cada unidade possui uma responsabilidade clara?
- [ ] Novas variações podem ser adicionadas sem modificar excessivamente código existente?
- [ ] Subtipos respeitam os contratos esperados?
- [ ] Interfaces são pequenas e específicas?
- [ ] Dependências apontam para abstrações quando apropriado?

## 7.3 Arquitetura

- [ ] A regra de negócio está protegida de detalhes de infraestrutura?
- [ ] Controllers, componentes ou handlers estão livres de regra de negócio indevida?
- [ ] As fronteiras entre módulos estão claras?
- [ ] Há dependências circulares?
- [ ] A solução evita overengineering?

## 7.4 Segurança

- [ ] Entradas externas são validadas?
- [ ] Há proteção contra injeção, XSS, CSRF ou abuso conforme o contexto?
- [ ] Dados sensíveis não aparecem em logs, código ou respostas?
- [ ] Autorização é validada no Backend?
- [ ] Configurações de CORS, tokens e sessões são seguras?

## 7.5 Performance

- [ ] Consultas são eficientes?
- [ ] Há paginação em listas grandes?
- [ ] Existe risco de N+1 queries?
- [ ] Bundles Frontend foram avaliados quando necessário?
- [ ] Existem renderizações ou cálculos desnecessários?
- [ ] Cache possui estratégia de invalidação?

## 7.6 Testes

- [ ] Regras críticas possuem testes?
- [ ] Testes cobrem cenários de sucesso, erro e borda?
- [ ] Testes são determinísticos?
- [ ] Há testes de contrato quando necessário?
- [ ] Fluxos críticos possuem cobertura E2E ou equivalente?

## 7.7 Observabilidade

- [ ] Logs são estruturados?
- [ ] Existe correlation ID ou trace ID onde aplicável?
- [ ] Erros relevantes são rastreáveis?
- [ ] Métricas e eventos críticos são monitoráveis?

## 7.8 Documentação

- [ ] Decisões arquiteturais relevantes estão documentadas?
- [ ] Contratos de API estão claros?
- [ ] Configurações e variáveis de ambiente estão descritas?
- [ ] Há instruções de execução, teste e troubleshooting?

---

# 8. Anti-Patterns

## 8.1 Backend

### 8.1.1 God Class

#### Problema

Classe concentra múltiplas responsabilidades, regras, integrações e decisões.

#### Impacto

- Baixa testabilidade.
- Alto acoplamento.
- Dificuldade de manutenção.
- Maior risco de regressão.

#### Alternativa Recomendada

- Separar por casos de uso, serviços de domínio, policies, repositories e adapters.
- Aplicar SRP e composição.

---

### 8.1.2 Anemic Domain Model

#### Problema

Entidades possuem apenas dados, enquanto toda regra de negócio fica em services externos.

#### Impacto

- Regras espalhadas.
- Baixa expressividade do domínio.
- Invariantes frágeis.
- Dificuldade de evolução.

#### Alternativa Recomendada

- Encapsular comportamentos e invariantes nas entidades e Value Objects quando fizer sentido.
- Usar Domain Services apenas para regras que não pertencem naturalmente a uma entidade.

---

### 8.1.3 Circular Dependencies

#### Problema

Módulos dependem uns dos outros de forma cíclica.

#### Impacto

- Dificuldade de build e testes.
- Acoplamento elevado.
- Fronteiras arquiteturais frágeis.
- Alterações com efeito cascata.

#### Alternativa Recomendada

- Redefinir fronteiras de módulos.
- Extrair contratos compartilhados.
- Aplicar Dependency Inversion.
- Reorganizar dependências em direção única.

---

### 8.1.4 Business Logic em Controllers

#### Problema

Controllers executam regras de negócio, cálculos, validações complexas ou orquestrações indevidas.

#### Impacto

- Baixa reutilização.
- Testes mais difíceis.
- Acoplamento com HTTP ou framework.
- Duplicação em outros pontos de entrada.

#### Alternativa Recomendada

- Controllers devem adaptar entrada e saída.
- Regras devem ficar em casos de uso, domínio ou services apropriados.

---

## 8.2 Frontend

### 8.2.1 Componentes Gigantes

#### Problema

Componentes acumulam renderização, estado, chamadas remotas, validações, regras e múltiplas seções visuais.

#### Impacto

- Baixa legibilidade.
- Re-renderizações desnecessárias.
- Dificuldade de teste.
- Reutilização limitada.

#### Alternativa Recomendada

- Dividir em componentes menores.
- Extrair hooks, services e componentes de apresentação.
- Separar lógica de dados da renderização.

---

### 8.2.2 Prop Drilling Excessivo

#### Problema

Dados ou callbacks são repassados por várias camadas intermediárias sem uso local.

#### Impacto

- Acoplamento entre componentes.
- Dificuldade de refatoração.
- APIs de componentes poluídas.

#### Alternativa Recomendada

- Usar composição.
- Criar contexto limitado ao domínio ou seção.
- Utilizar store global apenas quando o compartilhamento justificar.

---

### 8.2.3 Estado Compartilhado Indevido

#### Problema

Estado local é promovido para global sem necessidade ou estado global mistura responsabilidades.

#### Impacto

- Re-renderizações amplas.
- Inconsistências.
- Dificuldade de rastrear alterações.
- Aumento de complexidade.

#### Alternativa Recomendada

- Manter estado próximo do uso.
- Separar server state, UI state e session state.
- Usar cache de dados apropriado para informações vindas do servidor.

---

### 8.2.4 Código Duplicado

#### Problema

Lógica, validações, chamadas remotas ou estruturas visuais são copiadas em múltiplos locais.

#### Impacto

- Correções inconsistentes.
- Maior custo de manutenção.
- Divergência de comportamento.

#### Alternativa Recomendada

- Extrair funções puras, hooks, services, componentes ou validadores compartilhados.
- Confirmar se a duplicação representa a mesma regra antes de abstrair.

---

# 9. Critérios de Qualidade

## 9.1 Regras Obrigatórias

- Código deve ser legível.
- Código deve ser testável.
- Código deve ser extensível.
- Código deve ser observável.
- Código deve ser seguro.
- Código deve ser de fácil manutenção.

## 9.2 Critérios Detalhados

| Critério | Regra |
|---|---|
| Legibilidade | O código deve revelar intenção por meio de nomes, estrutura e organização. |
| Testabilidade | Regras críticas devem poder ser testadas de forma isolada. |
| Extensibilidade | Mudanças previsíveis devem exigir o mínimo de alteração em código existente. |
| Observabilidade | Falhas e fluxos críticos devem ser rastreáveis por logs, métricas ou traces. |
| Segurança | Entradas, permissões, dados sensíveis e integrações devem ser tratados com cuidado. |
| Manutenção | O código deve permitir evolução com baixo risco e baixo custo cognitivo. |
| Simplicidade | A solução deve evitar abstrações, padrões ou camadas sem justificativa. |
| Coesão | Elementos relacionados devem permanecer próximos e mudar pelos mesmos motivos. |
| Baixo acoplamento | Dependências devem ser explícitas, controladas e orientadas a contratos quando necessário. |

---

# 10. Diretrizes para o Copilot

## 10.1 Guia de Uso pelo Copilot

Ao gerar, revisar ou refatorar código, o Copilot deve seguir estas instruções:

1. Aplicar Clean Code como critério base de qualidade.
2. Aplicar SOLID de forma pragmática, considerando o contexto real.
3. Recomendar Design Patterns apenas quando agregarem valor claro.
4. Evitar overengineering.
5. Priorizar simplicidade, clareza e manutenibilidade.
6. Garantir testabilidade das regras críticas.
7. Identificar riscos arquiteturais explícitos.
8. Sugerir melhorias de segurança quando houver exposição, validação fraca ou risco conhecido.
9. Sugerir melhorias de performance quando houver evidência de gargalos ou risco provável.
10. Explicar claramente cada recomendação, incluindo motivo, impacto e alternativa.
11. Diferenciar problemas críticos de melhorias opcionais.
12. Não assumir requisitos inexistentes.
13. Quando faltar contexto, sinalizar a lacuna de informação antes de propor mudanças invasivas.
14. Preservar comportamento existente durante refatorações, salvo quando solicitado o contrário.
15. Propor testes para validar mudanças relevantes.

---

## 10.2 Comportamento Esperado em Revisões de Código

Ao revisar código, o Copilot deve classificar achados por severidade:

| Severidade | Definição |
|---|---|
| Crítico | Pode causar falha grave, vulnerabilidade, perda de dados ou quebra funcional relevante. |
| Alto | Afeta arquitetura, segurança, performance ou manutenção de forma significativa. |
| Médio | Melhoria importante de qualidade, testabilidade ou clareza. |
| Baixo | Ajuste menor de estilo, nomenclatura ou organização. |
| Sugestão | Alternativa opcional com benefício potencial, mas sem necessidade imediata. |

Para cada achado, o Copilot deve fornecer:

- Local ou trecho impactado.
- Problema identificado.
- Impacto técnico.
- Recomendação objetiva.
- Exemplo de correção quando aplicável.

---

## 10.3 Comportamento Esperado em Geração de Código

Ao gerar código, o Copilot deve:

- Criar código simples antes de introduzir abstrações.
- Separar responsabilidades desde o início.
- Evitar dependência direta de infraestrutura dentro de regras de negócio.
- Incluir tratamento de erro consistente.
- Incluir validações necessárias.
- Sugerir testes relevantes.
- Explicar decisões arquiteturais importantes.
- Evitar frameworks, bibliotecas ou dependências sem necessidade explícita.

---

## 10.4 Comportamento Esperado em Refatoração

Ao refatorar código, o Copilot deve:

- Preservar comportamento funcional.
- Reduzir complexidade e duplicação.
- Melhorar nomes e organização.
- Separar responsabilidades.
- Aumentar testabilidade.
- Sugerir etapas incrementais quando a refatoração for grande.
- Indicar riscos de regressão.
- Recomendar testes antes e depois da alteração.

---

## 10.5 Regras de Decisão para Design Patterns

Antes de recomendar um Design Pattern, o Copilot deve responder internamente:

- Existe variação real de comportamento ou criação?
- Existe acoplamento que precisa ser reduzido?
- Existe duplicação de lógica que representa a mesma regra?
- O padrão tornará o código mais simples para o próximo mantenedor?
- O benefício supera o custo de abstração?

Se a resposta for negativa ou incerta, o Copilot deve preferir uma solução mais simples.

---

## 10.6 Regras de Segurança para Recomendações

O Copilot deve sempre verificar:

- Entradas não confiáveis.
- Autenticação e autorização.
- Exposição de dados sensíveis.
- Logs contendo informações indevidas.
- Riscos de injeção.
- XSS em interfaces.
- CSRF em aplicações baseadas em cookies.
- Configurações permissivas de CORS.
- Secrets em código, variáveis expostas ou bundles.

---

## 10.7 Regras de Performance para Recomendações

O Copilot deve sempre avaliar:

- Consultas sem paginação.
- N+1 queries.
- Falta de índices em filtros frequentes.
- Processamento síncrono pesado.
- Cache sem invalidação.
- Renderizações Frontend desnecessárias.
- Bundles grandes.
- Carregamento antecipado de recursos raramente usados.

---

## 10.8 Regras de Observabilidade para Recomendações

O Copilot deve verificar:

- Logs em pontos críticos.
- Correlação entre requisições.
- Tratamento adequado de exceções.
- Métricas de latência, erro e throughput.
- Rastreabilidade em integrações externas.
- Mensagens de erro úteis para diagnóstico sem vazamento de informação sensível.

---

## 10.9 Formato Recomendado de Resposta do Copilot em Revisões

```markdown
## Resumo da Avaliação

- Qualidade geral: [boa / atenção / crítica]
- Principais riscos: [...]
- Recomendação geral: [...]

## Achados

### [Severidade] Título do problema

- Local: ...
- Problema: ...
- Impacto: ...
- Recomendação: ...

## Testes Recomendados

- ...

## Conclusão

...
```

---

## 10.10 Formato Recomendado de Resposta do Copilot em Geração ou Refatoração

```markdown
## Solução Proposta

Descrição objetiva da abordagem.

## Código

Código gerado ou refatorado.

## Decisões Técnicas

- Decisão: ...
- Motivo: ...
- Trade-off: ...

## Testes Sugeridos

- ...

## Riscos e Cuidados

- ...
```

---

# Checklist Final da Skill

Antes de concluir qualquer recomendação, o Copilot deve validar:

- [ ] A solução é simples o suficiente para o problema?
- [ ] Há separação adequada de responsabilidades?
- [ ] O código é legível e expressivo?
- [ ] O uso de abstrações é justificado?
- [ ] SOLID foi aplicado de forma pragmática?
- [ ] Design Patterns foram evitados quando não agregam valor?
- [ ] A arquitetura protege regras de negócio?
- [ ] A implementação é testável?
- [ ] Há tratamento adequado de erros?
- [ ] Há validação de entradas?
- [ ] Há riscos de segurança tratados?
- [ ] Há riscos de performance avaliados?
- [ ] Há logs, métricas ou rastreabilidade quando aplicável?
- [ ] A documentação necessária foi considerada?
- [ ] O comportamento existente foi preservado em refatorações?
