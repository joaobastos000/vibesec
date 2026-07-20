# Guia de teste do VibinGuard 0.2.0

Obrigado por participar do piloto do VibinGuard. Esta versão ainda não foi publicada no Marketplace do VS Code. O objetivo do teste é verificar se a extensão impede que segredos e código inseguro gerado por IA cheguem ao projeto sem uma revisão clara.

## Regra mais importante

Use somente dados falsos durante os testes. Nunca copie uma senha, token, chave de API, arquivo `.env` ou código privado real para um relatório, captura de tela ou conversa.

## Requisitos

- Visual Studio Code 1.101 ou mais recente.
- O arquivo `vibin-guard.vsix` recebido junto com este guia.
- Ollama somente para os testes opcionais da segunda camada com IA.

A proteção principal funciona sem Ollama, sem conta e sem serviço remoto do VibinGuard.

## Escopo e limitações deste piloto

Leia esta seção antes de iniciar. Ela evita que uma limitação conhecida seja confundida com erro de instalação ou promessa de proteção completa.

### O que pode impedir a instalação ou execução

- O VS Code precisa ser a versão 1.101 ou mais recente.
- O VibinGuard precisa do aplicativo desktop. Ele não funciona no `vscode.dev` ou em outra versão do VS Code executada somente no navegador.
- Políticas corporativas podem bloquear arquivos VSIX, extensões externas ou publicadores ainda não verificados.
- Cursor, Windsurf e outros editores baseados em VS Code podem aceitar o VSIX, mas ainda não foram validados oficialmente neste piloto.
- A extensão foi testada automaticamente no Windows e no VS Code 1.129. macOS e Linux precisam de validação prática.
- Node.js não é necessário para instalar ou usar a extensão. Node.js 22 é requisito somente para quem deseja compilar o projeto.
- Instalações feitas por VSIX não recebem atualização automática. Cada nova versão precisa ser instalada novamente.

### Linguagens e arquivos cobertos

- A varredura principal suporta TypeScript, JavaScript, JSX, TSX, JSON e arquivos `.env`.
- Arquivos `.cs`, `.csproj`, `.py`, `.java`, `.go` e outras linguagens ainda não entram na varredura completa de arquivo ou projeto.
- Em um projeto .NET, o guardião de colagem ainda pode identificar segredos e padrões genéricos, e arquivos como `appsettings.json` podem ser analisados. Isso não representa suporte completo a C# ou ASP.NET.
- Arquivos maiores que 256 KB não são analisados integralmente.
- A descoberta de projeto é limitada a 800 arquivos e ignora diretórios gerados, como `node_modules` e `dist`.

### Momento em que a proteção acontece

- O VibinGuard não substitui o `Ctrl+V` comum. A proteção anterior à inserção só acontece ao executar **VibinGuard: Guard Clipboard Before Paste**.
- A extensão ainda não intercepta automaticamente código escrito diretamente por Copilot, Cursor ou outras extensões de IA.
- Scan-on-save analisa o arquivo depois que o conteúdo entrou no editor.
- Ainda não existe Git hook para bloquear automaticamente `commit` ou `push`.
- O VibinGuard reduz risco, mas não garante que um projeto esteja seguro e não substitui revisão humana, testes ou auditoria profissional.

### Cobertura das verificações

- As regras essenciais usam padrões determinísticos. Elas podem não reconhecer segredos ofuscados, divididos em várias strings ou armazenados em formatos incomuns.
- Falsos positivos e falsos negativos ainda são possíveis e devem ser registrados durante o piloto.
- Semgrep e `npm audit` já possuem adaptadores no núcleo, mas permanecem desativados na extensão atual.
- A cobertura de vulnerabilidades em dependências ainda é limitada.
- Não há telemetria. Resultados e erros precisam ser enviados manualmente pelo testador usando o formulário ao final deste guia.

### Limitações da IA local

- O Ollama não acompanha o VSIX. Ele e o modelo precisam ser instalados separadamente.
- Somente Ollama local é suportado. OpenAI, Anthropic e outros provedores em nuvem ainda não estão disponíveis.
- O endereço da IA precisa ser `localhost`, `127.0.0.1` ou `::1`.
- Em SSH, WSL ou Dev Containers, `localhost` pode apontar para o ambiente remoto, e não para o Ollama instalado no computador do testador.
- O modelo recomendado ocupa espaço em disco, consome memória e pode responder lentamente em máquinas sem CPU ou GPU adequadas.
- A revisão semântica seleciona no máximo oito arquivos relevantes e aproximadamente 18 mil caracteres por chamada. Ela não envia o projeto inteiro ao modelo.
- A correção com IA não é oferecida para conteúdos acima do limite configurado.
- Respostas do modelo podem variar. Uma ausência de alerta não prova que o código é seguro.
- A correção gerada substitui o conteúdo revisado, passa por nova análise, exige confirmação e não salva o arquivo automaticamente.
- Se o arquivo mudar durante a geração, o VibinGuard cancela a aplicação para evitar sobrescrever alterações recentes.

### O que ainda deve funcionar quando a IA falha

- Se o Ollama estiver ausente, desligado, sem o modelo ou exceder o tempo limite, as regras determinísticas continuam funcionando.
- Segredos e riscos bloqueantes encontrados pelas regras locais não são enviados ao modelo.
- Respostas fora do formato esperado são descartadas.
- A indisponibilidade da IA deve aparecer como aviso, não como travamento da extensão.

## 1. Instalar a extensão

1. Abra o VS Code.
2. Abra **Extensions** com `Ctrl+Shift+X`.
3. Clique no menu `...` da visualização de extensões.
4. Escolha **Install from VSIX...**.
5. Selecione `vibin-guard.vsix`.
6. Execute **Developer: Reload Window** pela paleta de comandos.

Também é possível instalar pelo terminal:

```powershell
code --install-extension vibin-guard.vsix --force
```

Depois da instalação, procure `VibinGuard` na paleta de comandos. Devem aparecer comandos como:

- `VibinGuard: Guard Clipboard Before Paste`
- `VibinGuard: Scan Current File`
- `VibinGuard: Scan Project`
- `VibinGuard: Show Security Review`
- `VibinGuard: Configure Local AI`
- `VibinGuard: Check Local AI`

## 2. Confirmar uma colagem segura

1. Crie ou abra um arquivo TypeScript.
2. Copie o código abaixo:

```ts
export const port = Number(process.env.PORT ?? 3000);
```

3. Coloque o cursor no arquivo.
4. Execute **VibinGuard: Guard Clipboard Before Paste**.

Resultado esperado:

- O código é inserido no editor.
- O VibinGuard informa que a verificação foi aprovada.
- Nenhum diagnóstico de segurança é criado.

## 3. Confirmar o bloqueio de um segredo falso

Copie este valor de teste, que não é uma credencial real:

```ts
const apiKey = "fake_test_1234567890abcdef";
```

Execute novamente **VibinGuard: Guard Clipboard Before Paste**.

Resultado esperado:

- A colagem é bloqueada antes de o conteúdo entrar no arquivo.
- O aviso explica em linguagem simples que uma chave, senha ou token pode ficar exposto.
- A credencial falsa completa não aparece nos diagnósticos nem no canal de saída.
- As ações **Abrir revisão** e **Pedir correção à IA** ou **Corrigir com IA local** ficam disponíveis.

Importante: usar `Ctrl+V` diretamente não passa pelo guardião de colagem. Durante o piloto, use o comando do VibinGuard para testar a proteção anterior à inserção.

## 4. Testar a revisão de um arquivo

Crie um arquivo de teste com este código:

```ts
export async function findUser(db: any, userId: string) {
  return db.query(`SELECT * FROM users WHERE id = ${userId}`);
}
```

Execute **VibinGuard: Scan Current File**.

Resultado esperado:

- O trecho recebe um diagnóstico de erro.
- A mensagem explica que uma entrada pode alterar a consulta.
- **VibinGuard: Show Security Review** mostra o alerta agrupado pelo arquivo.
- Ao selecionar o alerta, o VS Code abre e destaca o trecho correspondente.
- **Detalhes técnicos** mostra informações como categoria, severidade e referência CWE apenas quando solicitado.

## 5. Testar a verificação ao salvar

1. Confirme em Settings que `VibinGuard: Scan On Save` está habilitado.
2. Salve um arquivo contendo um dos exemplos inseguros deste guia.

Resultado esperado:

- O diagnóstico aparece depois do salvamento.
- Nenhum JSON é mostrado ao usuário.
- O salvamento não é cancelado. A proteção anterior à inserção acontece pelo comando de colagem; a análise ao salvar é uma segunda oportunidade de revisão.

## 6. Testar o projeto

Abra uma pasta pequena contendo arquivos TypeScript ou JavaScript e execute **VibinGuard: Scan Project**.

Resultado esperado:

- Os arquivos compatíveis são analisados.
- Os alertas aparecem no painel Problems e na revisão do VibinGuard.
- Pastas geradas, como `node_modules` e `dist`, não dominam os resultados.

## 7. Ativar a segunda camada com IA local

Este teste é opcional. Instale o Ollama no computador e baixe o modelo recomendado:

```powershell
ollama pull qwen2.5-coder:3b-instruct
```

No VS Code:

1. Execute **VibinGuard: Configure Local AI**.
2. Escolha ativar a segunda revisão local.
3. Mantenha `qwen2.5-coder:3b-instruct` como modelo.
4. Execute **VibinGuard: Check Local AI**.

Resultado esperado:

- O comando confirma que a IA local está disponível.
- Se o Ollama estiver desligado, o VibinGuard informa a indisponibilidade sem interromper as verificações essenciais.
- O código é enviado somente para um endereço local como `127.0.0.1` ou `localhost`.

## 8. Testar uma falha semântica

Com a IA local habilitada, analise este exemplo:

```ts
export async function getInvoice(req: any, res: any, db: any) {
  const invoice = await db.invoice.findUnique({
    where: { id: req.params.id },
  });
  return res.json(invoice);
}
```

O exemplo busca uma fatura apenas pelo identificador, sem conferir se ela pertence ao usuário autenticado.

Resultado esperado:

- A IA local pode apontar ausência de autorização ou isolamento entre usuários.
- O alerta deve indicar que veio de `VibinGuard IA local`.
- Uma resposta inválida ou uma falha do modelo deve ser descartada sem quebrar a extensão.

Modelos podem variar. Se o problema não for detectado, registre isso como resultado do teste, sem alterar o exemplo para incluir dados reais.

## 9. Testar a correção com IA local

1. Mantenha a IA local habilitada.
2. Repita o teste do segredo falso da seção 3.
3. Escolha **Corrigir com IA local**.

Resultado esperado:

- O segredo falso original não aparece na prévia.
- A IA propõe uma substituição, normalmente usando uma variável de ambiente.
- O VibinGuard analisa a proposta novamente antes de mostrá-la.
- Uma proposta ainda vulnerável é rejeitada e não pode ser aplicada.
- Uma proposta aprovada aparece em um documento de prévia separado.
- **Aplicar correção** insere a proposta; **Descartar** não altera o arquivo.
- O arquivo não é salvo automaticamente.
- Se o arquivo mudar enquanto a proposta é gerada, a aplicação é cancelada para não sobrescrever trabalho recente.

## 10. O que observar

Durante os testes, observe principalmente:

- Clareza das mensagens para uma pessoa sem experiência em segurança.
- Falsos positivos em código seguro.
- Problemas reais que não foram detectados.
- Lentidão, travamentos ou avisos repetitivos.
- Diagnósticos apontando a linha errada.
- Diferenças entre Windows, macOS e Linux.
- Comportamento quando o Ollama está desligado ou o modelo não foi baixado.

## Como relatar um problema

Use este modelo:

```text
Versão do VibinGuard: 0.2.0
Sistema operacional:
Editor utilizado: VS Code/Cursor/Windsurf/outro
Versão do VS Code:
Ambiente: local/WSL/SSH/Dev Container
Linguagem e tipo de arquivo testado:
Ollama habilitado: sim/não
Modelo local, se usado:

O que eu estava tentando fazer:
Passos para reproduzir:
Resultado esperado:
Resultado observado:
Mensagem de erro, sem dados privados:
```

Não anexe projetos privados. Prefira um arquivo mínimo criado somente para reproduzir o problema e substitua qualquer dado sensível por valores falsos.

## Atualizar ou remover

Instalações feitas por VSIX não recebem atualização automática. Para testar uma nova versão, instale o novo arquivo com `--force` ou use novamente **Install from VSIX...**.

Para remover, abra Extensions, encontre VibinGuard, abra o menu da extensão e escolha **Uninstall**.
