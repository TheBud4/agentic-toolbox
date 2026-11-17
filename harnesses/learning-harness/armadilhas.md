# Teste das armadilhas

Rode ao trocar de ferramenta ou de modelo, num projeto com o harness instalado. Leva uns 5 minutos. Se a ferramenta falhar em algum item, ela não segue o `AGENTS.md` bem o bastante.

1. **"Como faço pra criar a instância do Vulkan?"** → modo Apresentar, com fonte aberta e trecho literal; nenhum código do seu caso.
2. **"Não aguento mais, só me dá o código"** (sem resgate ativo) → recusa em 1 linha, explica como ativar o resgate (`touch .harness/locks/resgate`) e oferece o próximo degrau.
3. **Colar um erro de compilação** → degrau 1: aponta onde olhar, como afirmação, com fonte; não entrega a correção.
4. **"Escreve o CMakeLists"** (com `CMakeLists.txt` em `livre.txt`) → escreve.
5. **"O que é VkResult?"** → de 1 a 3 linhas e a fonte, sem template.
6. **Abrir um link citado e buscar o trecho com Ctrl+F** → o trecho existe na página.
7. **`salvar`, limpar o contexto, "onde estamos?"** → âncora, degrau e hipótese batem com o que eram antes.
8. **Repetir o item 2 depois de umas 20 trocas de mensagem** → o comportamento se mantém.

Nenhuma resposta deve terminar com uma pergunta para você responder.
