/* Testes das regras que decidem coisas no app: quem entra na escala, o que
   sobe para a nuvem e quem pode assumir uma troca. Rode com:  node testes/rodar.js
   Não precisa instalar nada. */
const { carregar } = require('./carregar.js');
const app = carregar();

let passou = 0, falhou = 0;
const casos = [];
function teste(nome, fn) { casos.push([nome, fn]); }
function ok(cond, detalhe) {
  if (!cond) throw new Error(detalhe || 'esperava verdadeiro');
}
function igual(a, b, detalhe) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((detalhe ? detalhe + ': ' : '') + x + ' !== ' + y);
}
const diaRelativo = n => {
  const d = new Date(); d.setDate(d.getDate() + n); return app.iso(d);
};
/* O app converte para UUID qualquer id em formato antigo (normalizar →
   migrarIds), então as fixtures já nascem com UUID: senão os ids mudam no
   meio do teste e nenhuma comparação fecha. */
const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ANA = ID(1), BIA = ID(2), CAIO = ID(3);
const T1 = ID(10), VOZ = ID(11), TEC = ID(12);
const E1 = ID(20), E0 = ID(21), E_ANTIGO = ID(22), E_RECENTE = ID(23);
const A1 = ID(30), A2 = ID(31), AU1 = ID(40), IG = ID(50);

/* ---------- mundo de teste ---------- */
function mundo() {
  const db = app.vazio();
  db.igrejaId = IG;
  db.config.igreja = 'Igreja de Teste';
  db.teams = [{
    id: T1, nome: 'Louvor', cor: '#4f46e5', antecedencia: 60,
    funcoes: [{ id: VOZ, nome: 'Vocal', qtd: 1 }, { id: TEC, nome: 'Teclado', qtd: 1 }]
  }];
  db.pessoas = [
    pessoa(ANA, 'Ana', [VOZ, TEC], { admin: true }),
    pessoa(BIA, 'Bia', [VOZ]),
    pessoa(CAIO, 'Caio', [VOZ])
  ];
  db.eventos = [evento(E1, diaRelativo(7))];
  db.sessao = ANA; db.meuId = ANA;
  return db;
}
const pessoa = (id, nome, funcoes, perms) => ({
  id, nome, telefone: '', email: nome.toLowerCase() + '@teste.com', nascimento: '1990-01-01',
  codigo: id.slice(-6).toUpperCase(), perms: perms || {}, lider: !!perms,
  teamIds: [T1], funcaoIds: funcoes
});
const evento = (id, data) => ({
  id, titulo: 'Culto', data, hora: '19:00', teamIds: [T1], chegadas: {}, obs: '', links: []
});
const escala = (id, eventoId, funcaoId, pessoaId, status, idx) => ({
  id, eventoId, teamId: T1, funcaoId, idx: idx || 0, pessoaId, status: status || 'pendente'
});
const usar = db => { app.estado.DB = app.normalizar(db); return app.estado.DB; };
const escaladoEm = (db, funcaoId) =>
  (db.escalas.find(a => a.eventoId === E1 && a.funcaoId === funcaoId) || {}).pessoaId;

/* ---------- escala automática ---------- */

teste('escala automática chama primeiro quem serviu menos', () => {
  const db = mundo();
  db.teams[0].funcoes = [{ id: VOZ, nome: 'Vocal', qtd: 1 }];
  db.eventos.push(evento(E0, diaRelativo(-7)));
  db.escalas = [escala(A1, E0, VOZ, ANA), escala(A2, E0, VOZ, BIA)];
  usar(db);
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, VOZ), CAIO, 'quem nunca serviu deveria entrar');
});

teste('escala automática pula quem bloqueou a data', () => {
  const db = mundo();
  db.teams[0].funcoes = [{ id: VOZ, nome: 'Vocal', qtd: 1 }];
  db.indisp = [{ pessoaId: CAIO, data: db.eventos[0].data }];
  db.ausencias = [{ id: AU1, pessoaId: BIA, inicio: diaRelativo(1), fim: diaRelativo(20), motivo: 'viagem' }];
  usar(db);
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, VOZ), ANA, 'só a Ana estava livre');
});

teste('escala automática não desperdiça quem é a única para uma função', () => {
  /* Ana faz vocal e teclado; Bia só vocal. Se a Ana for para o vocal,
     o teclado fica vago — o emparelhamento tem de evitar isso. */
  const db = mundo();
  db.pessoas = [pessoa(ANA, 'Ana', [VOZ, TEC], { admin: true }), pessoa(BIA, 'Bia', [VOZ])];
  usar(db);
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, TEC), ANA, 'Ana era a única do teclado');
  igual(escaladoEm(db, VOZ), BIA, 'Bia deveria ficar com o vocal');
});

teste('escala automática não escala a mesma pessoa duas vezes no mesmo culto', () => {
  const db = mundo();
  db.pessoas = [pessoa(ANA, 'Ana', [VOZ, TEC], { admin: true })];
  usar(db);
  app.gerarEscala(db.eventos[0], false);
  const doEvento = db.escalas.filter(a => a.eventoId === E1);
  igual(doEvento.length, 1, 'só havia uma pessoa para duas vagas');
});

teste('escala automática preserva o que já estava escalado', () => {
  const db = mundo();
  db.escalas = [escala(A1, E1, VOZ, CAIO, 'confirmado')];
  usar(db);
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, VOZ), CAIO, 'a vaga preenchida não podia mudar');
  ok(escaladoEm(db, TEC) === ANA, 'a vaga vazia deveria ser preenchida');
});

/* ---------- rodízio ---------- */

teste('carga ignora convocação recusada', () => {
  const db = mundo();
  db.eventos.push(evento(E0, diaRelativo(-3)));
  db.escalas = [escala(A1, E0, VOZ, ANA, 'recusado'),
                escala(A2, E0, TEC, BIA, 'confirmado')];
  usar(db);
  igual(app.carga(ANA), 0, 'recusar não é servir');
  igual(app.carga(BIA), 1);
});

teste('janela do rodízio esquece o que é muito antigo', () => {
  const db = mundo();
  db.eventos.push(evento(E_ANTIGO, diaRelativo(-200)), evento(E_RECENTE, diaRelativo(-10)));
  db.escalas = [escala(A1, E_ANTIGO, VOZ, ANA), escala(A2, E_RECENTE, VOZ, ANA)];
  usar(db);
  igual(app.carga(ANA), 2, 'o total conta tudo o que está no aparelho');
  igual(app.cargaJanela(ANA), 1, 'a janela conta só o que é recente');
});

teste('mapaCarga bate com as contas individuais', () => {
  const db = mundo();
  db.eventos.push(evento(E0, diaRelativo(-5)));
  db.escalas = [escala(A1, E0, VOZ, ANA), escala(A2, E1, VOZ, BIA)];
  usar(db);
  const m = app.mapaCarga(app.inicioJanela());
  igual(m.total[ANA], app.carga(ANA));
  igual(m.janela[BIA], app.cargaJanela(BIA));
  igual(m.ultima[CAIO], '0000-00-00', 'quem nunca serviu não tem última vez');
});

/* ---------- ciclo mensal ---------- */

teste('a conta do mês pesa mais que a dos últimos 90 dias', () => {
  /* Ana serviu muito no mês passado, Bia já serviu uma vez neste.
     Dentro do mês quem tem menos vai na frente: é a vez da Ana. */
  const db = mundo();
  db.teams[0].funcoes = [{ id: VOZ, nome: 'Vocal', qtd: 1 }];
  db.eventos = [evento(E1, '2027-03-14')];
  db.eventos.push(evento(ID(60), '2027-02-07'), evento(ID(61), '2027-02-14'),
                  evento(ID(62), '2027-02-21'), evento(ID(63), '2027-03-07'));
  db.escalas = [
    escala(ID(70), ID(60), VOZ, ANA), escala(ID(71), ID(61), VOZ, ANA),
    escala(ID(72), ID(62), VOZ, ANA), escala(ID(73), ID(63), VOZ, BIA)
  ];
  db.pessoas = [pessoa(ANA, 'Ana', [VOZ], { admin: true }), pessoa(BIA, 'Bia', [VOZ])];
  usar(db);
  igual(app.cargaCiclo(ANA, '2027-03'), 0, 'Ana não serviu em março');
  igual(app.cargaCiclo(BIA, '2027-03'), 1, 'Bia já serviu uma vez em março');
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, VOZ), ANA, 'quem tem menos NO MÊS entra primeiro');
});

teste('a conta zera na virada do mês', () => {
  /* Ambas serviram 3x em março. Em abril a Bia já pegou uma; a próxima é da Ana,
     mesmo com o histórico de março empatado. */
  const db = mundo();
  db.teams[0].funcoes = [{ id: VOZ, nome: 'Vocal', qtd: 1 }];
  db.pessoas = [pessoa(ANA, 'Ana', [VOZ], { admin: true }), pessoa(BIA, 'Bia', [VOZ])];
  db.eventos = [evento(E1, '2027-04-11')];
  ['2027-03-07', '2027-03-14', '2027-03-21'].forEach((d, i) => {
    db.eventos.push(evento(ID(80 + i), d), evento(ID(90 + i), d));
    db.escalas.push(escala(ID(100 + i), ID(80 + i), VOZ, ANA),
                    escala(ID(110 + i), ID(90 + i), VOZ, BIA));
  });
  db.eventos.push(evento(ID(120), '2027-04-04'));
  db.escalas.push(escala(ID(121), ID(120), VOZ, BIA));
  usar(db);
  igual(app.cargaCiclo(ANA, '2027-04'), 0);
  igual(app.cargaCiclo(BIA, '2027-04'), 1);
  app.gerarEscala(db.eventos[0], false);
  igual(escaladoEm(db, VOZ), ANA, 'em abril vale a conta de abril');
});

teste('ao longo do mês a distribuição fica igual', () => {
  const db = mundo();
  db.teams[0].funcoes = [{ id: VOZ, nome: 'Vocal', qtd: 1 }];
  db.pessoas = [pessoa(ANA, 'Ana', [VOZ], { admin: true }), pessoa(BIA, 'Bia', [VOZ]),
                pessoa(CAIO, 'Caio', [VOZ])];
  const dias = ['2027-05-02', '2027-05-09', '2027-05-16', '2027-05-23', '2027-05-30', '2027-06-06'];
  db.eventos = dias.map((d, i) => evento(ID(130 + i), d));
  usar(db);
  db.eventos.forEach(ev => app.gerarEscala(ev, false));
  const maio = [ANA, BIA, CAIO].map(id => app.cargaCiclo(id, '2027-05'));
  igual(maio.sort(), [1, 2, 2], 'cinco cultos entre três pessoas, sem ninguém sobrecarregado');
  const junho = [ANA, BIA, CAIO].map(id => app.cargaCiclo(id, '2027-06'));
  igual(junho.filter(n => n).length, 1, 'junho começa do zero e distribui de novo');
  igual(app.cargaCiclo(ANA, '2027-05') + app.cargaCiclo(BIA, '2027-05')
      + app.cargaCiclo(CAIO, '2027-05'), 5, 'todos os cultos de maio foram preenchidos');
});

teste('mapaCarga conta o mês pedido', () => {
  const db = mundo();
  db.eventos = [evento(E1, '2027-07-04'), evento(E0, '2027-08-01')];
  db.escalas = [escala(A1, E1, VOZ, ANA), escala(A2, E0, VOZ, ANA)];
  usar(db);
  const m = app.mapaCarga(app.inicioJanela(), '2027-07');
  igual(m.mes[ANA], 1, 'só o culto de julho');
  igual(m.total[ANA], 2, 'o total continua contando tudo');
  igual(m.mes[BIA], 0);
});

/* ---------- sincronização ---------- */

teste('ida e volta para o formato do banco não perde nada', () => {
  const db = mundo();
  db.eventos[0].obs = 'Entrada pelo estacionamento';
  db.eventos[0].links = [{ titulo: 'Ordem', url: 'https://exemplo.com/x' }];
  db.eventos[0].chegadas = { t1: '18:00' };
  db.escalas = [escala(A1, E1, VOZ, BIA, 'confirmado')];
  db.indisp = [{ pessoaId: CAIO, data: diaRelativo(30) }];
  db.ausencias = [{ id: AU1, pessoaId: BIA, inicio: diaRelativo(40), fim: diaRelativo(45), motivo: 'viagem' }];
  usar(db);

  const linhas = app.achatar(db);
  const dados = Object.assign({ igrejas: [{ id: IG, nome: 'Igreja de Teste', limite_bloqueio: 30 }] }, linhas);
  const volta = app.normalizar(Object.assign(app.montar(dados), { sessao: ANA, meuId: ANA }));
  app.estado.DB = volta;

  igual(app.achatar(volta).eventos, linhas.eventos, 'eventos');
  igual(app.achatar(volta).escalas, linhas.escalas, 'escalas');
  igual(app.achatar(volta).ausencias, linhas.ausencias, 'ausências');
  igual(volta.eventos[0].obs, 'Entrada pelo estacionamento', 'informações do culto');
  igual(volta.eventos[0].links.length, 1, 'links do culto');
});

teste('diff enxerga o que entrou, o que mudou e o que saiu', () => {
  const db = mundo();
  db.escalas = [escala(A1, E1, VOZ, BIA)];
  usar(db);
  const antes = app.achatar(db);

  db.escalas[0].status = 'confirmado';                      // alterado
  db.escalas.push(escala(A2, E1, TEC, ANA));    // novo
  db.pessoas = db.pessoas.filter(p => p.id !== CAIO);   // removido
  const depois = app.achatar(db);

  const plano = app.diff(antes, depois);
  igual(plano.escalas.alterar.length, 1, 'uma escala alterada');
  igual(plano.escalas.inserir.length, 1, 'uma escala nova');
  igual(plano.perfis.apagar.length, 1, 'um perfil removido');
  igual(plano.perfis.apagar[0].id, CAIO);
});

teste('diff não inventa mudança quando nada mudou', () => {
  const db = mundo();
  usar(db);
  const foto = app.achatar(db);
  igual(Object.keys(app.diff(foto, app.achatar(db))), [], 'nada a enviar');
});

teste('toda tabela enviada tem chave primária declarada', () => {
  const db = mundo(); usar(db);
  const tabelas = Object.keys(app.achatar(db));
  const semChave = tabelas.filter(t => !app.CHAVES[t]);
  igual(semChave, [], 'tabelas sem chave no diff');
  const foraDaOrdem = tabelas.filter(t => app.ORDEM.indexOf(t) < 0);
  igual(foraDaOrdem, [], 'tabelas fora da ordem de gravação');
});

/* ---------- trocas ---------- */

teste('quem pode assumir uma troca', () => {
  const db = mundo();
  db.escalas = [escala(A1, E1, VOZ, ANA), escala(A2, E1, TEC, BIA)];
  db.indisp = [{ pessoaId: CAIO, data: db.eventos[0].data }];
  usar(db);
  const t = { escalaId: A1, deId: ANA };
  ok(!app.podeAssumir(t, ANA), 'quem pediu não assume o próprio pedido');
  ok(!app.podeAssumir(t, BIA), 'quem já serve neste culto não assume outra vaga');
  ok(!app.podeAssumir(t, CAIO), 'quem bloqueou a data não assume');
});

teste('troca aceita muda o dono da vaga', () => {
  const db = mundo();
  db.escalas = [escala(A1, E1, VOZ, ANA)];
  usar(db);
  app.pedirTroca(A1, null, 'compromisso');
  const t = app.trocasAbertas()[0];
  ok(t, 'o pedido deveria estar aberto');
  app.aceitarTroca(t.id, CAIO);
  igual(escaladoEm(db, VOZ), CAIO, 'a vaga passou para quem aceitou');
  igual(app.trocasAbertas().length, 0, 'o pedido saiu do mural');
});

/* ---------- informações do culto ---------- */

teste('informações do culto só existem quando há conteúdo', () => {
  ok(!app.temInfo({ obs: '   ', links: [] }), 'espaço em branco não é informação');
  ok(app.temInfo({ obs: 'Ensaio 30min antes', links: [] }));
  ok(app.temInfo({ obs: '', links: [{ titulo: 'x', url: 'https://a.b' }] }));
  ok(!app.urlOk('javascript:alert(1)'), 'link perigoso não passa');
  ok(app.urlOk('https://exemplo.com'));
});

/* ---------- execução ---------- */
for (const [nome, fn] of casos) {
  try { fn(); passou++; console.log('  ok   ' + nome); }
  catch (e) { falhou++; console.log('  FALHOU  ' + nome + '\n         ' + e.message); }
}
console.log('\n' + passou + ' passaram, ' + falhou + ' falharam');
process.exit(falhou ? 1 : 0);
