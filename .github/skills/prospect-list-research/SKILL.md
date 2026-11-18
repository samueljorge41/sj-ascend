---
name: prospect-list-research
description: "Use when researching, qualifying, deduplicating, or registering new companies in the existing SJ Ascend Aquisição > Lista prospect list, including requests to create or fill a prospect list for a city or segment."
---

# Pesquisa e cadastro de listas de prospects

Use este procedimento para alimentar a lista de possíveis clientes existente no SJ Ascend. O objetivo é pesquisar e registrar empresas reais com potencial comercial, sem criar listas, páginas ou funcionalidades novas.

## Regras inegociáveis

- Trabalhe exclusivamente na lista existente em **Aquisição > Lista**.
- Não altere layout, componentes, regras de negócio, CRM ou kanban para realizar uma pesquisa ou cadastro.
- Preserve integralmente os registros existentes. Não edite, remova, aprove ou recuse registros preexistentes.
- Nunca cadastre uma empresa que já esteja na lista, seja qual for seu status (Pendente, Aprovado ou Recusado), nem que já exista no CRM/kanban, seja qual for sua etapa.
- Não invente nem infira dados factuais. Quando um dado não puder ser verificado, deixe o campo vazio.
- Use somente dados comerciais publicados para contato; não colete nem registre dados pessoais privados.
- Não altere automaticamente o status de nenhum prospect. Novos itens devem permanecer com o status padrão **Pendente**.
- Não crie campos. Confirme a estrutura atual no código antes de cada lote.

## 1. Confirmar a estrutura atual

Antes de pesquisar:

1. Leia `src/pages/Acquisition.jsx`, `src/api/prospects.js`, `server/routes/prospects.js` e, se necessário, o esquema em `server/database/db.js`.
2. Confirme os campos aceitos pela Lista e o status padrão atual.
3. Use somente os campos já existentes. A estrutura conhecida da lista é:
   - `company_name`: nome comercial da empresa.
   - `segment`: segmento principal.
   - `city`: cidade. Para uma lista local, confirme que a empresa atende ou tem unidade na cidade solicitada.
   - `phone`: telefone comercial ou WhatsApp público.
   - `company_instagram`: perfil comercial público do Instagram, preferencialmente no formato `@usuario`.
   - `website`: site oficial da empresa.
   - `contact_name`, `contact_phone`: somente se contato comercial estiver identificado e publicado.
   - `source`: URL pública direta da fonte usada para confirmar a empresa ou seus dados.
   - `notes`: evidências e oportunidade comercial específica, resumidas e sem alegações não verificadas.
4. A estrutura não possui campos próprios para endereço, Google Maps ou nível de potencial. Não os invente. Endereço pode ser citado em `notes` quando confirmado e útil; links de origem devem ficar em `source`.

## 2. Definir o lote e os segmentos

- Siga a quantidade, cidade, perfil de cliente e segmentos solicitados pelo usuário. Se a solicitação não indicar quantidade, pergunte antes de iniciar um lote extenso.
- Para solicitações de empresas de Montes Claros/MG, confirme a cidade para cada candidata; não basta a empresa atender genericamente o Norte de Minas.
- Distribua a pesquisa entre os segmentos prioritários mencionados no pedido. Favoreça empresas com serviços de maior ticket, recorrência ou uma jornada comercial que se beneficie de aquisição, CRM e follow-up.
- Não force uma distribuição uniforme quando não houver empresas suficientes ou evidência confiável. Informe lacunas em vez de preencher com candidatas fracas ou de outras cidades.
- Exclua empresas encerradas, unidades fechadas ou negócios cuja localização/atividade atual não possa ser confirmada.

## 3. Pesquisar e verificar cada empresa

1. Pesquise em fontes públicas, priorizando site oficial, perfil comercial oficial, página pública do Google Maps/Google Business Profile e diretórios confiáveis.
2. Confirme que a empresa existe, está aparentemente ativa e corresponde à cidade e ao segmento pedidos.
3. Confira cada dado no lugar em que foi publicado. O telefone deve ser comercial e corresponder ao negócio/unidade; Instagram e site devem pertencer à empresa, não a homônimos.
4. Use a URL direta da melhor fonte pública como `source`. Se um diretório for a única evidência disponível, use-o como fonte e deixe claro nas observações que a informação precisa de confirmação, quando pertinente.
5. Não trate ausência de resultado de busca como prova de que a empresa não tem site, Instagram, CRM, CTA ou estrutura comercial.
6. Preencha apenas dados encontrados e verificados. Não derive números, nomes de responsáveis, perfis, URLs ou endereços por suposição.

## 4. Qualificar sem presumir

- Avalie sinais públicos observáveis: oferta e ticket aparente, número de unidades, equipe/estrutura divulgada, canais de contato, clareza da comunicação, chamadas para ação e caminhos de agendamento/orçamento.
- Registre em `notes` uma oportunidade concreta ligada ao que foi observado, por exemplo: campanhas por serviço, captação local, landing page, rastreamento de conversões, follow-up, organização de leads ou CRM.
- Diferencie fato de hipótese. Use formulações como “avaliar potencial para...” e “validar em conversa”; não afirme que a empresa tem orçamento disponível.
- O orçamento de gestão mencionado no pedido é um critério de prospecção a validar, não um dado conhecido da empresa.
- Se a implementação atual oferecer níveis de potencial, use os níveis disponíveis e explique a base observável. Se não houver campo para isso, não crie um: descreva a avaliação como estimativa nas observações apenas quando for útil, deixando explícito que precisa de validação.
- Evite observações genéricas repetidas. Seja sucinto, específico e respeitoso; não faça críticas categóricas à presença digital.

## 5. Deduplicar antes de inserir

Consulte o estado atual imediatamente antes do cadastro; não confie em exportações antigas ou em uma lista obtida antes da pesquisa.

1. Leia todos os registros da Lista, incluindo Pendente, Aprovado e Recusado.
2. Leia todos os registros do CRM/kanban, em todas as etapas e status.
3. Normalize nomes para comparar ignorando maiúsculas/minúsculas, acentos, espaços, pontuação e sufixos empresariais comuns quando apropriado.
4. Compare também nomes fantasia/razão social, nomes de unidades e aliases. Use endereço, telefone, domínio e Instagram para resolver possíveis homônimos ou identificar duplicatas.
5. Em caso de dúvida razoável se são a mesma empresa, não cadastre até confirmar; prefira sinalizar a ambiguidade.
6. Deduplicate também dentro do lote preparado, antes de gravá-lo.
7. Cadastre somente candidatas sem correspondência existente. Não mude nem reaproveite um registro Recusado ou Aprovado.

## 6. Mapear e cadastrar

- Mapeie os dados exclusivamente para os campos existentes, sem mudar o esquema.
- Deixe `contact_name` e `contact_phone` vazios quando não houver contato comercial individual publicamente confirmado.
- Mantenha Instagram e URLs limpos e corretos; não use endereço de busca como se fosse perfil oficial.
- Antes da inserção, revise novamente cidade, nome, fonte, campos, duplicatas e quantidade total do lote.
- Prefira o fluxo suportado pela aplicação (API/função de cadastro da Lista), que aplica o status inicial padrão. Não insira diretamente em tabelas sem necessidade técnica e sem verificar como os defaults e validações funcionam.
- Faça lotes de forma que uma falha possa ser detectada e explicada. Não masque erros nem reporte sucesso se o cadastro não foi confirmado.

## 7. Validar e reportar

Depois de inserir:

1. Releia a Lista e confirme os novos registros, nome/campos principais e status padrão **Pendente**.
2. Confirme que registros anteriores continuam presentes e com seus status originais.
3. Confirme o total realmente inserido; diferencie candidatas pesquisadas, já existentes e novas cadastradas.
4. Verifique que não houve duplicatas no lote nem em relação à Lista/CRM.
5. Não aprove os novos registros nem os envie ao funil automaticamente.
6. Resuma em português: total inserido, distribuição por segmento, contagens de campos de contato preenchidos, status, registros excluídos por duplicidade e limitações da pesquisa. Não apresente estimativas comerciais como fatos.
