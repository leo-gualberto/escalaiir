// avisos-push — notificações do Escala da Equipe
//
// Chamada pelo agendador do banco (pg_cron) com { tipo }:
//   avisos          fila de avisos do app (troca, alerta...)     a cada minuto
//   convocacao      "você foi escalado"                            a cada 5 min
//   lembrete        véspera, dias = 1                              10h
//   hoje            no dia, perto da hora de chegar                a cada 10 min
//   buracos, trocas-paradas, teste
//
// Cada notificação leva `url` (o app abre direto no culto ou na aba certa) e,
// quando é de uma escala, `escala` + `acao: "confirmar"` (o Android mostra o
// botão Confirmar; o iPhone ignora).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Aviso = {
  titulo: string; corpo: string; tag: string; url?: string; badge?: number;
  escala?: string; acao?: string;
};

async function enviarPara(perfilId: string, aviso: Aviso): Promise<number> {
  if (!perfilId) return 0;
  const { data: assinaturas } = await db
    .from("push_assinaturas").select("*").eq("perfil_id", perfilId);

  let entregues = 0;
  for (const a of assinaturas ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        JSON.stringify(aviso),
      );
      entregues++;
      if (a.falhas) {
        await db.from("push_assinaturas")
          .update({ falhas: 0, ultimo_erro: null }).eq("id", a.id);
      }
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_assinaturas").delete().eq("id", a.id);
      } else {
        await db.from("push_assinaturas")
          .update({ falhas: (a.falhas ?? 0) + 1, ultimo_erro: String(e) })
          .eq("id", a.id);
      }
    }
  }
  return entregues;
}

const quandoTexto = (dias: number) =>
  dias <= 0 ? "É hoje." : dias === 1 ? "É amanhã." : `Faltam ${dias} dias.`;

const TITULO_POR_TIPO: Record<string, string> = {
  troca: "Pedido de troca",
  ok: "Troca resolvida",
  parada: "Sua troca segue sem resposta",
  buraco: "Faltando gente na escala",
  alerta: "Atenção na escala",
  erro: "Problema reportado",
  info: "Escala da Equipe",
};

/* para onde o app abre ao tocar no aviso */
const URL_POR_TIPO: Record<string, string> = {
  troca: "./index.html?aba=trocas",
  ok: "./index.html?aba=trocas",
  parada: "./index.html?aba=trocas",
};
const urlDaEscala = (id: string) => `./index.html?escala=${id}`;

/* hora e data em Brasília, para o lembrete do dia */
function agoraSP() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return { data: `${v("year")}-${v("month")}-${v("day")}`, min: +v("hour") * 60 + +v("minute") };
}
const minutos = (hhmm: string) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

async function tarefaAvisos(limite: number) {
  const { data: fila, error } = await db.rpc("avisos_para_enviar", {
    p_limite: limite,
  });
  if (error) throw error;

  let enviados = 0;
  for (const a of fila ?? []) {
    const n = await enviarPara(a.perfil_id, {
      titulo: TITULO_POR_TIPO[a.tipo] ?? "Escala da Equipe",
      corpo: a.texto,
      tag: `aviso-${a.aviso_id}`,
      url: URL_POR_TIPO[a.tipo] ?? "./index.html",
      badge: a.nao_lidos ?? undefined,
    });
    await db.rpc("marcar_aviso_enviado", { p_aviso: a.aviso_id });
    if (n > 0) enviados++;
  }
  return { fila: fila?.length ?? 0, enviados };
}

async function tarefaEscalas(tipo: "convocacao" | "lembrete", dias: number) {
  const { data: linhas, error } = await db.rpc("escalas_para_avisar", {
    p_tipo: tipo,
    p_dias: dias,
  });
  if (error) throw error;

  let enviadas = 0;
  for (const l of linhas ?? []) {
    const aviso: Aviso = tipo === "convocacao"
      ? {
        titulo: "Você foi escalado",
        corpo: `${l.funcao} no ${l.evento}, ${l.data_longa}. Chegada ${l.chegada}.`,
        tag: `convocacao-${l.escala_id}`,
      }
      : {
        titulo: dias === 1 ? `Amanhã: ${l.evento}` : `Em ${dias} dias: ${l.evento}`,
        corpo: `${l.funcao} · chegar às ${l.chegada}`,
        tag: `lembrete-${l.escala_id}`,
      };
    aviso.url = urlDaEscala(l.escala_id);
    aviso.escala = l.escala_id;
    aviso.acao = "confirmar";

    const { data: nl } = await db.rpc("nao_lidos_de", { p_perfil: l.perfil_id });
    if (typeof nl === "number") aviso.badge = nl;

    if (await enviarPara(l.perfil_id, aviso) > 0) {
      await db.rpc("marcar_aviso", {
        p_escala: l.escala_id,
        p_chave: tipo === "convocacao" ? "convocacao" : `d${dias}`,
      });
      enviadas++;
    }
  }
  return { candidatos: linhas?.length ?? 0, enviadas };
}

/* No dia do culto, quando faltar no maximo `janela` minutos para a hora de
   chegar. Roda a cada 10 minutos; quem ainda esta fora da janela fica para a
   proxima rodada. Entre 21h e meia-noite de Brasilia o banco ja esta no dia
   seguinte (UTC), entao a rodada e pulada para nao lembrar o culto errado. */
async function tarefaHoje(janela: number) {
  const agora = agoraSP();
  const utc = new Date().toISOString().slice(0, 10);
  if (agora.data !== utc) return { pulado: "fora do horario em que o banco e Brasilia concordam na data" };

  const { data: linhas, error } = await db.rpc("escalas_para_avisar", {
    p_tipo: "lembrete",
    p_dias: 0,
  });
  if (error) throw error;

  let enviadas = 0, fora = 0;
  for (const l of linhas ?? []) {
    const falta = minutos(l.chegada) - agora.min;
    if (!(falta >= 0 && falta <= janela)) { fora++; continue; }
    const aviso: Aviso = {
      titulo: `Hoje: ${l.evento}`,
      corpo: `${l.funcao}, chegar às ${l.chegada}.`,
      tag: `hoje-${l.escala_id}`,
      url: urlDaEscala(l.escala_id),
      escala: l.escala_id,
      acao: "confirmar",
    };
    const { data: nl } = await db.rpc("nao_lidos_de", { p_perfil: l.perfil_id });
    if (typeof nl === "number") aviso.badge = nl;
    if (await enviarPara(l.perfil_id, aviso) > 0) {
      await db.rpc("marcar_aviso", { p_escala: l.escala_id, p_chave: "d0" });
      enviadas++;
    }
  }
  return { candidatos: linhas?.length ?? 0, fora_da_janela: fora, enviadas };
}

async function tarefaBuracos(dias: number) {
  const { data: cultos, error } = await db.rpc("eventos_com_buraco", {
    p_dias: dias,
  });
  if (error) throw error;

  let avisados = 0;
  for (const c of cultos ?? []) {
    const { data: lideres } = await db.rpc("lideres_da_igreja", {
      p_igreja: c.igreja_id,
    });
    const texto = `${c.faltando} vaga(s) sem ninguém em ${c.titulo} (${c.data_txt}).`;

    for (const l of lideres ?? []) {
      await enviarPara(l.perfil_id, {
        titulo: `Faltam ${c.faltando} pessoa(s)`,
        corpo: `${c.titulo}, ${c.data_txt}. ${c.faltando} de ${c.vagas} vagas em aberto.`,
        tag: `buraco-${c.evento_id}`,
        url: `./index.html?evento=${c.evento_id}`,
      });
      await db.from("avisos").insert({
        para_id: l.perfil_id, texto, tipo: "buraco", ref: c.evento_id,
        enviado_em: new Date().toISOString(),
      });
    }
    await db.rpc("marcar_alerta_buraco", { p_evento: c.evento_id });
    avisados++;
  }
  return { cultos: cultos?.length ?? 0, avisados };
}

async function tarefaTrocasParadas(dias: number) {
  const { data: paradas, error } = await db.rpc("trocas_paradas", {
    p_dias: dias,
  });
  if (error) throw error;

  let avisados = 0;
  for (const t of paradas ?? []) {
    const saida = t.candidatos > 0
      ? `${t.candidatos} pessoa(s) podem assumir — chame alguém direto.`
      : "Ninguém da equipe pode assumir. Fale com o líder.";
    const quando = quandoTexto(t.dias_ate);

    await enviarPara(t.perfil_id, {
      titulo: "Sua troca ainda está sem resposta",
      corpo: `${t.funcao} no ${t.evento}, ${t.data_txt}. ${quando} ${saida}`,
      tag: `parada-${t.troca_id}`,
      url: "./index.html?aba=trocas",
    });
    await db.from("avisos").insert({
      para_id: t.perfil_id,
      texto: `Ninguém assumiu o seu pedido de troca de ${t.funcao} em ${t.evento} (${t.data_txt}). ${quando} ${saida}`,
      tipo: "parada", ref: t.troca_id,
      enviado_em: new Date().toISOString(),
    });
    await db.rpc("marcar_alerta_parada", { p_troca: t.troca_id });
    avisados++;
  }
  return { paradas: paradas?.length ?? 0, avisados };
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const tipo = String(body.tipo ?? "avisos");
  const dias = Number(
    body.dias ?? (tipo === "buracos" ? 7 : tipo === "trocas-paradas" ? 2 : 1),
  );

  try {
    switch (tipo) {
      case "avisos":
        return Response.json({ tipo, ...await tarefaAvisos(Number(body.limite ?? 200)) });

      case "convocacao":
      case "lembrete":
        return Response.json({ tipo, dias, ...await tarefaEscalas(tipo, dias) });

      case "hoje":
        return Response.json({ tipo, ...await tarefaHoje(Number(body.janela ?? 150)) });

      case "buracos":
        return Response.json({ tipo, dias, ...await tarefaBuracos(dias) });

      case "trocas-paradas":
        return Response.json({ tipo, dias, ...await tarefaTrocasParadas(dias) });

      case "teste": {
        const aparelhos = await enviarPara(String(body.perfil ?? ""), {
          titulo: "Escala da Equipe",
          corpo: "Teste do envio automático. Se você está lendo isso, funcionou.",
          tag: "teste",
          url: "./index.html",
        });
        return Response.json({ tipo, aparelhos });
      }

      default:
        return Response.json({
          erro: `tipo desconhecido: ${tipo}`,
          tipos: ["avisos", "convocacao", "lembrete", "hoje", "buracos", "trocas-paradas", "teste"],
        }, { status: 400 });
    }
  } catch (e) {
    const msg = (e as { message?: string }).message ?? String(e);
    console.error(`[${tipo}] ${msg}`);
    return Response.json({ tipo, erro: msg }, { status: 500 });
  }
});
