/* Carrega as funções do app fora do navegador.
   O app é um arquivo único que roda no celular; não há módulos para importar.
   Então pegamos o trecho do <script> que só DECLARA coisas (tudo antes do
   bloco INICIO, que é onde o app começa a desenhar tela) e avaliamos esse
   trecho com dublês no lugar do navegador. Assim os testes exercitam o mesmo
   código que vai para produção, sem copiar lógica para cá — cópia envelhece e
   passa a testar a si mesma. */
const fs = require('fs');
const path = require('path');

function elemento() {
  const el = {
    textContent: '', innerHTML: '', value: '', hidden: false,
    dataset: {}, style: {}, children: [], files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return elemento(); },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {}, appendChild() {}, removeChild() {}, remove() {},
    click() {}, focus() {}, addEventListener() {}, setAttribute() {},
    getAttribute() { return null; }, scrollIntoView() {}
  };
  return el;
}

function carregar() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = html.indexOf('<script>');
  const fim = html.indexOf('/* ============ INICIO ============ */');
  if (ini < 0 || fim < 0) throw new Error('não achei os limites do script no index.html');
  const fonte = html.slice(ini + '<script>'.length, fim);

  const guardado = {};
  const localStorage = {
    getItem: k => (k in guardado ? guardado[k] : null),
    setItem: (k, v) => { guardado[k] = String(v); },
    removeItem: k => { delete guardado[k]; }
  };
  const documento = {
    getElementById: () => elemento(),
    querySelector: () => elemento(),
    querySelectorAll: () => [],
    createElement: () => elemento(),
    addEventListener() {},
    body: elemento(),
    documentElement: elemento(),
    hidden: false
  };
  const janela = {
    addEventListener() {},
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { origin: 'https://teste.local', pathname: '/' },
    open() {}
  };
  const navegador = {
    onLine: true, userAgent: 'node',
    clipboard: { writeText: async () => {} },
    serviceWorker: undefined, setAppBadge: undefined
  };
  /* ids previsíveis, mas nunca repetidos: um uid() que devolve sempre o mesmo
     UUID faz dois registros virarem um só, e o teste falha por um motivo que
     não existe no app. */
  let semente = 0;
  const cripto = {
    randomUUID() {
      semente++;
      const n = semente.toString(16).padStart(12, '0');
      return '00000000-0000-4000-8000-' + n;
    },
    getRandomValues(a) {
      semente++;
      for (let i = 0; i < a.length; i++) a[i] = (semente * 31 + i * 7) % 256;
      return a;
    }
  };
  janela.crypto = cripto;   /* o app procura crypto em self/window antes do global */

  const nomes = [
    // modelo e utilidades
    'vazio', 'normalizar', 'migrarIds', 'uid', 'iso', 'pd', 'fmt', 'menosMin', 'difMin',
    'chegada', 'ausente', 'indisponivel', 'ausenciaEm', 'diasDoPeriodo', 'diasBloqueados',
    // escala
    'slotsDoEvento', 'escalaDe', 'candidatos', 'gerarEscala', 'definir', 'statusEvento',
    'primeiroDiaDaSemana', 'datasRecorrentes',
    'carga', 'cargaJanela', 'cargaCiclo', 'cicloDe', 'cicloAtual', 'nomeDoCiclo',
    'mapaCarga', 'inicioJanela', 'ultimaVez', 'textoWhats',
    // permissoes
    'pode', 'ehAdmin', 'temPainel',
    // trocas
    'podeAssumir', 'trocaCompleta', 'trocasAbertas', 'pedirTroca', 'aceitarTroca',
    'recusarTroca', 'permutasPara', 'trocaDaEscala', 'permutasAoAssumir',
    'pedirPermuta', 'minhasEscalas', 'vejoContatos', 'telE164', 'temTelefone',
    // informacoes do culto
    'temInfo', 'urlOk',
    // acesso
    'validadeCodigo', 'podeMexerNoAcesso', 'novoCodigo',
    // nuvem
    'achatar', 'montar', 'diff', 'chaveDe', 'CHAVES', 'ORDEM', 'semNulo',
    'corteSync', 'dentroDaJanela', 'JANELA_SYNC_DIAS', 'TABELAS_JANELA',
    'colunasComparaveis', 'indicePor', 'descreveConflitos'
  ];
  const opcionais = [];
  const todos = nomes.concat(opcionais);
  const devolve = 'return {' + todos
    .map(n => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(',') + ',' +
    'estado: { get DB() { return DB; }, set DB(v) { DB = v; } } };';

  const fabrica = new Function(
    'window', 'document', 'localStorage', 'navigator', 'location', 'self', 'crypto',
    fonte + '\n' + devolve
  );
  const api = fabrica(janela, documento, localStorage, navegador, janela.location, janela, cripto);

  const faltando = nomes.filter(n => api[n] === undefined);
  if (faltando.length) throw new Error('funções não encontradas no index.html: ' + faltando.join(', '));
  api.armazenamento = guardado;
  return api;
}

module.exports = { carregar, elemento };
