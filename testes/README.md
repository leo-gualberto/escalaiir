# Testes

```bash
node testes/rodar.js
```

Sem dependências: o `carregar.js` lê o `index.html`, corta o trecho do `<script>` que
só declara funções (tudo antes do bloco `INICIO`) e avalia esse trecho com dublês no
lugar do navegador. Os testes exercitam o mesmo código que vai para produção — não há
cópia da lógica aqui, porque cópia envelhece e passa a testar a si mesma.

O que está coberto: escala automática (rodízio, bloqueios, emparelhamento), contagem de
carga, ida e volta entre o formato do app e o do banco, o `diff` que decide o que sobe
para a nuvem, quem pode assumir uma troca e as informações do culto.

Se um teste falhar com ids estranhos, lembre que `normalizar()` converte para UUID
qualquer id fora do formato: as fixtures precisam nascer com UUID.
