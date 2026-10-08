/* ═══════════════════════════════════════════════════════════════
   Painel de Produtividade — Viavoz
   SOMENTE LEITURA: este arquivo nunca faz insert, update ou delete.
   Toda consulta ao banco é .select(). Confira com Ctrl+F.
   ═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://tvvxiypewbephjvonwds.supabase.co';
const SUPABASE_KEY = 'sb_publishable_t5s5ev6j_npbkE9DokHPAA_5ILdCtiy';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ───────────────────────────────────────────────────────────────
   1. TIPO DE HORA
   A tabela `registros` não tem campo de tipo. O painel antigo
   comparava o nome da obra com uma lista fixa, então "FÉRIAS",
   "Ferias " e "FERIAS 2026" viravam coisas diferentes e entravam
   como produtivas. Aqui o nome é normalizado antes de comparar.
   ─────────────────────────────────────────────────────────────── */
const TIPOS = {
  // grupo:      prod  = trabalho em projeto
  //             indir = trabalho, mas não em projeto
  //             absen = a pessoa não trabalhou, e a empresa pagou
  //             fora  = não é tempo da empresa nem custo — sai de todas as contas
  PRODUTIVA:       { nome: 'Produtiva',       grupo: 'prod',  contaTempo: true,  geraCusto: true  },
  GESTAO:          { nome: 'Gestão',          grupo: 'indir', contaTempo: true,  geraCusto: true  },
  REUNIAO:         { nome: 'Reunião',         grupo: 'indir', contaTempo: true,  geraCusto: true  },
  SERVICO_INTERNO: { nome: 'Serviço Interno', grupo: 'indir', contaTempo: true,  geraCusto: true  },
  SERVICO_EXTERNO: { nome: 'Serviço Externo', grupo: 'indir', contaTempo: true,  geraCusto: true  },
  TREINAMENTO:     { nome: 'Treinamento',     grupo: 'indir', contaTempo: true,  geraCusto: true  },
  ATESTADO:        { nome: 'Atestado',        grupo: 'absen', contaTempo: false, geraCusto: true  },
  FALTA:           { nome: 'Falta',           grupo: 'absen', contaTempo: false, geraCusto: true  },
  FERIAS:          { nome: 'Férias',          grupo: 'fora',  contaTempo: false, geraCusto: false },
  FERIADO:         { nome: 'Feriado',         grupo: 'fora',  contaTempo: false, geraCusto: false },
};

function normalizar(t) {
  return (t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // tira acento
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function classificarTipo(obra) {
  const o = normalizar(obra);
  if (!o) return 'PRODUTIVA';
  if (o.startsWith('FERIAS'))         return 'FERIAS';
  if (o.startsWith('ATESTADO'))       return 'ATESTADO';
  if (o.startsWith('FERIADO'))        return 'FERIADO';
  if (o.startsWith('FALTA'))          return 'FALTA';
  if (o.startsWith('TREINAMENTO'))    return 'TREINAMENTO';
  if (o.startsWith('REUNIAO'))        return 'REUNIAO';
  if (o.startsWith('GESTAO'))         return 'GESTAO';
  if (/^SERVICOS? INTERNOS?/.test(o)) return 'SERVICO_INTERNO';
  if (/^SERVICOS? EXTERNOS?/.test(o)) return 'SERVICO_EXTERNO';
  return 'PRODUTIVA';
}

// "obra de verdade" — o que conta como projeto ao somar nº de obras
const ehProjetoReal = (r) => TIPOS[r._tipo].grupo === 'prod';

// líder fica fora de tudo — ver separarLideres()
const ehLider = (nome) => !!(S.lideres && S.lideres.nomes.has(nome));

/* ───────────────────────────────────────────────────────────────
   2. FORMATAÇÃO
   ─────────────────────────────────────────────────────────────── */
const fmtH   = (h) => (h || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtN   = (n) => (n || 0).toLocaleString('pt-BR');
const fmtPct = (v) => (isFinite(v) ? (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0') + '%';
const fmtData = (iso) => { if (!iso) return ''; const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const rotuloMes = (ym) => MESES[+ym.slice(5,7) - 1] + '/' + ym.slice(2,4);
const isoDe = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// O Registro de Horas mostra hora como HH:MM (4858:17), não decimal (4858,3).
// No modo "igual ao sistema" o painel usa o mesmo formato, para a comparação
// visual ser direta.
const fmtHM = (h) => {
  const v = Math.abs(h || 0);
  const inteiras = Math.floor(v);
  const min = Math.round((v - inteiras) * 60);
  const ajuste = min === 60 ? 1 : 0;
  return (h < 0 ? '-' : '') + (inteiras + ajuste) + ':' +
         String(ajuste ? 0 : min).padStart(2, '0');
};
// O painel mostra hora no mesmo formato em que ela é lançada: 4:40, não 4,7.
// Decimal confunde — 40 minutos viram 0,6667, que arredondado vira 0,7 e
// parece "4 horas e 42 minutos". Onde o número entra em conta (médias,
// percentuais, custo), o valor cheio continua sendo usado por baixo.
const fmtHoras = (h) => fmtHM(h);

// Os 5 rótulos que o Registro de Horas trata como "obra especial" e exclui.
// Ele conta SERVICO INTERNO, REUNIAO GERAL e SERVICOS EXTERNOS como obras
// normais — o painel, por padrão, não. No modo "igual ao sistema", conta.
const ESPECIAIS_DO_SISTEMA = new Set(['ATESTADO','FALTA','FERIADO','FERIAS','REUNIAO DE EQUIPE']);
const contaComoObra = (r) => S.modoSistema
  ? !ESPECIAIS_DO_SISTEMA.has((r.obra || '').trim())
  : ehProjetoReal(r);

const PALETA = ['#4A90D9','#D68B3C','#6BA87F','#C9595E','#8E7BA6','#4E9B92','#C2703F','#3A6FA8','#9A8055','#7C8899','#6FA3DC','#A85055'];

/* ───────────────────────────────────────────────────────────────
   3. ESTADO
   ─────────────────────────────────────────────────────────────── */
const S = {
  usuario: null, perfil: null, admin: false,
  linhas: [], atualizadoEm: null,
  aba: null, ordem: {}, pagina: {}, graficos: [],
  atalhoPeriodo: '', diaDoAtalho: '',   // para recalcular quando o dia virar
  timerAtualizar: null, ocultoDesde: 0,
  canalRealtime: null, aoVivo: false, ultimoEventoEm: null, debounceRealtime: null,
  perfis: [],   // quem deveria lançar — inclui quem nunca lançou nada
  obras: {},    // cadastro das obras: status, prazo, valor de contrato…
  integridade: null,   // confere se veio do banco tudo o que ele diz ter
  modoSistema: false,  // exibir com os mesmos critérios do Registro de Horas
  colisoesCadastro: [],
  nomesUnificados: [],   // pessoas que trocaram de nome no cadastro
  editandoAumento: null, // nome de quem está com o formulário de aumento aberto
  custoNaTela: null,     // lista de nomes visível na aba Custo/Hora
  lideres: null,         // quem fica fora das contas
  filtros: { de:'', ate:'', colab:'', setor:'', obra:'', disc:'', tipo:'', busca:'' },
  obrasSel: new Set(),   // filtro de obra aceita várias ao mesmo tempo
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function carregando(on, txt) {
  $('#carregando').classList.toggle('oculto', !on);
  if (txt) $('#carregando-txt').textContent = txt;
}

/* ───────────────────────────────────────────────────────────────
   3b. CUSTO/HORA  — dado sensível, tratado como tal

   Valor/hora é salário. Ele NÃO fica em nenhum arquivo do site:
   se ficasse, ao publicar no GitHub Pages qualquer pessoa na
   internet leria os salários da empresa.

   Onde fica: no navegador de quem cadastrou (localStorage), que é
   por pessoa e por máquina. Para passar de um gestor para outro,
   use Exportar/Importar — o arquivo gerado fica no computador, e
   NUNCA deve ser colocado na pasta do site nem enviado ao GitHub.

   O lugar certo para isso é uma tabela no banco com acesso restrito
   a admin (ver ../sql/03_custos_hora.sql). Enquanto o banco não for
   alterado, este é o menos pior.
   ─────────────────────────────────────────────────────────────── */
const CUSTOS = {
  CHAVE: 'viavoz_custo_hora',
  mapa: {},

  /* ── FORMATO GRAVADO ──────────────────────────────────────────
     Dois formatos convivem de propósito, e o antigo continua válido:

       "FULANO":  95                                    valor único
       "CICLANO": [ {v:80}, {v:100, de:"2026-09-01"} ]   com aumento

     Quem nunca cadastrar aumento nunca vê a segunda forma, e o
     arquivo exportado antes desta mudança continua importando.

     A entrada SEM `de` é o valor base: vale para tudo que vier antes
     da primeira data. É ela que o campo da tela edita, e é ela que o
     preenchimento em massa mexe — assim nenhum histórico é apagado
     por engano ao aplicar um valor para todo mundo. */

  carregar() {
    try {
      const bruto = localStorage.getItem(this.CHAVE)
                 || localStorage.getItem('custo_hora_colaboradores'); // painel antigo
      this.mapa = bruto ? JSON.parse(bruto) : {};
    } catch (e) { this.mapa = {}; }
    return this.mapa;
  },

  salvar() {
    try { localStorage.setItem(this.CHAVE, JSON.stringify(this.mapa)); }
    catch (e) { alert('Não foi possível salvar neste navegador.'); }
  },

  // sempre devolve a lista de faixas, mesmo quando o gravado é um número
  faixas(nome) {
    const g = this.mapa[nome];
    if (g == null) return [];
    if (typeof g === 'number') return [{ v: g }];
    if (Array.isArray(g)) return g.filter(f => f && isFinite(Number(f.v)) && Number(f.v) > 0);
    return [];
  },

  // só as faixas com data, da mais nova para a mais antiga
  aumentos(nome) {
    return this.faixas(nome).filter(f => f.de)
      .sort((a, b) => String(b.de).localeCompare(String(a.de)));
  },

  base(nome) {
    const f = this.faixas(nome).find(x => !x.de);
    return f ? Number(f.v) : 0;
  },

  /* Valor que valia naquele dia.
     Sem data, devolve o mais recente — é o que as telas de conferência
     ("essa pessoa já tem valor?") precisam. */
  valorDe(nome, data) {
    const fs = this.faixas(nome);
    if (!fs.length) return 0;
    if (!data) {
      const comData = fs.filter(f => f.de).sort((a, b) => String(a.de).localeCompare(String(b.de)));
      return Number((comData.length ? comData[comData.length - 1] : fs.find(f => !f.de) || fs[0]).v) || 0;
    }
    let escolhida = fs.find(f => !f.de) || null;
    for (const f of fs) {
      if (!f.de || String(f.de) > String(data)) continue;
      if (!escolhida || !escolhida.de || String(f.de) > String(escolhida.de)) escolhida = f;
    }
    return escolhida ? Number(escolhida.v) || 0 : 0;
  },

  // grava o valor BASE, preservando os aumentos já cadastrados
  definir(nome, valor) {
    const v = Number(String(valor).replace(',', '.'));
    const aum = this.aumentos(nome);
    if (!valor || !isFinite(v) || v <= 0) {
      if (aum.length) this.mapa[nome] = aum;        // some o base, ficam os aumentos
      else delete this.mapa[nome];
    } else if (aum.length) {
      this.mapa[nome] = [{ v }, ...aum];
    } else {
      this.mapa[nome] = v;                          // forma simples, igual a antes
    }
    this.salvar();
  },

  // acrescenta (ou substitui) um aumento com data
  definirAumento(nome, valor, de) {
    const v = Number(String(valor).replace(',', '.'));
    if (!isFinite(v) || v <= 0 || !de) return false;
    const base = this.base(nome);
    const aum  = this.aumentos(nome).filter(f => f.de !== de);
    const lista = (base ? [{ v: base }] : []).concat(aum, [{ v, de }]);
    this.mapa[nome] = lista;
    this.salvar();
    return true;
  },

  tirarAumento(nome, de) {
    const base = this.base(nome);
    const aum  = this.aumentos(nome).filter(f => f.de !== de);
    if (!aum.length) { if (base) this.mapa[nome] = base; else delete this.mapa[nome]; }
    else this.mapa[nome] = (base ? [{ v: base }] : []).concat(aum);
    this.salvar();
  },

  /* Média ponderada pelas horas de cada faixa — o "valor único" que
     alguém pode pedir para reportar, sem o painel deixar de calcular
     certo por dentro. Devolve 0 se a pessoa não tem aumento. */
  mediaPonderada(nome, linhas) {
    if (!this.aumentos(nome).length) return 0;
    let horas = 0, total = 0;
    for (const r of linhas) {
      if (r.colaborador !== nome || !TIPOS[r._tipo].geraCusto) continue;
      horas += r.horas;
      total += r.horas * this.valorDe(nome, r.data);
    }
    return horas ? total / horas : 0;
  },

  quantos() { return Object.keys(this.mapa).length; },

  exportar() {
    const conteudo = JSON.stringify(this.mapa, null, 2);
    const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custo-hora-CONFIDENCIAL-' + isoDe(new Date()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  importar(arquivo, aoTerminar) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const obj = JSON.parse(leitor.result);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('formato');
        let n = 0;
        for (const k of Object.keys(obj)) {
          const g = obj[k];
          if (typeof g === 'number' && isFinite(g) && g > 0) { this.mapa[k] = g; n++; }
          else if (Array.isArray(g)) {
            const limpa = g.filter(f => f && isFinite(Number(f.v)) && Number(f.v) > 0)
                           .map(f => (f.de ? { v: Number(f.v), de: String(f.de) } : { v: Number(f.v) }));
            if (limpa.length) { this.mapa[k] = limpa; n++; }
          }
        }
        this.salvar();
        alert(n + ' colaborador(es) importado(s).');
        aoTerminar();
      } catch (e) {
        alert('Arquivo inválido. Use um arquivo gerado pelo botão Exportar.');
      }
    };
    leitor.readAsText(arquivo);
  },

  limpar() {
    if (!confirm('Apagar todos os valores/hora deste navegador?')) return false;
    this.mapa = {};
    try { localStorage.removeItem(this.CHAVE); } catch (e) {}
    return true;
  },
};

/* O cadastro de obras guarda valor como TEXTO no formato brasileiro
   ('R$ 2.154.125,51'), porque o campo tem mascara no outro sistema.
   Number() nisso devolve NaN — era por isso que o "% consumido" nao
   aparecia. Aqui o texto vira numero de verdade. */
const numBRL = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let t = String(v).replace(/[^\d.,-]/g, '').trim();
  if (!t) return 0;
  if (t.includes(','))                          t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t))    t = t.replace(/\./g, '');
  const n = Number(t);
  return isFinite(n) ? n : 0;
};

const fmtBRL = (v) => (v || 0).toLocaleString('pt-BR',
  { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtBRL2 = (v) => (v || 0).toLocaleString('pt-BR',
  { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ───────────────────────────────────────────────────────────────
   4. AUTENTICAÇÃO
   ─────────────────────────────────────────────────────────────── */
async function entrar(e) {
  e.preventDefault();
  const email = $('#in-email').value.trim();
  const senha = $('#in-senha').value;
  const btn = $('#btn-entrar'), err = $('#erro-login');
  btn.disabled = true; btn.textContent = 'Entrando…'; err.classList.add('oculto');

  const { error } = await sb.auth.signInWithPassword({ email, password: senha });

  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) {
    err.textContent = /invalid/i.test(error.message)
      ? 'E-mail ou senha incorretos.' : error.message;
    err.classList.remove('oculto');
    return;
  }
  await iniciarSessao();
}

async function sair() {
  desligarRealtime();
  await sb.auth.signOut();
  location.reload();
}

async function iniciarSessao() {
  carregando(true, 'Entrando…');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { carregando(false); return false; }

  S.usuario = session.user;

  const { data: perfil } = await sb.from('profiles')
    .select('id,nome,setor,is_admin').eq('id', S.usuario.id).maybeSingle();

  S.perfil = perfil || { nome: S.usuario.email, setor: null, is_admin: false };
  S.admin  = S.perfil.is_admin === true;

  $('#tela-login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  $('#selo-papel').textContent = S.admin ? 'Administrador' : (S.perfil.nome || 'Colaborador');
  $('#selo-papel').classList.toggle('admin', S.admin);
  $$('.so-admin').forEach(el => el.classList.toggle('oculto', !S.admin));

  montarAbas();
  await carregarDados();
  ligarAtualizacaoAutomatica();
  ligarRealtime();
  return true;
}

/* ───────────────────────────────────────────────────────────────
   5. LEITURA DOS DADOS  (apenas .select)
   Funcionário comum: só os próprios registros.
   Admin: todos. Em ambos os casos quem decide de verdade é o banco
   — se a RLS liberar mais do que deveria, o filtro daqui é cosmético.
   ─────────────────────────────────────────────────────────────── */
async function carregarDados(silencioso) {
  revalidarPeriodo();
  if (!silencioso) carregando(true, 'Lendo registros…');
  const PAG = 1000;
  let todos = [], de = 0;

  // Quantos registros o banco diz ter — para conferir no fim se veio tudo.
  let totalNoBanco = null;
  try {
    let qc = sb.from('registros').select('id', { count: 'exact', head: true });
    if (!S.admin) qc = qc.eq('user_id', S.usuario.id);
    const { count } = await qc;
    totalNoBanco = count;
  } catch (e) { /* segue mesmo sem a contagem */ }

  try {
    while (true) {
      // Como paginar — e as duas opções dão resultados diferentes de propósito:
      //
      // `id`   (padrão): coluna única, sem empate. A paginação é estável e
      //                  vem exatamente uma cópia de cada lançamento.
      // `data` (modo "igual ao sistema"): é o que o Registro de Horas faz.
      //                  `data` repete centenas de vezes; o Postgres não
      //                  garante a ordem entre linhas empatadas de uma
      //                  consulta para outra, e cada página é uma consulta
      //                  nova. Assim algumas linhas vêm duas vezes e outras
      //                  não vêm — que é justamente o que reproduz os números
      //                  daquele sistema.
      const colunaOrdem = S.modoSistema ? 'data' : 'id';
      let q = sb.from('registros')
        .select('id,user_id,colaborador,obra,data,horas,hora_str,obs,setor,disciplina,tarefa,created_at')
        .order(colunaOrdem, { ascending: !S.modoSistema })
        .range(de, de + PAG - 1);

      if (!S.admin) q = q.eq('user_id', S.usuario.id);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      todos = todos.concat(data);
      if (data.length < PAG) break;
      de += PAG;
      if (!silencioso) carregando(true, 'Lendo registros… ' + fmtN(todos.length));
    }
  } catch (err) {
    carregando(false);
    alert('Não foi possível ler os registros:\n' + (err.message || err));
    return;
  }

  // Conta as repetidas sempre; só REMOVE fora do modo "igual ao sistema".
  // No modo sistema elas ficam, porque são elas que fazem o total bater com
  // a tela do Registro de Horas.
  const vistos = new Set();
  const unicos = [];
  let repetidos = 0;
  for (const r of todos) {
    if (vistos.has(r.id)) { repetidos++; continue; }
    vistos.add(r.id); unicos.push(r);
  }
  if (!S.modoSistema) todos = unicos;

  S.integridade = {
    totalNoBanco, carregados: todos.length, repetidos,
    unicos: vistos.size,
    perdidos: totalNoBanco === null ? null : totalNoBanco - vistos.size,
    // no modo sistema a divergência é esperada — é o que se quer reproduzir
    ok: S.modoSistema || totalNoBanco === null || totalNoBanco === todos.length,
  };
  if (!S.integridade.ok) {
    console.warn('Divergência ao ler registros:', S.integridade);
  }

  // enriquece cada linha uma vez só
  S.linhas = todos.map(r => {
    const tipo = classificarTipo(r.obra);
    // _atraso = dias entre o dia trabalhado e o dia em que foi digitado.
    // É o que revela lançamento retroativo — o motivo de um mês já fechado
    // mudar de valor depois.
    const criado = r.created_at ? String(r.created_at).slice(0, 10) : null;
    const atraso = (criado && r.data)
      ? Math.round((new Date(criado + 'T12:00:00') - new Date(r.data + 'T12:00:00')) / 86400000)
      : null;
    return Object.assign({}, r, {
      horas: Number(r.horas) || 0,
      _tipo: tipo,
      _contaTempo: TIPOS[tipo].contaTempo,
      _mes:  (r.data || '').slice(0, 7),
      _criadoEm:  criado,
      _mesCriado: criado ? criado.slice(0, 7) : null,
      _atraso:    atraso,
    });
  });

  await carregarPerfis();
  unificarNomes();
  separarLideres();
  await carregarObras();

  S.atualizadoEm = new Date();
  preencherFiltros();
  // Não redesenha por cima de quem está digitando o custo/hora:
  // o render recria os campos e a pessoa perderia o que escreveu.
  const digitando = document.activeElement && document.activeElement.classList.contains('cst-in');
  if (!(silencioso && digitando)) render();
  carregando(false);
}

/* Cadastro das obras.
   A tabela `registros` só guarda o NOME da obra digitado. Todo o resto —
   status, prazo, valor de contrato, responsável — está na tabela `obras`,
   que o painel ignorava. É daí que sai o "controle maior": com o valor do
   contrato e o custo das horas dá para ver quanto de cada obra já foi
   consumido em mão de obra.

   O join é por NOME, não por id, porque é assim que `registros` referencia
   a obra. Nome digitado diferente não casa — a aba Alertas mostra esses casos. */
async function carregarObras() {
  const { data, error } = await sb.from('obras').select('*');
  if (error) { console.warn('Não foi possível ler o cadastro de obras:', error); S.obras = {}; return; }
  const mapa = {};
  const colisoes = [];
  for (const o of (data || [])) {
    if (!o.nome) continue;
    if (o.ativo === false) continue;
    const chave = normalizar(o.nome);
    // Duas obras DIFERENTES no cadastro que só diferem por acento ou espaço
    // colidiriam aqui, e uma sumiria da contagem. Registra em vez de engolir.
    if (mapa[chave] && mapa[chave].id !== o.id) {
      colisoes.push([mapa[chave].nome, o.nome]);
    }
    mapa[chave] = o;
  }
  S.obras = mapa;
  S.colisoesCadastro = colisoes;
  if (colisoes.length) console.warn('Obras com nome equivalente no cadastro:', colisoes);
}

function obraCadastrada(nome) {
  const o = S.obras[normalizar(nome)];
  return (o && o.ativo !== false) ? o : null;
}

/* Lista de quem deveria estar lançando.
   Sem isto, quem NUNCA lançou nada simplesmente não existe para o painel:
   a tabela `registros` só conhece quem já lançou alguma vez — e é
   exatamente essa pessoa que mais interessa encontrar. */
async function carregarPerfis() {
  if (!S.admin) { S.perfis = []; return; }
  const { data, error } = await sb.from('profiles')
    .select('id,nome,setor,is_admin,status')
    .order('nome');
  if (error) { console.warn('Não foi possível ler a lista de colaboradores:', error); S.perfis = []; return; }
  // Guarda TODOS, inclusive os inativos: a aba Cobertura precisa saber
  // quem saiu da empresa para NAO cobrar lancamento dessa pessoa, e ainda
  // assim conseguir listar o quadro inteiro.
  S.perfis = (data || []).filter(p => p.nome);
}

/* ── LÍDERES ──────────────────────────────────────────────────────
   Decisão de 07/10/2026: líder fica FORA DE TUDO — não aparece em
   produtividade, não entra em custo, não é cobrado de lançamento, e as
   horas dele não contam para a obra.

   A lista mora aqui no arquivo, de propósito. Em localStorage ela
   divergiria de máquina para máquina, do mesmo jeito que o custo/hora
   diverge hoje. Nome de líder não é confidencial, então pode ficar no
   código: todo mundo que abre o painel vê a mesma regra. Para mudar,
   edite esta lista e publique o arquivo.

   Conferido no cadastro em 07/10/2026: só 3 destes 21 existem no
   Registro de Horas (FELIPE MERLO, HEWILLIM DIAS, RICHARD RODRIGUES), e
   os 3 com zero hora lançada. Os outros 18 não têm cadastro — estão
   nesta lista para o dia em que entrarem.

   No modo "igual ao sistema" a exclusão NÃO acontece: lá o objetivo é
   reproduzir o Registro de Horas, que não conhece o conceito de líder.
   ─────────────────────────────────────────────────────────────── */
const LIDERES = [
  'ISABELA FARIA', 'GABRIELA FONSECA', 'FELIPE MERLO', 'HEWILLIM', 'JUSCILEIA',
  'GLENDA', 'ISAURA', 'SINVAL', 'MARINA LADEIRA', 'RICHARD', 'CAMILA GARCIA',
  'GABRIEL MACHADO', 'CAIO CARVALHO', 'LEONARDO PALHARES',
  'FILIPE MENDES', 'BERNARDO', 'ARTHUR REIS', 'ANA CAROLINA SOTERO',
  'PEDRO HELIODORO', 'RONAM',

  // Quem VIROU líder entra com a data: as horas de antes continuam valendo,
  // porque foram trabalho real em projeto. Só o que vem a partir da data sai.
  // Sem isso, promover alguém apagaria o histórico dela das obras.
  { nome: 'DEBORA DIAS', desde: '2026-08-01' },
];

/* Casa a lista com os nomes reais do cadastro.

   A regra é: todos os pedaços do nome escrito na lista precisam existir
   no nome cadastrado. Assim 'HEWILLIM' acha 'HEWILLIM DIAS', mas
   'CAMILA GARCIA' NÃO acha 'CAMILA VIANA' — que é uma pessoa diferente.

   Se uma entrada casar com DUAS pessoas, ninguém é excluído e o caso vai
   para a aba Alertas. Tirar a pessoa errada das contas em silêncio seria
   muito pior do que deixar um líder dentro por mais um dia. */
function resolverLideres() {
  const alvo = new Set();
  const ambiguos = [];
  const semCadastro = [];

  const nomes = S.perfis.map(p => p.nome).filter(Boolean);
  const desdeDe = new Map();   // nome real -> data a partir da qual é líder

  for (const item of LIDERES) {
    const bruto = typeof item === 'string' ? item : item.nome;
    const desde = typeof item === 'string' ? null : (item.desde || null);
    const pedacos = normalizar(bruto).split(' ').filter(Boolean);
    const achados = nomes.filter(n => {
      const toks = normalizar(n).split(' ');
      return pedacos.every(t => toks.includes(t));
    });
    if (achados.length === 1) { alvo.add(achados[0]); desdeDe.set(achados[0], desde); }
    else if (achados.length > 1) ambiguos.push({ chave: bruto, candidatos: achados.join('  ·  '), qtd: achados.length });
    else                         semCadastro.push(bruto);
  }
  return { nomes: alvo, desdeDe, ambiguos, semCadastro };
}

/* Tira os líderes de S.linhas e guarda o que foi tirado, para a tela
   poder dizer em voz alta quanto saiu das contas. */
function separarLideres() {
  S.lideres = { nomes: new Set(), desdeDe: new Map(), ambiguos: [],
                semCadastro: [], n: 0, horas: 0, porPessoa: [] };
  if (S.modoSistema || !S.perfis.length) return;

  const r = resolverLideres();
  S.lideres.nomes       = r.nomes;
  S.lideres.desdeDe     = r.desdeDe;
  S.lideres.ambiguos    = r.ambiguos;
  S.lideres.semCadastro = r.semCadastro;
  if (!r.nomes.size) return;

  // Quem tem data de corte só sai a partir dela: o que veio antes é trabalho
  // de projeto de verdade e continua contando para a obra, para o setor e
  // para o custo daquele período.
  const fora = [];
  const dentro = [];
  for (const l of S.linhas) {
    if (!r.nomes.has(l.colaborador)) { dentro.push(l); continue; }
    const desde = r.desdeDe.get(l.colaborador);
    (!desde || (l.data && l.data >= desde) ? fora : dentro).push(l);
  }
  S.linhas = dentro;

  const porPessoa = new Map();
  const novo = (nome) => ({
    chave: nome, n: 0, horas: 0,
    desde: r.desdeDe.get(nome) || '',
    mantidas: 0, horasMantidas: 0,
  });
  for (const l of fora) {
    if (!porPessoa.has(l.colaborador)) porPessoa.set(l.colaborador, novo(l.colaborador));
    const p = porPessoa.get(l.colaborador);
    p.n++; p.horas += l.horas;
  }
  // líder cadastrado que nunca lançou também aparece, com zero
  r.nomes.forEach(n => { if (!porPessoa.has(n)) porPessoa.set(n, novo(n)); });
  // e o que ficou DENTRO das contas, no caso de quem virou líder depois
  for (const l of S.linhas) {
    if (!r.nomes.has(l.colaborador)) continue;
    const p = porPessoa.get(l.colaborador);
    if (p) { p.mantidas++; p.horasMantidas += l.horas; }
  }

  S.lideres.n        = fora.length;
  S.lideres.horas    = fora.reduce((s, l) => s + l.horas, 0);
  S.lideres.porPessoa = [...porPessoa.values()];
}


/* ── IDENTIDADE DA PESSOA ─────────────────────────────────────────
   `registros.colaborador` guarda o nome COPIADO no instante do
   lançamento. Quando alguém muda o nome no cadastro — casou, trocou de
   equipe, completou o sobrenome — os lançamentos antigos ficam com o
   nome velho e a pessoa vira duas no painel: dois cartões, duas linhas
   na cobertura, as horas partidas ao meio. Pior: o nome antigo "para de
   lançar" e aparece como gente atrasada que na verdade está em dia.

   O que não muda é o `user_id`. Medido no banco em 07/10/2026: 11.691
   registros, TODOS com user_id, e nenhum nome aparecendo em duas contas
   diferentes. Então user_id é identidade confiável, e o nome de exibição
   passa a ser o que está no cadastro hoje.

   O nome gravado não é apagado — fica em `_nomeOriginal`, e a aba
   Alertas lista quem foi unificado, com quantos lançamentos de cada lado.

   No modo "igual ao sistema" nada disso acontece: lá o objetivo é
   reproduzir o Registro de Horas, que agrupa pelo texto do nome e
   portanto mostra a pessoa duas vezes.
   ─────────────────────────────────────────────────────────────── */
function unificarNomes() {
  S.nomesUnificados = [];
  if (S.modoSistema || !S.perfis.length) return;

  const atual = new Map();
  S.perfis.forEach(p => { if (p.id && p.nome) atual.set(p.id, p.nome); });

  const trocas = new Map();
  for (const r of S.linhas) {
    const nome = atual.get(r.user_id);
    if (!nome || nome === r.colaborador) continue;

    const chave = r.colaborador + String.fromCharCode(1) + nome;
    if (!trocas.has(chave)) {
      trocas.set(chave, { chave: r.colaborador, para: nome, n: 0, horas: 0,
                          primeiro: r.data, ultimo: r.data, setores: new Set() });
    }
    const t = trocas.get(chave);
    t.n++; t.horas += r.horas;
    if (r.data && r.data < t.primeiro) t.primeiro = r.data;
    if (r.data && r.data > t.ultimo)   t.ultimo   = r.data;
    if (r.setor) t.setores.add(r.setor);

    r._nomeOriginal = r.colaborador;
    r.colaborador   = nome;
  }

  S.nomesUnificados = [...trocas.values()]
    .map(t => Object.assign(t, { setor: [...t.setores].join(', ') || '—' }));
}


/* ───────────────────────────────────────────────────────────────
   6. FILTROS
   ─────────────────────────────────────────────────────────────── */
/* Etiquetas das obras escolhidas.
   Com 296 obras, um <select multiple> seria impraticável — a pessoa teria
   que segurar Ctrl e rolar. Aqui o select continua simples: escolher
   adiciona à lista, e cada escolha vira uma etiqueta que dá para remover. */
function desenharChipsObra() {
  const caixa = $('#chips-obra');
  if (!caixa) return;
  const n = S.obrasSel.size;
  caixa.classList.toggle('oculto', !n);
  if (!n) { caixa.innerHTML = ''; return; }
  caixa.innerHTML =
    [...S.obrasSel].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(o =>
      '<span class="chip">' + esc(o) +
      '<button type="button" class="chip-x" data-tirar-obra="' + esc(o) + '" ' +
      'title="Tirar do filtro" aria-label="Tirar ' + esc(o) + ' do filtro">✕</button></span>').join('') +
    (n > 1 ? '<button type="button" class="chip-limpar" id="btn-limpar-obras">' +
             'limpar as ' + n + '</button>' : '');
}

function preencherFiltros() {
  const unicos = (f) => [...new Set(S.linhas.map(f).filter(Boolean))]
    .sort((a,b) => String(a).localeCompare(String(b), 'pt-BR'));

  const encher = (sel, itens, rotuloVazio) => {
    const el = $(sel); if (!el) return;
    const atual = el.value;
    el.innerHTML = '<option value="">' + rotuloVazio + '</option>' +
      itens.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    if (itens.includes(atual)) el.value = atual;
  };

  encher('#f-colab', unicos(r => r.colaborador), 'todos os colaboradores');
  encher('#f-setor', unicos(r => r.setor),       'todos os setores');
  encher('#f-obra',  unicos(r => r.obra),        'todas as obras');
  encher('#f-disc',  unicos(r => r.disciplina),  'todas as disciplinas');

  const tiposPresentes = [...new Set(S.linhas.map(r => r._tipo))]
    .sort((a,b) => TIPOS[a].nome.localeCompare(TIPOS[b].nome, 'pt-BR'));
  $('#f-tipo').innerHTML = '<option value="">todos os tipos de hora</option>' +
    tiposPresentes.map(t => '<option value="' + t + '">' + TIPOS[t].nome + '</option>').join('');
}

function lerFiltros() {
  S.filtros = {
    de:    $('#f-de').value,
    ate:   $('#f-ate').value,
    colab: $('#f-colab').value,
    setor: $('#f-setor').value,
    obra:  $('#f-obra').value,   // mantido: a seleção múltipla vive em S.obrasSel
    disc:  $('#f-disc').value,
    tipo:  $('#f-tipo').value,
    busca: normalizar($('#f-busca').value),
  };
}

function filtrar() {
  const f = S.filtros;
  return S.linhas.filter(r => {
    if (f.de    && r.data < f.de)             return false;
    if (f.ate   && r.data > f.ate)            return false;
    if (f.colab && r.colaborador !== f.colab) return false;
    if (f.setor && r.setor !== f.setor)       return false;
    // obra aceita várias: vazio = todas; com itens = união do que foi marcado
    if (S.obrasSel.size && !S.obrasSel.has(r.obra)) return false;
    if (f.disc  && r.disciplina !== f.disc)   return false;
    if (f.tipo  && r._tipo !== f.tipo)        return false;
    if (f.busca && !normalizar(r.tarefa + ' ' + r.obs + ' ' + r.obra).includes(f.busca)) return false;
    return true;
  });
}

function aplicarAtalhoPeriodo(v) {
  const hoje = new Date();
  let de = '', ate = '';
  if (v === 'mes')   { de = isoDe(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); ate = isoDe(hoje); }
  if (v === 'mes-1') { de = isoDe(new Date(hoje.getFullYear(), hoje.getMonth()-1, 1));
                       ate = isoDe(new Date(hoje.getFullYear(), hoje.getMonth(), 0)); }
  if (v === '90')    { const d = new Date(hoje); d.setDate(d.getDate()-90); de = isoDe(d); ate = isoDe(hoje); }
  if (v === 'ano')   { de = hoje.getFullYear() + '-01-01'; ate = isoDe(hoje); }
  if (v === 'tudo')  { de = ''; ate = ''; }
  $('#f-de').value = de; $('#f-ate').value = ate;
  S.atalhoPeriodo = v;
  S.diaDoAtalho   = isoDe(hoje);
}

/* Atalhos como "Este mês" gravam uma data final FIXA. Com a aba aberta
   da véspera, o filtro continuava terminando ontem e os lançamentos de
   hoje ficavam invisíveis — mesmo depois de recarregar do banco.
   Isto refaz a conta quando o dia vira. Devolve true se mudou algo. */
function revalidarPeriodo() {
  if (!S.atalhoPeriodo || S.atalhoPeriodo === 'tudo') return false;
  if (S.diaDoAtalho === isoDe(new Date())) return false;
  aplicarAtalhoPeriodo(S.atalhoPeriodo);
  return true;
}

/* Dias úteis = segunda a sexta. Feriados NÃO são descontados: o painel
   não tem calendário de feriados, então um feriado aparece como dia sem
   lançamento. Por isso a tela de Cobertura trata isso como "a conferir",
   não como falta. */
function ehDiaUtil(iso) {
  const d = new Date(iso + 'T12:00:00');
  const s = d.getDay();
  return s >= 1 && s <= 5;
}

function diasUteisEntre(deISO, ateISO) {
  const dias = [];
  if (!deISO || !ateISO) return dias;
  const d = new Date(deISO + 'T12:00:00'), fim = new Date(ateISO + 'T12:00:00');
  while (d <= fim) {
    const iso = isoDe(d);
    if (ehDiaUtil(iso)) dias.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

function diasUteisDesde(iso) {
  if (!iso) return null;
  const hoje = isoDe(new Date());
  if (iso >= hoje) return 0;
  return Math.max(0, diasUteisEntre(iso, hoje).length - 1);
}

/* ───────────────────────────────────────────────────────────────
   7. AGREGAÇÃO
   ─────────────────────────────────────────────────────────────── */
function resumir(linhas) {
  let prod = 0, indir = 0, absen = 0, fora = 0;
  let custoProd = 0, custoIndir = 0, custoAbsen = 0;
  const colabs = new Set(), obras = new Set(), discs = new Set();

  // Dias LANÇADOS conta dia-por-pessoa, não data do calendário.
  // Contando só a data, quatro pessoas lançando na mesma segunda virariam
  // "1 dia", e a média de horas/dia ficava absurda no total da empresa.
  const diasPessoa = new Set(), diasPessoaAbsen = new Set();
  // Duas contagens de "dias", porque as perguntas são diferentes:
  //   nDias      = dias-pessoa  -> "quantos dias de trabalho essa PESSOA teve"
  //   nDatas     = datas do calendário -> "em quantos dias essa OBRA teve movimento"
  // Misturar as duas fazia a obra aparecer com 666 dias em vez de 90.
  const datas = new Set();
  const SEP = String.fromCharCode(1);

  for (const r of linhas) {
    const t = TIPOS[r._tipo], g = t.grupo;
    const chaveDia = r.colaborador + SEP + r.data;

    if (r.data) datas.add(r.data);

    if (g === 'prod')       { prod  += r.horas; diasPessoa.add(chaveDia); }
    else if (g === 'indir') { indir += r.horas; diasPessoa.add(chaveDia); }
    else if (g === 'absen') { absen += r.horas; diasPessoaAbsen.add(chaveDia); }
    else                    { fora  += r.horas; }   // férias e feriado: fora de tudo

    if (t.geraCusto) {
      // a data importa: se a pessoa teve aumento, cada hora usa o valor
      // que valia no dia em que foi trabalhada
      const vh = CUSTOS.valorDe(r.colaborador, r.data);
      if (vh) {
        const c = r.horas * vh;
        if (g === 'prod')       custoProd  += c;
        else if (g === 'indir') custoIndir += c;
        else                    custoAbsen += c;
      }
    }

    colabs.add(r.colaborador);
    if (r.disciplina) discs.add(r.disciplina);
    if (ehProjetoReal(r) && r.obra) obras.add(r.obra);
  }

  const trabalhadas = prod + indir;          // tempo efetivamente trabalhado
  const horas       = trabalhadas + absen;   // tempo que a empresa pagou
  const custo       = custoProd + custoIndir + custoAbsen;

  return {
    prod, indir, absen, fora, trabalhadas, horas,
    // tudo que foi lançado, férias e feriado inclusive. Serve para telas que
    // listam lançamentos: lá o número tem que ser o que a pessoa digitou.
    horasLancadas: trabalhadas + absen + fora,
    aus: absen,                    // nome antigo, mantido para as telas existentes
    base: trabalhadas,
    custo, custoProd, custoIndir, custoAbsen,
    custoTrabalhado: custoProd + custoIndir,
    custoHora: horas ? custo / horas : 0,
    taxaProd:  trabalhadas ? prod / trabalhadas : 0,
    taxaAbsen: horas ? absen / horas : 0,
    nColabs: colabs.size, nObras: obras.size, nDiscs: discs.size,
    nDias: diasPessoa.size, nDiasAbsen: diasPessoaAbsen.size,
    nDatas: datas.size,
    mediaDia: diasPessoa.size ? trabalhadas / diasPessoa.size : 0,
    n: linhas.length,
  };
}

function agrupar(linhas, chave) {
  const m = new Map();
  for (const r of linhas) {
    const k = chave(r);
    if (k === null || k === undefined || k === '') continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].map(([k, rs]) => Object.assign({ chave: k }, resumir(rs)));
}

function ordenarPor(arr, campo, desc) {
  return [...arr].sort((a, b) => {
    const x = a[campo], y = b[campo];
    const c = (typeof x === 'string') ? x.localeCompare(y, 'pt-BR') : (x - y);
    return desc ? -c : c;
  });
}

/* ───────────────────────────────────────────────────────────────
   8. PEÇAS DE INTERFACE
   ─────────────────────────────────────────────────────────────── */
function kpi(rot, val, sub, cor) {
  return '<div class="kpi"><div class="rot">' + rot + '</div>' +
         '<div class="val ' + (cor || '') + '">' + val + '</div>' +
         (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
}

function secao(titulo, corpo, dica) {
  return '<div class="secao"><h2>' + titulo +
         (dica ? '<span class="dica">' + dica + '</span>' : '') +
         '</h2>' + corpo + '</div>';
}

function box(html)    { return '<div class="box">' + html + '</div>'; }
function grafico(id, alto) {
  return '<div class="gwrap' + (alto ? ' alto' : '') + '"><canvas id="' + id + '"></canvas></div>';
}
function tagTipo(t) {
  return '<span class="tag ' + TIPOS[t].grupo + '">' + TIPOS[t].nome + '</span>';
}

/* Tabela ordenável.
   colunas: [{ rot, campo, tipo:'texto'|'num'|'pct'|'horas'|'data', barra:bool }]
   O tipo 'data' espera o valor em ISO (aaaa-mm-dd): exibe dd/mm/aaaa mas
   ordena pelo ISO, que ordena certo como texto. Formatar antes de ordenar
   colocaria 31/07 na frente de 31/05. */
/* Controle de paginas de uma tabela.
   Mostra sempre a primeira, a ultima e as vizinhas da atual; o resto vira
   reticencia. Sem isso, 300 obras dariam 300 botoes. */
function controlePaginas(id, pag, total, de, ate, n) {
  const faixa = '<span class="pag-faixa">' + fmtN(de + 1) + '–' + fmtN(ate) +
                ' de ' + fmtN(n) + '</span>';
  if (total <= 1) return n > 12 ? '<div class="paginacao">' + faixa + '</div>' : '';

  const btn = (p, rot, extra) =>
    '<button class="pag-btn' + (extra || '') + '" data-tab-pag="' + id + '"' +
    ' data-pag="' + p + '"' + (p === pag ? ' aria-current="page"' : '') +
    (p < 1 || p > total ? ' disabled' : '') + '>' + rot + '</button>';

  const nums = new Set([1, total, pag, pag - 1, pag + 1]);
  if (pag <= 3)         [2, 3, 4].forEach(x => nums.add(x));
  if (pag >= total - 2) [total - 1, total - 2, total - 3].forEach(x => nums.add(x));
  const lista = [...nums].filter(x => x >= 1 && x <= total).sort((a, b) => a - b);

  let meio = '', anterior = 0;
  for (const x of lista) {
    if (anterior && x - anterior > 1) meio += '<span class="pag-gap">…</span>';
    meio += btn(x, x, x === pag ? ' atual' : '');
    anterior = x;
  }

  return '<div class="paginacao">' +
    btn(pag - 1, '‹', ' seta') + meio + btn(pag + 1, '›', ' seta') +
    faixa + '</div>';
}

/* Tabela ordenavel e paginada.
   `porPagina` deixou de cortar a lista: agora e o tamanho da pagina, e
   nenhuma linha fica inacessivel. Passe null para listar tudo de uma vez. */
function tabela(id, colunas, dados, porPagina, ordemPadrao, clicavel) {
  const ord = S.ordem[id] || ordemPadrao ||
    { campo: colunas[1] ? colunas[1].campo : colunas[0].campo, desc: true };
  const ordenadas = ordenarPor(dados, ord.campo, ord.desc);

  const tam   = porPagina || 0;
  const total = tam ? Math.max(1, Math.ceil(ordenadas.length / tam)) : 1;
  // o filtro pode ter encurtado a lista desde o ultimo clique
  let pag = Math.min(Math.max(1, S.pagina[id] || 1), total);
  S.pagina[id] = pag;

  const de    = tam ? (pag - 1) * tam : 0;
  const ate   = tam ? Math.min(de + tam, ordenadas.length) : ordenadas.length;
  const linhas = tam ? ordenadas.slice(de, ate) : ordenadas;

  const max = {};
  colunas.forEach(c => { if (c.barra) max[c.campo] = Math.max(...dados.map(d => d[c.campo] || 0), 0); });

  const alinhaEsq = (t) => t === 'texto' || t === 'data' || t === 'tag' || t === 'livre';
  const cab = colunas.map(c =>
    '<th class="' + (alinhaEsq(c.tipo) ? '' : 'num') + '" data-tab="' + id + '" data-campo="' + c.campo + '">' +
    c.rot + (ord.campo === c.campo ? (ord.desc ? ' ▾' : ' ▴') : '') + '</th>').join('');

  const corpo = linhas.map(d => '<tr' +
    (clicavel ? ' class="linha-clicavel" data-abrir="' + esc(d.chave) + '"' : '') +
    '>' + colunas.map(c => {
    const v = d[c.campo];
    let txt;
    if (c.tipo === 'horas')      txt = fmtHoras(v);
    else if (c.tipo === 'pct')   txt = fmtPct(v);
    else if (c.tipo === 'num')   txt = fmtN(v);
    else if (c.tipo === 'data')  txt = fmtData(v);
    else if (c.tipo === 'brl')   txt = fmtBRL(v);
    else if (c.tipo === 'brl2')  txt = fmtBRL2(v);
    else if (c.tipo === 'tag')   txt = tagTipo(v);
    else                         txt = esc(v);
    let cel = txt;
    if (c.barra && max[c.campo] > 0) {
      cel += '<span class="barra" style="width:' + Math.round((v / max[c.campo]) * 100) + '%"></span>';
    }
    const classe = c.tipo === 'livre' ? 'livre' : (alinhaEsq(c.tipo) ? '' : 'num');
    return '<td class="' + classe + '">' + cel + '</td>';
  }).join('') + '</tr>').join('');

  if (!dados.length) return '<div class="vazio">Nenhum dado no filtro atual.</div>';

  return '<div class="tabela-rolagem"><table><thead><tr>' + cab + '</tr></thead><tbody>' +
         corpo + '</tbody></table></div>' +
         controlePaginas(id, pag, total, de, ate, ordenadas.length);
}

/* ───────────────────────────────────────────────────────────────
   9. GRÁFICOS
   ─────────────────────────────────────────────────────────────── */
function limparGraficos() {
  S.graficos.forEach(g => { try { g.destroy(); } catch (e) {} });
  S.graficos = [];
}

// Apresentacao dos graficos — espelha os tokens de styles.css.
// Nada aqui altera dado ou calculo: so cor, fonte e espacamento.
const FONTE_G = { size: 11, family: "'Inter', -apple-system, sans-serif" };
const EIXO  = { color: '#78849a', font: FONTE_G, padding: 6 };
const GRADE = { color: 'rgba(255,255,255,.05)', drawTicks: false, tickLength: 8 };
const BORDA_EIXO = { display: false };
const LEGENDA = {
  color: '#a3aec1', font: FONTE_G,
  boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 16,
};
const DICA = {
  backgroundColor: 'rgba(19,24,35,.97)',
  borderColor: 'rgba(255,255,255,.15)',
  borderWidth: 1,
  titleColor: '#e9edf5',
  bodyColor: '#a3aec1',
  titleFont: { size: 12, family: "'Inter', sans-serif", weight: '600' },
  bodyFont:  { size: 12, family: "'Inter', sans-serif" },
  padding: 11,
  cornerRadius: 8,
  boxPadding: 5,
  usePointStyle: true,
  displayColors: true,
};

// Padroes globais do Chart.js — valem inclusive para os graficos que
// passam options proprias, onde o Object.assign de desenhar() nao chega.
// Apresentacao apenas: nenhum dado ou calculo e afetado.
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size   = 11;
  Chart.defaults.color       = '#a3aec1';
  Chart.defaults.borderColor = 'rgba(255,255,255,.05)';
  Chart.defaults.datasets.bar.maxBarThickness = 46;
  Chart.defaults.datasets.bar.borderRadius    = 3;
  Chart.defaults.datasets.bar.borderSkipped   = false;
  Object.assign(Chart.defaults.plugins.tooltip, DICA);
  Object.assign(Chart.defaults.plugins.legend.labels, LEGENDA);
}

function desenhar(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  cfg.options = Object.assign({
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 420, easing: 'easeOutQuart' },
    plugins: {
      legend: { labels: LEGENDA },
      tooltip: DICA,
    },
    scales: (cfg.type === 'doughnut' || cfg.type === 'pie') ? undefined : {
      x: { ticks: EIXO, grid: GRADE, border: BORDA_EIXO },
      y: { ticks: EIXO, grid: GRADE, border: BORDA_EIXO, beginAtZero: true },
    },
  }, cfg.options || {});
  S.graficos.push(new Chart(el, cfg));
}

function graficoMensal(id, linhas) {
  const porMes = ordenarPor(agrupar(linhas, r => r._mes), 'chave', false);
  desenhar(id, {
    type: 'bar',
    data: {
      labels: porMes.map(m => rotuloMes(m.chave)),
      datasets: [
        { label: 'Produtiva',          data: porMes.map(m => m.prod),  backgroundColor: '#4A90D9', stack: 'h' },
        { label: 'Indireta',           data: porMes.map(m => m.indir), backgroundColor: '#D68B3C', stack: 'h' },
        { label: 'Falta / atestado',   data: porMes.map(m => m.absen), backgroundColor: '#C9595E', stack: 'h' },
      ],
    },
    options: {
      scales: { x: { stacked: true, ticks: EIXO, grid: { display: false }, border: BORDA_EIXO },
                y: { stacked: true, ticks: EIXO, grid: GRADE, border: BORDA_EIXO, beginAtZero: true } },
      datasets: { bar: { borderRadius: 3, borderSkipped: false, maxBarThickness: 46 } },
    },
  });
}

function graficoRosca(id, itens) {
  desenhar(id, {
    type: 'doughnut',
    data: {
      labels: itens.map(i => i.chave),
      datasets: [{ data: itens.map(i => i.horas),
        backgroundColor: itens.map((_, i) => PALETA[i % PALETA.length]),
        borderColor: '#131823', borderWidth: 2, hoverOffset: 6, hoverBorderColor: '#131823' }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { position: 'right', labels: LEGENDA }, tooltip: DICA },
    },
  });
}

function graficoBarraH(id, itens, cor) {
  desenhar(id, {
    type: 'bar',
    data: { labels: itens.map(i => i.chave),
      datasets: [{ label: 'Horas', data: itens.map(i => i.horas),
        backgroundColor: cor || '#4A90D9',
        borderRadius: 3, borderSkipped: false, maxBarThickness: 22 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: DICA },
      scales: { x: { ticks: EIXO, grid: GRADE, border: BORDA_EIXO, beginAtZero: true },
                y: { ticks: EIXO, grid: { display: false }, border: BORDA_EIXO } },
    },
  });
}

/* ───────────────────────────────────────────────────────────────
   10. ABAS
   Funcionário comum vê 2 abas, com os próprios dados.
   Admin vê o conjunto completo.
   ─────────────────────────────────────────────────────────────── */
const ABAS_COMUM = [
  ['resumo',    'Meu Resumo'],
  ['registros', 'Meus Registros'],
];
const ABAS_ADMIN = [
  ['resumo',        'Visão Geral'],
  ['colaboradores', 'Colaboradores'],
  ['obras',         'Obras'],
  ['setores',       'Setores'],
  ['disciplinas',   'Disciplinas'],
  ['indireto',      'Tempo Indireto'],
  ['custos',        'Custos'],
  ['fechamento',    'Fechamento'],
  ['resultado',     'Resultado'],
  ['cobertura',     'Cobertura'],
  ['alertas',       'Alertas'],
  ['registros',     'Registros'],
  ['custohora',     'Custo/Hora'],
];

function montarAbas() {
  const abas = S.admin ? ABAS_ADMIN : ABAS_COMUM;
  S.aba = abas[0][0];
  $('#nav-abas').innerHTML = abas.map(([k, r]) =>
    '<button data-aba="' + k + '"' + (k === S.aba ? ' class="ativa"' : '') + '>' + r + '</button>').join('');
}

/* ── VISÃO GERAL / MEU RESUMO ── */
function telaResumo(linhas) {
  const k = resumir(linhas);
  const porObra = ordenarPor(agrupar(linhas.filter(ehProjetoReal), r => r.obra), 'horas', true).slice(0, 12);
  const porDisc = ordenarPor(agrupar(linhas, r => r.disciplina), 'horas', true).slice(0, 10);
  const porTipo = ordenarPor(agrupar(linhas, r => TIPOS[r._tipo].nome), 'horas', true);

  let html = '<div class="kpis">' +
    kpi('Horas pagas', fmtHoras(k.horas), fmtN(k.n) + ' lançamentos') +
    kpi('Produtivas', fmtHoras(k.prod), fmtPct(k.taxaProd) + ' do tempo trabalhado',
        k.taxaProd >= 0.8 ? 'ok' : k.taxaProd >= 0.6 ? 'warn' : 'bad') +
    kpi('Tempo indireto', fmtHoras(k.indir), 'reunião, gestão, serviço interno, treinamento') +
    kpi('Faltas e atestados', fmtHoras(k.absen), fmtPct(k.taxaAbsen) + ' do tempo pago',
        k.taxaAbsen > 0.08 ? 'warn' : '') +
    kpi(S.admin ? 'Dias-pessoa lançados' : 'Dias lançados', fmtN(k.nDias),
        'média de ' + fmtHoras(k.mediaDia) + ' h/dia') +
    kpi(S.admin ? 'Obras ativas' : 'Minhas obras', fmtN(k.nObras), fmtN(k.nDiscs) + ' disciplinas') +
    (S.admin ? kpi('Colaboradores', fmtN(k.nColabs), '') : '') +
    (S.admin && CUSTOS.quantos()
      ? kpi('Custo do período', fmtBRL(k.custo), fmtBRL(k.custoIndir) + ' em tempo indireto')
      : '') +
    '</div>';

  if (k.fora > 0) {
    html += '<div class="box" style="margin-bottom:18px;border-color:var(--border-strong)">' +
      '<span class="muted" style="font-size:12.5px">' +
      fmtHoras(k.fora) + ' h de <b>férias e feriado</b> foram lançadas no período e ficam ' +
      'fora de todas as contas acima — não são tempo da empresa nem geram custo.' +
      '</span></div>';
  }

  html += secao('Horas por mês', box(grafico('g-mes')), 'empilhado por natureza da hora');

  html += '<div class="grid2">' +
    '<div>' + secao('Distribuição do tempo', box(grafico('g-tipo'))) + '</div>' +
    '<div>' + secao('Disciplinas', box(grafico('g-disc'))) + '</div>' +
    '</div>';

  html += secao(S.admin ? 'Obras com mais horas' : 'Minhas obras',
    box(grafico('g-obra', true)), 'top 12 — ausências não entram');

  if (S.admin) {
    const porColab = ordenarPor(agrupar(linhas, r => r.colaborador), 'horas', true);
    html += secao('Resumo por colaborador', box(tabela('resumo-colab', [
      { rot: 'Colaborador', campo: 'chave',    tipo: 'texto' },
      { rot: 'Horas',       campo: 'horas',    tipo: 'horas', barra: true },
      { rot: 'Produtivas',  campo: 'prod',     tipo: 'horas' },
      { rot: '% Prod.',     campo: 'taxaProd', tipo: 'pct'   },
      { rot: 'Dias',        campo: 'nDias',    tipo: 'num'   },
      { rot: 'h/dia',       campo: 'mediaDia', tipo: 'horas' },
      { rot: 'Obras',       campo: 'nObras',   tipo: 'num'   },
    ], porColab, 15)));
  }

  setTimeout(() => {
    graficoMensal('g-mes', linhas);
    graficoRosca('g-tipo', porTipo);
    graficoRosca('g-disc', porDisc);
    graficoBarraH('g-obra', porObra);
  }, 0);

  return html;
}

/* ── tabela genérica de agrupamento ── */
function telaAgrupada(linhas, rotulo, chaveFn, idTab, soProjetos) {
  // Na aba Obras separamos projeto de não-projeto, mas nada some da tela:
  // serviço interno, reunião e afins vão para uma tabela própria embaixo.
  // Antes eles eram simplesmente descartados, e quem lançasse nesses
  // rótulos não aparecia aqui — parecia que o painel não tinha atualizado.
  const base  = soProjetos ? linhas.filter(contaComoObra) : linhas;
  const foraDeObra = soProjetos ? linhas.filter(r => !contaComoObra(r)) : [];

  // Cada nome digitado é uma linha, igual ao sistema de Registro de Horas.
  //
  // Já tentei agrupar pelo nome do cadastro, para juntar grafias divergentes
  // ("ETE RIO POMBA" e "ETE Rio Pomba"). Some a duplicidade, mas o total de
  // obras deixa de bater com o sistema — e bater é o que importa aqui.
  // As grafias divergentes seguem sinalizadas; a correção certa é padronizar
  // o nome no próprio sistema, não escondê-lo aqui.
  const dados = agrupar(base, chaveFn);
  const k = resumir(base);

  // Na aba Obras o total precisa deixar claro o que entra em cada parcela,
  // senão o número parece "faltar" quando comparado com o do sistema:
  //   com horas  + sem horas (cadastradas e paradas)  + fora de obra
  let kpiObras;
  if (soProjetos) {
    const comHorasNorm = new Set(dados.map(d => normalizar(d.chave)));
    const cadastradasParadas = Object.values(S.obras)
      .filter(o => o.ativo !== false && !comHorasNorm.has(normalizar(o.nome))).length;
    const rotulosForaDeObra = new Set(foraDeObra.map(r => r.obra).filter(Boolean)).size;
    const totalGeral = dados.length + cadastradasParadas;

    kpiObras = S.modoSistema
      ? kpi('Obras', fmtN(totalGeral), 'mesmo critério do sistema ("Todas")') +
        kpi('Com horas', fmtN(dados.length), 'no filtro atual') +
        kpi('Paradas', fmtN(cadastradasParadas), 'cadastradas, sem lançamento')
      : kpi('Obras com horas', fmtN(dados.length), 'no filtro atual') +
        kpi('Cadastradas sem horas', fmtN(cadastradasParadas), 'estão no cadastro, paradas') +
        kpi('Total de obras', fmtN(totalGeral), 'com horas + paradas') +
        (rotulosForaDeObra
          ? kpi('Fora de obra', fmtN(rotulosForaDeObra),
                'serviço interno, reunião, férias…') : '');
  } else {
    kpiObras = kpi(rotulo + 's', fmtN(dados.length), 'no filtro atual');
  }

  let html = '<div class="kpis">' +
    kpiObras +
    kpi('Horas', fmtHoras(k.horas), fmtN(k.n) + ' lançamentos') +
    kpi('Produtivas', fmtHoras(k.prod), fmtPct(k.taxaProd)) +
    '</div>';

  const cols = [
    { rot: rotulo,       campo: 'chave',    tipo: 'texto' },
    { rot: 'Horas',      campo: 'horas',    tipo: 'horas', barra: true },
    { rot: 'Produtivas', campo: 'prod',     tipo: 'horas' },
    { rot: 'Indireto',   campo: 'indir',    tipo: 'horas' },
    { rot: '% Prod.',    campo: 'taxaProd', tipo: 'pct'   },
    { rot: 'Lanç.',      campo: 'n',        tipo: 'num'   },
    // "Dias" aqui é data do calendário: quantos dias essa obra/setor teve
    // movimento. Dia-pessoa só faz sentido quando a linha é uma pessoa.
    { rot: 'Dias',       campo: 'nDatas',   tipo: 'num'   },
  ];
  if (S.admin) cols.push({ rot: 'Pessoas', campo: 'nColabs', tipo: 'num' });

  if (soProjetos && Object.keys(S.obras).length) {
    // enriquece cada linha com o cadastro da obra
    dados.forEach(d => {
      const o = obraCadastrada(d.chave);
      d.status     = o ? (o.status || 'EM ANDAMENTO') : '— não cadastrada —';
      d.prazo      = o && o.data_fim ? o.data_fim : '';
      d.valor      = o ? numBRL(o.valor_obra) : 0;
      d.cidade     = o ? (o.sigla_cidade || o.cliente_estado || '') : '';
      d.consumido  = d.valor ? d.custo / d.valor : 0;
    });

    const temValor = dados.some(d => d.valor > 0);
    const colsObra = [
      { rot: 'Obra',    campo: 'chave',  tipo: 'texto' },
      { rot: 'Status',  campo: 'status', tipo: 'texto' },
      { rot: 'Horas',   campo: 'horas',  tipo: 'horas', barra: true },
      { rot: '% Prod.', campo: 'taxaProd', tipo: 'pct' },
      { rot: 'Pessoas', campo: 'nColabs', tipo: 'num' },
      { rot: 'Dias',    campo: 'nDatas',  tipo: 'num' },
      { rot: 'Prazo',   campo: 'prazo',  tipo: 'data' },
    ];
    if (CUSTOS.quantos()) colsObra.push({ rot: 'Custo de mão de obra', campo: 'custo', tipo: 'brl' });
    if (temValor) {
      colsObra.push({ rot: 'Valor do contrato', campo: 'valor', tipo: 'brl' });
      if (CUSTOS.quantos()) colsObra.push({ rot: '% consumido', campo: 'consumido', tipo: 'pct' });
    }

    // Grafias divergentes não são mais somadas (para o total bater com o
    // sistema), mas continuam sinalizadas para quem quiser padronizar.
    const porNorm = new Map();
    for (const d of dados) {
      const k = normalizar(d.chave);
      if (!porNorm.has(k)) porNorm.set(k, []);
      porNorm.get(k).push(d.chave);
    }
    const divergentes = [...porNorm.values()].filter(v => v.length > 1);

    // guarda o que está na tela para o Excel sair exatamente igual ao visto
    S.obrasNaTela = dados;

    html += secao('Obras',
      box(tabela(idTab, colsObra, dados, 20, { campo: 'horas', desc: true }, true)),
      fmtN(dados.length) + ' obras no filtro atual ' +
      '<button id="btn-excel-obras" class="exportar" style="margin-left:10px">' +
      '⤓ Excel das obras</button>');

    if (S.modoSistema) {
      html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin:-18px 0 22px">' +
        '<span style="color:var(--warning-text)">Modo "igual ao sistema" ligado</span> ' +
        '<span class="muted">— contagem de obras, critério e formato HH:MM iguais aos do ' +
        'Registro de Horas. <b>As horas continuam diferentes</b>, e de propósito: aquele ' +
        'sistema repete e perde linhas a cada carregamento, então o valor dele muda sozinho. ' +
        'Os números aqui são os do banco. Use "Conferir agora" na aba Alertas para medir a ' +
        'diferença na hora.</span></div>';
    }

    if (divergentes.length) {
      html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin:-18px 0 22px">' +
        '<span style="color:var(--warning-text)">⚠ ' + divergentes.length +
        ' obra(s) aparecem em mais de uma linha</span> ' +
        '<span class="muted">— o mesmo nome escrito de formas diferentes conta como duas: ' +
        esc(divergentes.slice(0, 3).map(v => v.join('  =  ')).join('   |   ')) +
        '. Padronize no sistema para virarem uma só.</span></div>';
    }

    const semCadastro = dados.filter(d => !obraCadastrada(d.chave));
    if (semCadastro.length) {
      html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin:-18px 0 22px">' +
        '<span style="color:var(--warning-text)">⚠ ' + semCadastro.length + ' obra(s) com horas lançadas não estão no cadastro</span> ' +
        '<span class="muted">— ou o nome foi digitado diferente, ou a obra nunca foi cadastrada: ' +
        esc(semCadastro.slice(0, 5).map(d => d.chave).join(', ')) +
        (semCadastro.length > 5 ? ' e mais ' + (semCadastro.length - 5) : '') + '</span></div>';
    }

    // obras cadastradas que ninguém tocou
    const comHoras = new Set(dados.map(d => normalizar(d.chave)));
    const semHoras = Object.values(S.obras)
      .filter(o => o.ativo !== false && !comHoras.has(normalizar(o.nome)))
      .map(o => ({ chave: o.nome, status: o.status || 'EM ANDAMENTO',
                   prazo: o.data_fim || '', valor: numBRL(o.valor_obra) }));
    if (semHoras.length) {
      const colsSem = [
        { rot: 'Obra',   campo: 'chave',  tipo: 'texto' },
        { rot: 'Status', campo: 'status', tipo: 'texto' },
        { rot: 'Prazo',  campo: 'prazo',  tipo: 'data'  },
      ];
      if (semHoras.some(o => o.valor > 0)) colsSem.push({ rot: 'Valor do contrato', campo: 'valor', tipo: 'brl' });
      html += secao('Obras cadastradas sem horas no período',
        box(tabela(idTab + '-sem', colsSem, semHoras, 40, { campo: 'chave', desc: false })),
        'estão no cadastro mas ninguém lançou hora nelas dentro do filtro');
    }
  } else {
    html += secao(rotulo + 's', box(tabela(idTab, cols, dados, 20)),
      'clique no cabeçalho para ordenar');
  }

  if (foraDeObra.length) {
    const outros = agrupar(foraDeObra, chaveFn);
    html += secao('Lançamentos fora de obra',
      box(tabela(idTab + '-fora', [
        { rot: 'Lançado como', campo: 'chave',   tipo: 'texto' },
        { rot: 'Horas',        campo: 'horasLancadas', tipo: 'horas', barra: true },
        { rot: 'Lanç.',        campo: 'n',       tipo: 'num'   },
        { rot: 'Pessoas',      campo: 'nColabs', tipo: 'num'   },
        // sem coluna de dias: atestado e férias não contam dia trabalhado,
        // então apareceriam como "8 horas em 0 dias".
      ], outros, null, { campo: 'horasLancadas', desc: true })),
      fmtHoras(foraDeObra.reduce((a, r) => a + r.horas, 0)) + ' h que não pertencem a nenhum projeto — ' +
      'serviço interno, reunião, treinamento, férias, atestado');
  }

  return html;
}

/* ── TEMPO INDIRETO ── */
function telaIndireto(linhas) {
  const indiretas = linhas.filter(r => TIPOS[r._tipo].grupo === 'indir');
  const ausencias = linhas.filter(r => TIPOS[r._tipo].grupo === 'aus');
  const k = resumir(linhas);

  let html = '<div class="kpis">' +
    kpi('Tempo indireto', fmtHoras(k.indir), fmtPct(k.base ? k.indir / k.base : 0) + ' do trabalhado',
        (k.base && k.indir / k.base > 0.3) ? 'warn' : '') +
    kpi('Ausências', fmtHoras(k.aus), fmtN(ausencias.length) + ' lançamentos') +
    kpi('Produtivas', fmtHoras(k.prod), fmtPct(k.taxaProd), 'ok') +
    '</div>';

  html += secao('Composição do tempo indireto',
    box(grafico('g-ind')),
    'reunião, gestão e serviço interno — trabalho, mas não em projeto');

  const porTipoInd = ordenarPor(agrupar(indiretas, r => TIPOS[r._tipo].nome), 'horas', true);
  html += secao('Por tipo', box(tabela('ind-tipo', [
    { rot: 'Tipo',  campo: 'chave', tipo: 'texto' },
    { rot: 'Horas', campo: 'horas', tipo: 'horas', barra: true },
    { rot: 'Lanç.', campo: 'n',     tipo: 'num'   },
    { rot: 'Dias',  campo: 'nDias', tipo: 'num'   },
  ], porTipoInd)));

  if (S.admin) {
    const porColab = ordenarPor(agrupar(indiretas, r => r.colaborador), 'horas', true);
    html += secao('Quem tem mais tempo indireto', box(tabela('ind-colab', [
      { rot: 'Colaborador', campo: 'chave', tipo: 'texto' },
      { rot: 'Indireto',    campo: 'horas', tipo: 'horas', barra: true },
      { rot: 'Lanç.',       campo: 'n',     tipo: 'num'   },
    ], porColab, 20)), 'número alto não é necessariamente problema — depende da função');
  }

  const porTipoAus = ordenarPor(agrupar(ausencias, r => TIPOS[r._tipo].nome), 'horas', true);
  html += secao('Ausências', box(tabela('aus-tipo', [
    { rot: 'Tipo',  campo: 'chave', tipo: 'texto' },
    { rot: 'Horas', campo: 'horas', tipo: 'horas', barra: true },
    { rot: 'Lanç.', campo: 'n',     tipo: 'num'   },
  ], porTipoAus)));

  setTimeout(() => graficoRosca('g-ind', porTipoInd), 0);
  return html;
}

/* ── ALERTAS ── */
function telaAlertas(linhas) {
  const cabecalhoConferencia = S.admin ? blocoConferencia() : '';

  // 0b. líderes tirados das contas — dito em voz alta, nunca em silêncio
  const lid = S.lideres || { nomes: new Set(), ambiguos: [], semCadastro: [], n: 0, horas: 0, porPessoa: [] };

  // 0. pessoas que trocaram de nome no cadastro e viravam duas no painel
  //    Não é alerta de erro: é aviso de que o painel juntou as duas metades.
  //    Fica visível de propósito — mexer em como a pessoa aparece sem avisar
  //    seria o tipo de ajuste silencioso que faz ninguém mais confiar no número.
  const unificados = S.nomesUnificados || [];
  const SEP = String.fromCharCode(1);   // separador interno, não aparece em nome nenhum

  // 1. dias com carga muito alta (possível erro de digitação)
  const porPessoaDia = new Map();
  for (const r of linhas) {
    const k = r.colaborador + SEP + r.data;
    porPessoaDia.set(k, (porPessoaDia.get(k) || 0) + r.horas);
  }
  const diasLongos = [...porPessoaDia.entries()]
    .filter(([, h]) => h > 12)
    .map(([k, h]) => { const p = k.split(SEP); return { chave: p[0], data: p[1], horas: h }; })
    .sort((a, b) => b.horas - a.horas);

  // 2. lançamentos em obra sem disciplina preenchida
  const semDisc = linhas.filter(r => !r.disciplina && ehProjetoReal(r));

  // 3. lançamentos sem nenhuma descrição
  const semTarefa = linhas.filter(r => !r.tarefa && !r.obs);

  // 4. mesma obra digitada de formas diferentes
  const mapaObras = new Map();
  for (const r of linhas) {
    if (!r.obra) continue;
    const n = normalizar(r.obra);
    if (!mapaObras.has(n)) mapaObras.set(n, new Set());
    mapaObras.get(n).add(r.obra);
  }
  const duplicadas = [...mapaObras.entries()]
    .filter(([, vars]) => vars.size > 1)
    .map(([n, vars]) => ({ chave: n, variacoes: [...vars].join('   ·   '), qtd: vars.size }));

  let html = cabecalhoConferencia + '<div class="kpis">' +
    kpi('Dias acima de 12h', fmtN(diasLongos.length), 'possível erro de lançamento', diasLongos.length ? 'warn' : 'ok') +
    kpi('Sem disciplina', fmtN(semDisc.length), 'lançamentos em obra', semDisc.length ? 'warn' : 'ok') +
    kpi('Sem descrição', fmtN(semTarefa.length), 'nem tarefa nem observação', semTarefa.length ? 'warn' : 'ok') +
    kpi('Obras duplicadas', fmtN(duplicadas.length), 'mesmo nome escrito diferente', duplicadas.length ? 'bad' : 'ok') +
    (unificados.length ? kpi('Nomes unificados', fmtN(unificados.length),
      'pessoas que trocaram de nome', 'warn') : '') +
    (lid.nomes.size ? kpi('Líderes fora das contas', fmtN(lid.nomes.size),
      fmtN(lid.n) + ' lançamentos · ' + fmtHoras(lid.horas) + ' h') : '') +
    (lid.ambiguos.length ? kpi('Líderes ambíguos', fmtN(lid.ambiguos.length),
      'continuam DENTRO das contas', 'bad') : '') +
    '</div>';

  if (lid.nomes.size) {
    html += secao('Líderes fora das contas',
      box(tabela('al-lideres', [
        { rot: 'Líder',            campo: 'chave',         tipo: 'texto' },
        { rot: 'Líder desde',      campo: 'desde',         tipo: 'data'  },
        { rot: 'Lanç. excluídos',  campo: 'n',             tipo: 'num', barra: true },
        { rot: 'Horas excluídas',  campo: 'horas',         tipo: 'horas' },
        { rot: 'Lanç. mantidos',   campo: 'mantidas',      tipo: 'num'   },
        { rot: 'Horas mantidas',   campo: 'horasMantidas', tipo: 'horas' },
      ], lid.porPessoa, 10, { campo: 'horas', desc: true })),
      'líder fica fora de tudo: não aparece em produtividade, não entra em ' +
      'custo e não é cobrado de lançamento · quem tem data em "Líder desde" ' +
      'virou líder depois: o trabalho de projeto anterior à data continua ' +
      'valendo nas obras e por isso aparece como mantido');
  }

  if (lid.ambiguos.length) {
    html += secao('Líderes que o painel não soube identificar',
      box(tabela('al-lid-amb', [
        { rot: 'Nome na lista de líderes', campo: 'chave',      tipo: 'texto' },
        { rot: 'Casa com',                 campo: 'candidatos', tipo: 'texto' },
        { rot: 'Quantos',                  campo: 'qtd',        tipo: 'num'   },
      ], lid.ambiguos, 10, { campo: 'qtd', desc: true })),
      'o nome na lista casa com mais de uma pessoa do cadastro, então ' +
      'NINGUÉM foi excluído — tirar a pessoa errada das contas em silêncio ' +
      'seria pior · escreva o nome completo em LIDERES, no app.js');
  }

  if (lid.semCadastro.length) {
    html += '<div class="box" style="margin-bottom:22px">' +
      '<div style="font-weight:600;color:var(--text-primary);margin-bottom:4px">' +
      fmtN(lid.semCadastro.length) + ' líderes da lista não têm cadastro no Registro de Horas</div>' +
      '<div class="muted" style="font-size:12.5px">' + esc(lid.semCadastro.join('  ·  ')) +
      '<br>Já estavam fora das contas por não existirem no sistema. Ficam na lista ' +
      'para o dia em que forem cadastrados.</div></div>';
  }

  if (unificados.length) {
    html += secao('Pessoas que aparecem com dois nomes',
      box(tabela('al-nomes', [
        { rot: 'Nome nos lançamentos antigos', campo: 'chave',    tipo: 'texto' },
        { rot: 'Nome no cadastro hoje',        campo: 'para',     tipo: 'texto' },
        { rot: 'Setor(es) dos lançamentos',    campo: 'setor',    tipo: 'texto' },
        { rot: 'Lançamentos',                  campo: 'n',        tipo: 'num', barra: true },
        { rot: 'Horas',                        campo: 'horas',    tipo: 'horas' },
        { rot: 'Do dia',                       campo: 'primeiro', tipo: 'data' },
        { rot: 'Até',                          campo: 'ultimo',   tipo: 'data' },
      ], unificados, 10, { campo: 'n', desc: true })),
      'o painel juntou tudo sob o nome atual, usando a conta (user_id) como ' +
      'identidade — o nome antigo continua gravado no banco, nada foi alterado lá');
  }

  html += secao('Dias com mais de 12 horas lançadas',
    box(tabela('al-12h', [
      { rot: 'Colaborador', campo: 'chave', tipo: 'texto' },
      { rot: 'Data',        campo: 'data',  tipo: 'data'  },
      { rot: 'Horas',       campo: 'horas', tipo: 'horas' },
    ], diasLongos, 40, { campo: 'horas', desc: true })),
    'quase sempre é digitação errada, não jornada real');

  html += secao('Mesma obra, nomes diferentes',
    box(duplicadas.length
      ? '<div class="tabela-rolagem"><table><thead><tr><th>Como foi digitado</th><th class="num">Variações</th></tr></thead><tbody>' +
        duplicadas.map(d => '<tr><td class="livre">' + esc(d.variacoes) + '</td><td class="num">' + d.qtd + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<div class="vazio">Nenhuma divergência encontrada.</div>'),
    'o painel agrupa por texto — estas viram projetos separados nos relatórios');

  if (S.admin && semDisc.length) {
    const porColab = ordenarPor(agrupar(semDisc, r => r.colaborador), 'n', true);
    html += secao('Lançamentos sem disciplina, por colaborador', box(tabela('al-disc', [
      { rot: 'Colaborador', campo: 'chave', tipo: 'texto' },
      { rot: 'Lançamentos', campo: 'n',     tipo: 'num', barra: true },
      { rot: 'Horas',       campo: 'horas', tipo: 'horas' },
    ], porColab, 20)));
  }

  return html;
}

/* ── LISTA DE REGISTROS ── */
function telaRegistros(linhas) {
  const k = resumir(linhas);

  // Monta um objeto plano por lançamento: a tabela genérica ordena e pagina,
  // em vez da lista cortada nos 500 mais recentes que existia aqui.
  const dados = linhas.map(r => ({
    data:        r.data,
    colaborador: r.colaborador,
    obra:        r.obra,
    _tipo:       r._tipo,
    disciplina:  r.disciplina || '—',
    horas:       r.horas,
    texto:       r.tarefa || r.obs || '',
  }));

  const cols = [
    { rot: 'Data', campo: 'data', tipo: 'data' },
  ];
  if (S.admin) cols.push({ rot: 'Colaborador', campo: 'colaborador', tipo: 'texto' });
  cols.push(
    { rot: 'Obra',                campo: 'obra',       tipo: 'texto' },
    { rot: 'Tipo',                campo: '_tipo',      tipo: 'tag'   },
    { rot: 'Disciplina',          campo: 'disciplina', tipo: 'texto' },
    { rot: 'Horas',               campo: 'horas',      tipo: 'horas' },
    { rot: 'Tarefa / Observação', campo: 'texto',      tipo: 'livre' },
  );

  return '<div class="kpis">' +
    kpi('Lançamentos', fmtN(k.n), 'no filtro atual') +
    kpi('Horas', fmtHoras(k.horas), '') +
    '</div>' +
    secao('Registros',
      box(tabela('reg', cols, dados, 25, { campo: 'data', desc: true })),
      'clique no cabeçalho para ordenar · use o Excel para levar tudo de uma vez');
}


/* ── CUSTOS (admin) ── */
function telaCustos(linhas) {
  if (!CUSTOS.quantos()) {
    return '<div class="box" style="padding:30px;text-align:center">' +
      '<div style="font-size:14px;color:var(--text-primary);margin-bottom:8px">Nenhum custo/hora cadastrado</div>' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:16px">' +
      'Cadastre o valor/hora dos colaboradores na aba <b>Custo/Hora</b> para ver os números financeiros.</div>' +
      '<button class="primario" style="width:auto;padding:8px 18px" data-ir="custohora">Ir para Custo/Hora</button>' +
      '</div>';
  }

  const k = resumir(linhas);
  const semValor = [...new Set(linhas.map(r => r.colaborador))].filter(n => !CUSTOS.valorDe(n));

  let html = '<div class="kpis">' +
    kpi('Custo total', fmtBRL(k.custo), fmtHoras(k.horas) + ' h no período') +
    kpi('Custo produtivo', fmtBRL(k.custoProd),
        fmtPct(k.custo ? k.custoProd / k.custo : 0) + ' do total', 'ok') +
    kpi('Custo indireto', fmtBRL(k.custoIndir),
        'reunião, gestão, serviço interno',
        (k.custo && k.custoIndir / k.custo > 0.3) ? 'warn' : '') +
    kpi('Custo de falta/atestado', fmtBRL(k.custoAbsen),
        'pago sem trabalho realizado', k.custoAbsen ? 'bad' : '') +
    kpi('Custo médio/hora', fmtBRL2(k.custoHora), 'média ponderada do período') +
    '</div>';

  if (semValor.length) {
    html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin-bottom:18px">' +
      '<span style="color:var(--warning-text)">⚠ ' + semValor.length + ' colaborador(es) sem valor/hora</span> ' +
      '<span class="muted">— as horas dessas pessoas entram no relatório, mas com custo zero, ' +
      'então os totais acima estão subestimados: ' + esc(semValor.slice(0, 6).join(', ')) +
      (semValor.length > 6 ? ' e mais ' + (semValor.length - 6) : '') + '</span></div>';
  }

  const porObra = agrupar(linhas.filter(ehProjetoReal), r => r.obra);
  html += secao('Custo por obra', box(tabela('cst-obra', [
    { rot: 'Obra',        campo: 'chave',      tipo: 'texto' },
    { rot: 'Horas',       campo: 'horas',      tipo: 'horas' },
    { rot: 'Custo',       campo: 'custo',      tipo: 'brl', barra: true },
    { rot: 'Custo/hora',  campo: 'custoHora',  tipo: 'brl2'  },
    { rot: 'Pessoas',     campo: 'nColabs',    tipo: 'num'   },
  ], porObra, 30, { campo: 'custo', desc: true })), 'quanto cada projeto consumiu');

  const porColab = agrupar(linhas, r => r.colaborador);
  html += secao('Custo por colaborador', box(tabela('cst-colab', [
    { rot: 'Colaborador', campo: 'chave',      tipo: 'texto' },
    { rot: 'Horas',       campo: 'horas',      tipo: 'horas' },
    { rot: 'Custo',       campo: 'custo',      tipo: 'brl', barra: true },
    { rot: 'Produtivo',   campo: 'custoProd',  tipo: 'brl'   },
    { rot: 'Indireto',    campo: 'custoIndir', tipo: 'brl'   },
    { rot: '% Prod.',     campo: 'taxaProd',   tipo: 'pct'   },
  ], porColab, 40, { campo: 'custo', desc: true })));

  const porSetor = agrupar(linhas, r => r.setor);
  html += secao('Custo por setor', box(tabela('cst-setor', [
    { rot: 'Setor',      campo: 'chave',      tipo: 'texto' },
    { rot: 'Horas',      campo: 'horas',      tipo: 'horas' },
    { rot: 'Custo',      campo: 'custo',      tipo: 'brl', barra: true },
    { rot: 'Indireto',   campo: 'custoIndir', tipo: 'brl'   },
    { rot: 'Pessoas',    campo: 'nColabs',    tipo: 'num'   },
  ], porSetor, null, { campo: 'custo', desc: true })));

  html += secao('Custo por mês', box(grafico('g-custo-mes')));
  setTimeout(() => {
    const porMes = ordenarPor(agrupar(linhas, r => r._mes), 'chave', false);
    desenhar('g-custo-mes', {
      type: 'bar',
      data: {
        labels: porMes.map(m => rotuloMes(m.chave)),
        datasets: [
          { label: 'Produtivo', data: porMes.map(m => m.custoProd),  backgroundColor: '#4A90D9', stack: 'c' },
          { label: 'Indireto',  data: porMes.map(m => m.custoIndir), backgroundColor: '#D68B3C', stack: 'c' },
        ],
      },
      options: {
        scales: {
          x: { stacked: true, ticks: EIXO, grid: GRADE },
          y: { stacked: true, ticks: Object.assign({}, EIXO, {
                 callback: (v) => 'R$ ' + (v / 1000).toLocaleString('pt-BR') + 'k' }),
               grid: GRADE, beginAtZero: true },
        },
      },
    });
  }, 0);

  return html;
}

/* ── CUSTO/HORA (admin) — cadastro ── */
/* Quem precisa de valor/hora cadastrado.

   A lista NÃO pode sair só de `registros`: quem nunca lançou hora não
   apareceria, e quem já saiu da empresa apareceria para sempre. Medido em
   07/10/2026: a tela mostrava 107 nomes — faltavam 4 ativos (os admins,
   que não lançam) e sobravam 22 inativos.

   Mas inativo com hora lançada NÃO pode simplesmente sumir: o custo
   histórico das telas Custos, Fechamento e Resultado depende do valor/hora
   dessa pessoa. Tirar da lista faria o custo de meses passados encolher
   sem aviso. Por isso vão em duas listas separadas, cada uma com seu
   propósito dito em voz alta. */
function nomesParaCusto(base) {
  const linhas = base || S.linhas;
  const comHoras = new Set(linhas.map(r => r.colaborador).filter(Boolean));
  const perfilDe = new Map();
  S.perfis.forEach(p => { if (p.nome) perfilDe.set(p.nome, p); });
  const ehAtivo = (p) => (p.status || 'ATIVO').toUpperCase() === 'ATIVO';

  const ativos = new Set();
  // Com recorte (uma disciplina, um setor, uma obra) a lista passa a ser
  // "quem trabalhou nisso", e não o quadro inteiro — senão filtrar não
  // encurtaria nada e o objetivo do filtro se perderia.
  if (base) {
    comHoras.forEach(n => {
      const p = perfilDe.get(n);
      if (!ehLider(n) && (!p || ehAtivo(p))) ativos.add(n);
    });
  } else {
    S.perfis.forEach(p => { if (ehAtivo(p) && !ehLider(p.nome)) ativos.add(p.nome); });
    // quem lança mas não tem cadastro: tem custo, então não pode ficar de fora
    comHoras.forEach(n => { if (!perfilDe.has(n)) ativos.add(n); });
  }

  /* Regra simples e à prova de caso novo: QUEM TEM HORA NO PAINEL PRECISA
     DE VALOR/HORA. Senão aquelas horas custam zero em silêncio.
     Cai aqui quem saiu da empresa e quem virou líder — o histórico de
     antes de assumir continua valendo e precisa ser precificado. */
  const outros = [...comHoras].filter(n => !ativos.has(n));

  const ordena = (a, b) => a.localeCompare(b, 'pt-BR');
  return {
    ativos:   [...ativos].sort(ordena),
    inativos: outros.sort(ordena),
    semCadastro: [...comHoras].filter(n => !perfilDe.has(n)),
  };
}

function telaCustoHora(linhas) {
  /* A tela respeita os filtros do topo. Escolher uma disciplina (ou setor,
     ou obra) encurta a lista para quem trabalhou nisso, e as horas passam a
     ser as daquele recorte — é assim que dá para cadastrar por time em vez
     de rolar 87 nomes toda vez. Sem filtro, continua mostrando o quadro
     inteiro, inclusive quem nunca lançou. */
  const recorte = [S.filtros.disc, S.filtros.setor, S.filtros.colab,
                   S.obrasSel.size ? [...S.obrasSel].join(', ') : '']
    .filter(Boolean);
  const filtrando = recorte.length > 0;
  const base = filtrando ? linhas : S.linhas;

  const { ativos, inativos, semCadastro } = nomesParaCusto(filtrando ? base : null);

  const horasDe = {};
  for (const r of base) horasDe[r.colaborador] = (horasDe[r.colaborador] || 0) + r.horas;

  let html = '<div class="box" style="border-color:rgba(210,150,63,.38);margin-bottom:16px">' +
    '<div style="color:var(--warning-text);font-weight:600;margin-bottom:5px">⚠ Informação confidencial</div>' +
    '<div class="muted" style="font-size:12.5px">' +
    'Estes valores ficam salvos <b>somente neste navegador</b> — não vão para o site nem para o banco, ' +
    'e ninguém que abrir o painel em outro computador os enxerga.<br>' +
    'Para passar para outro gestor use <b>Exportar</b> e envie o arquivo por um canal interno. ' +
    'Nunca coloque esse arquivo na pasta do site.' +
    '</div></div>';

  if (filtrando) {
    html += '<div class="box" style="border-color:rgba(77,143,214,.34);margin-bottom:16px">' +
      '<div style="font-weight:600;color:var(--primary-hover);margin-bottom:4px">' +
      'Lista recortada pelo filtro</div>' +
      '<div class="muted" style="font-size:12.5px">Mostrando só quem lançou hora em <b>' +
      esc(recorte.join('</b> · <b>')) + '</b>. As horas e o custo da tabela são os ' +
      'desse recorte, não os totais da pessoa.<br>' +
      'O valor/hora que você digitar vale para a pessoa inteira — ele não é por ' +
      'disciplina. Limpe os filtros para ver o quadro completo.</div></div>';
  }

  // o preenchimento em massa tem que agir sobre ESTA lista, não sobre o
  // quadro inteiro — senão o botão diz "todos os 12" e mexe em 87
  S.custoNaTela = ativos;

  const cadastradosAtivos = ativos.filter(n => CUSTOS.valorDe(n)).length;
  const vazios  = ativos.filter(n => !CUSTOS.valorDe(n));
  const semVal  = inativos.filter(n => !CUSTOS.valorDe(n)).length;

  html += '<div class="kpis">' +
    kpi(filtrando ? 'No recorte' : 'Colaboradores ativos', fmtN(ativos.length),
        filtrando ? 'lançaram hora no filtro atual' : 'vindos do cadastro, não dos lançamentos') +
    kpi('Com valor cadastrado', fmtN(cadastradosAtivos), 'de ' + fmtN(ativos.length) + ' ativos',
        cadastradosAtivos === ativos.length ? 'ok' : 'warn') +
    kpi('Faltando', fmtN(vazios.length), 'ativos ainda sem valor/hora',
        vazios.length ? 'bad' : 'ok') +
    (inativos.length ? kpi('Fora da lista, com horas', fmtN(inativos.length),
        semVal + ' sem valor · afetam o custo histórico', semVal ? 'warn' : '') : '') +
    '</div>';

  // Preenchimento em massa. Dois botões de propósito: "só os vazios" é o
  // seguro do dia a dia (não mexe em quem já tem valor próprio), e
  // "todos" sobrescreve — por isso pede confirmação antes.
  html += '<div class="filtros" style="margin-bottom:14px">' +
    '<span class="muted" style="font-size:12px">Aplicar R$</span>' +
    '<input type="text" id="in-cst-massa" inputmode="decimal" value="95" placeholder="95,00" ' +
      'style="width:90px;text-align:right;font-family:var(--mono)">' +
    '<span class="muted" style="font-size:12px">por hora a</span>' +
    '<button id="btn-cst-vazios"' + (vazios.length ? '' : ' disabled') + '>' +
      'quem está sem valor (' + vazios.length + ')</button>' +
    '<button id="btn-cst-todos">todos os ' + ativos.length + ' ativos</button>' +
    '<span style="width:14px"></span>' +
    '<button id="btn-cst-exportar">⤓ Exportar</button>' +
    '<button id="btn-cst-importar">⤒ Importar</button>' +
    '<input type="file" id="arq-custos" accept="application/json,.json" class="oculto">' +
    '<button id="btn-cst-limpar" style="margin-left:auto">apagar tudo</button>' +
    '</div>';

  /* Custo real da pessoa: cada hora pelo valor que valia no dia dela.
     Com um valor único dá o mesmo que horas × valor, como antes. */
  const custoDe = {};
  for (const r of base) {
    if (!TIPOS[r._tipo].geraCusto) continue;
    custoDe[r.colaborador] = (custoDe[r.colaborador] || 0)
      + r.horas * CUSTOS.valorDe(r.colaborador, r.data);
  }

  const tabelaCusto = (lista) => '<div class="tabela-rolagem"><table><thead><tr>' +
    '<th>Colaborador</th><th class="num">Horas (total)</th>' +
    '<th class="num">R$ / hora</th><th class="num">Custo acumulado</th>' +
    '</tr></thead><tbody>' +
    lista.map(n => {
      const base = CUSTOS.base(n);
      const aum  = CUSTOS.aumentos(n);
      const h    = horasDe[n] || 0;
      const temAlgum = base || aum.length;

      // faixas já cadastradas, da mais nova para a mais antiga
      const chips = aum.map(f =>
        '<span class="chip chip-sal">' + fmtBRL2(f.v) +
        '<span class="chip-de">desde ' + fmtData(f.de) + '</span>' +
        '<button type="button" class="chip-x" data-tirar-aumento="' + esc(n) + '" ' +
        'data-de="' + esc(f.de) + '" title="Tirar este aumento">✕</button></span>').join('');

      // formulário aberto só para quem foi clicado
      const form = S.editandoAumento === n
        ? '<div class="form-aumento">' +
            '<input type="text" inputmode="decimal" id="in-aum-valor" placeholder="novo R$/h" ' +
              'style="width:92px;text-align:right;font-family:var(--mono)">' +
            '<input type="date" id="in-aum-de" style="width:142px">' +
            '<button class="secundario" id="btn-aum-salvar" data-nome="' + esc(n) + '">salvar</button>' +
            '<button class="ghost" id="btn-aum-cancelar">cancelar</button>' +
          '</div>'
        : '';

      return '<tr>' +
        '<td>' + esc(n) +
          (semCadastro.includes(n)
            ? ' <span class="tag fora">sem cadastro</span>' : '') +
          (aum.length ? ' <span class="tag indir">' + aum.length + ' aumento' +
                        (aum.length > 1 ? 's' : '') + '</span>' : '') + '</td>' +
        '<td class="num">' + fmtHoras(h) + '</td>' +
        '<td class="num" style="width:230px">' +
          '<input type="text" inputmode="decimal" class="cst-in" data-nome="' + esc(n) + '" ' +
          'value="' + (base ? String(base).replace('.', ',') : '') + '" placeholder="0,00" ' +
          'style="width:110px;text-align:right;font-family:var(--mono)">' +
          '<button class="ghost btn-aum" data-abrir-aumento="' + esc(n) + '" ' +
          'title="Registrar um aumento com data">＋ aumento</button>' +
          (chips ? '<div class="chips-sal">' + chips + '</div>' : '') + form +
        '</td>' +
        '<td class="num">' + (temAlgum ? fmtBRL(custoDe[n] || 0) : '—') +
          (aum.length
            ? '<div class="muted" style="font-size:10.5px">média ' +
              fmtBRL2(CUSTOS.mediaPonderada(n, S.linhas)) + '/h</div>'
            : '') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>';

  html += secao(filtrando ? 'Colaboradores no recorte' : 'Colaboradores ativos',
    box(tabelaCusto(ativos)),
    (filtrando
      ? 'só quem lançou hora no filtro atual · horas e custo são deste recorte'
      : 'a lista vem do cadastro — quem nunca lançou hora também aparece, ' +
        'porque continua custando') +
    ' · digite e saia do campo para salvar');

  if (inativos.length) {
    html += secao('Fora da lista acima, mas com horas lançadas',
      box(tabelaCusto(inativos)),
      'quem saiu da empresa e quem virou líder depois de já ter trabalhado em ' +
      'projeto · o valor/hora continua necessário: sem ele o custo dos meses em ' +
      'que essa pessoa trabalhou sai menor do que foi · os botões de ' +
      'preenchimento em massa não mexem nesta lista');
  }

  return html;
}


/* ── FECHAMENTO (admin) ──
   A tela que responde "para onde foi o dinheiro do período".
   Separa o custo em três destinos que são decisões diferentes:
     produtivo  → trabalho entregue em projeto
     indireto   → trabalho que não virou projeto (reunião, gestão, treinamento)
     ausência   → a empresa pagou e ninguém trabalhou (falta, atestado)
   Férias e feriado não aparecem no custo: são mostrados à parte, só para
   conferência de que as horas foram lançadas. */
function telaFechamento(linhas) {
  const k = resumir(linhas);
  const temCusto = CUSTOS.quantos() > 0;

  const CATS = [
    { id: 'prod',  nome: 'Produtivo',        desc: 'trabalho em projeto',
      horas: k.prod,  custo: k.custoProd,  cor: '#4A90D9' },
    { id: 'indir', nome: 'Indireto',         desc: 'reunião, gestão, serviço interno, treinamento',
      horas: k.indir, custo: k.custoIndir, cor: '#D68B3C' },
    { id: 'absen', nome: 'Falta / atestado', desc: 'pago sem trabalho realizado',
      horas: k.absen, custo: k.custoAbsen, cor: '#C9595E' },
  ];

  let html = '<div class="kpis">' +
    kpi('Horas pagas', fmtHoras(k.horas), fmtN(k.n) + ' lançamentos no filtro') +
    kpi('Horas trabalhadas', fmtHoras(k.trabalhadas),
        fmtPct(k.horas ? k.trabalhadas / k.horas : 0) + ' do que foi pago', 'ok') +
    kpi('Horas pagas sem trabalho', fmtHoras(k.absen),
        fmtPct(k.taxaAbsen) + ' — falta e atestado', k.absen ? 'bad' : 'ok') +
    (temCusto ? kpi('Custo total', fmtBRL(k.custo), 'no período filtrado') : '') +
    '</div>';

  if (!temCusto) {
    html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin-bottom:18px">' +
      '<span style="color:var(--warning-text)">Sem custo/hora cadastrado</span> ' +
      '<span class="muted">— a tela mostra só as horas. Cadastre em ' +
      '<b>Custo/Hora</b> para ver os valores em reais. ' +
      '<button style="padding:3px 9px;margin-left:6px" data-ir="custohora">Ir agora</button></span></div>';
  }

  // ── o quadro principal: uma linha por destino, com o total no rodapé ──
  const linhasQuadro = CATS.map(c => {
    const pctH = k.horas  ? c.horas / k.horas : 0;
    const pctC = k.custo  ? c.custo / k.custo : 0;
    return '<tr>' +
      '<td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;' +
        'background:' + c.cor + ';margin-right:7px"></span>' + c.nome +
        '<div class="muted" style="font-size:11px;margin-left:16px">' + c.desc + '</div></td>' +
      '<td class="num">' + fmtHoras(c.horas) + '</td>' +
      '<td class="num">' + fmtPct(pctH) + '<span class="barra" style="width:' +
        Math.round(pctH * 100) + '%;background:' + c.cor + '"></span></td>' +
      '<td class="num">' + (temCusto ? fmtBRL(c.custo) : '—') + '</td>' +
      '<td class="num">' + (temCusto ? fmtPct(pctC) : '—') + '</td>' +
      '</tr>';
  }).join('');

  const rodape = '<tr style="border-top:2px solid var(--line-2)">' +
    '<td style="font-weight:600;color:var(--text-primary)">Total pago</td>' +
    '<td class="num" style="font-weight:600;color:var(--text-primary)">' + fmtHoras(k.horas) + '</td>' +
    '<td class="num muted">100%</td>' +
    '<td class="num" style="font-weight:600;color:var(--text-primary)">' + (temCusto ? fmtBRL(k.custo) : '—') + '</td>' +
    '<td class="num muted">' + (temCusto ? '100%' : '—') + '</td>' +
    '</tr>' +
    '<tr><td class="muted" style="font-size:11.5px">Férias e feriado <i>(fora do cálculo)</i></td>' +
    '<td class="num muted">' + fmtHoras(k.fora) + '</td>' +
    '<td class="num muted">—</td><td class="num muted">R$ 0</td><td class="num muted">—</td></tr>';

  html += secao('Para onde foi o tempo e o dinheiro',
    box('<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Destino</th><th class="num">Horas</th><th class="num">% das horas</th>' +
      '<th class="num">Custo</th><th class="num">% do custo</th>' +
      '</tr></thead><tbody>' + linhasQuadro + rodape + '</tbody></table></div>'),
    'férias e feriado não entram no total');

  html += '<div class="grid2">' +
    '<div>' + secao('Divisão das horas', box(grafico('g-fech-h'))) + '</div>' +
    '<div>' + secao(temCusto ? 'Divisão do custo' : 'Divisão do custo (sem dados)',
                    box(grafico('g-fech-c'))) + '</div>' +
    '</div>';

  html += secao('Evolução mês a mês', box(grafico('g-fech-mes', true)),
    temCusto ? 'custo por destino' : 'horas por destino');

  // ── por colaborador, com as três colunas separadas ──
  const porColab = ordenarPor(agrupar(linhas, r => r.colaborador),
                              temCusto ? 'custo' : 'horas', true);
  const colsColab = [
    { rot: 'Colaborador',     campo: 'chave',       tipo: 'texto' },
    { rot: 'Trabalhadas',     campo: 'trabalhadas', tipo: 'horas' },
    { rot: 'Falta/atestado',  campo: 'absen',       tipo: 'horas' },
    { rot: '% ausência',      campo: 'taxaAbsen',   tipo: 'pct'   },
    { rot: 'Dias',            campo: 'nDias',       tipo: 'num'   },
    { rot: 'h/dia',           campo: 'mediaDia',    tipo: 'horas' },
  ];
  if (temCusto) colsColab.push(
    { rot: 'Custo produtivo', campo: 'custoProd',  tipo: 'brl' },
    { rot: 'Custo indireto',  campo: 'custoIndir', tipo: 'brl' },
    { rot: 'Custo ausência',  campo: 'custoAbsen', tipo: 'brl' },
    { rot: 'Custo total',     campo: 'custo',      tipo: 'brl', barra: true });

  html += secao('Por colaborador', box(tabela('fech-colab', colsColab, porColab, 50,
    { campo: temCusto ? 'custo' : 'horas', desc: true })), 'clique no cabeçalho para ordenar');

  setTimeout(() => {
    const rotulos = CATS.map(c => c.nome);
    const cores   = CATS.map(c => c.cor);

    desenhar('g-fech-h', { type: 'doughnut',
      data: { labels: rotulos, datasets: [{ data: CATS.map(c => c.horas),
        backgroundColor: cores, borderColor: '#131823', borderWidth: 2, hoverOffset: 6 }] },
      options: { cutout: '58%', plugins: { legend: { position: 'right',
        labels: LEGENDA }, tooltip: DICA } } });

    desenhar('g-fech-c', { type: 'doughnut',
      data: { labels: rotulos, datasets: [{ data: CATS.map(c => c.custo),
        backgroundColor: cores, borderColor: '#131823', borderWidth: 2, hoverOffset: 6 }] },
      options: { cutout: '58%', plugins: { legend: { position: 'right',
        labels: LEGENDA }, tooltip: DICA } } });

    const porMes = ordenarPor(agrupar(linhas, r => r._mes), 'chave', false);
    const eixoY = temCusto
      ? Object.assign({}, EIXO, { callback: (v) => 'R$ ' + (v / 1000).toLocaleString('pt-BR') + 'k' })
      : EIXO;
    desenhar('g-fech-mes', { type: 'bar',
      data: { labels: porMes.map(m => rotuloMes(m.chave)),
        datasets: [
          { label: 'Produtivo', stack: 'f', backgroundColor: '#4A90D9',
            data: porMes.map(m => temCusto ? m.custoProd  : m.prod) },
          { label: 'Indireto',  stack: 'f', backgroundColor: '#D68B3C',
            data: porMes.map(m => temCusto ? m.custoIndir : m.indir) },
          { label: 'Falta / atestado', stack: 'f', backgroundColor: '#C9595E',
            data: porMes.map(m => temCusto ? m.custoAbsen : m.absen) },
        ] },
      options: { scales: { x: { stacked: true, ticks: EIXO, grid: GRADE },
                           y: { stacked: true, ticks: eixoY, grid: GRADE, beginAtZero: true } } } });
  }, 0);

  return html;
}


/* ── COBERTURA (admin) ──────────────────────────────────────────
   As outras telas somam o que foi lançado. Esta procura o que NÃO foi:
   quem está sem lançar, há quantos dias úteis, e quais dias faltam.

   Duas coisas que esta tela faz e as demais não:
   • parte da lista de colaboradores (`profiles`), não dos lançamentos —
     assim quem nunca lançou nada aparece, em vez de sumir;
   • ignora o filtro de colaborador, porque a pergunta aqui é
     "quem está faltando", e filtrar por pessoa esconderia a resposta.

   Feriados não são descontados (o painel não tem calendário), então um
   feriado conta como dia sem lançamento. Por isso o texto fala em
   "dias a conferir", não em falta.
   ─────────────────────────────────────────────────────────────── */
/* ── RESULTADO ───────────────────────────────────────────────────
   Lucro e prejuízo, com uma ressalva que a tela declara em voz alta:

   PREJUÍZO o painel calcula sozinho — falta e atestado são hora paga sem
   trabalho entregue, e isso sai direto do custo/hora de cada pessoa.

   LUCRO depende de receita, e receita não está em `registros`. O que
   existe é o `valor_obra` do cadastro de obras. Então a margem só pode
   ser estimada nas obras que têm esse valor preenchido — e a tela diz
   quantas são. Inventar número para as outras seria pior que deixar em
   branco.

   Nada aqui é "lucro contábil": é consumo de contrato em mão de obra.
   Não entram material, imposto, equipamento nem rateio de estrutura.
   ─────────────────────────────────────────────────────────────── */
function telaResultado(linhas) {
  const k = resumir(linhas);
  const temCusto = CUSTOS.quantos() > 0;

  if (!temCusto) {
    return '<div class="box" style="border-color:rgba(210,150,63,.38);margin-bottom:18px">' +
      '<div style="font-weight:600;color:var(--warning-text);margin-bottom:4px">' +
      'Esta tela precisa do custo/hora</div>' +
      '<div class="muted" style="font-size:12.5px">Sem o valor/hora de cada pessoa não há ' +
      'como transformar hora em dinheiro, e lucro e prejuízo ficam indefinidos. ' +
      'Cadastre em <b>Custo/Hora</b> — dá para aplicar um valor único para todos de uma vez.' +
      '</div><button class="primario" style="width:auto;padding:9px 18px;margin-top:12px" ' +
      'data-ir="custohora">Ir para Custo/Hora</button></div>';
  }

  /* ── 1. o resultado da operação no período ─────────────────────
     entregue  = hora de projeto, o que o cliente paga
     apoio     = reunião, gestão, serviço interno, treinamento
     perdido   = falta e atestado, pago sem contrapartida */
  const entregue = k.custoProd;
  const apoio    = k.custoIndir;
  const perdido  = k.custoAbsen;
  const pago     = entregue + apoio + perdido;
  const pctPerda = pago ? perdido / pago : 0;

  let html = '<div class="kpis">' +
    kpi('Custo total pago', fmtBRL(pago), fmtHoras(k.horas) + ' no filtro') +
    kpi('Virou entrega', fmtBRL(entregue),
        fmtPct(pago ? entregue / pago : 0) + ' do custo · hora de projeto', 'ok') +
    kpi('Apoio e estrutura', fmtBRL(apoio),
        fmtPct(pago ? apoio / pago : 0) + ' · reunião, gestão, serviço interno') +
    kpi('Prejuízo direto', fmtBRL(perdido),
        fmtPct(pctPerda) + ' · falta e atestado',
        perdido ? (pctPerda > 0.05 ? 'bad' : 'warn') : 'ok') +
    kpi('Custo médio da hora', fmtBRL2(k.custoHora), 'sobre tudo que foi pago') +
    '</div>';

  /* ── 2. resultado por obra ─────────────────────────────────────
     Só entra obra de verdade: serviço interno e reunião não têm contrato. */
  const porObra = new Map();
  for (const r of linhas) {
    if (!ehProjetoReal(r) || !r.obra) continue;
    if (!porObra.has(r.obra)) porObra.set(r.obra, { horas: 0, custo: 0, pessoas: new Set() });
    const o = porObra.get(r.obra);
    o.horas += r.horas;
    o.custo += r.horas * CUSTOS.valorDe(r.colaborador, r.data);
    o.pessoas.add(r.colaborador);
  }

  const obras = [...porObra.entries()].map(([nome, v]) => {
    const cad   = obraCadastrada(nome);
    const valor = cad ? numBRL(cad.valor_obra) : 0;
    return {
      chave: nome,
      status: cad ? (cad.status || 'EM ANDAMENTO') : '— não cadastrada —',
      valor,
      custo: v.custo,
      horas: v.horas,
      saldo: valor ? valor - v.custo : 0,
      consumido: valor ? v.custo / valor : 0,
      pessoas: v.pessoas.size,
    };
  });

  const comValor = obras.filter(o => o.valor > 0);
  const semValor = obras.filter(o => o.valor <= 0 && o.custo > 0);

  const receita   = comValor.reduce((s, o) => s + o.valor, 0);
  const custoNelas = comValor.reduce((s, o) => s + o.custo, 0);
  const estourou  = comValor.filter(o => o.saldo < 0);

  html += '<div class="box" style="border-color:var(--line-2);margin-bottom:22px">' +
    '<div style="font-weight:600;color:var(--text-primary);margin-bottom:5px">' +
    'O que dá e o que não dá para calcular aqui</div>' +
    '<div class="muted" style="font-size:12.5px">' +
    '<b>' + fmtN(comValor.length) + ' de ' + fmtN(obras.length) + '</b> obras com hora lançada ' +
    'têm valor de contrato preenchido no cadastro. Só nessas dá para estimar margem. ' +
    (semValor.length
      ? 'As outras <b>' + fmtN(semValor.length) + '</b> aparecem na segunda tabela, com o custo ' +
        'que já consumiram — falta só alguém preencher o valor no cadastro de obras.'
      : '') +
    '<br>A conta é <b>valor do contrato − custo de mão de obra</b>. Não entram material, ' +
    'imposto, equipamento nem rateio de estrutura, então o saldo é um teto, não o lucro final.' +
    '</div></div>';

  if (comValor.length) {
    html += '<div class="kpis">' +
      kpi('Contratos medidos', fmtBRL(receita), fmtN(comValor.length) + ' obras com valor') +
      kpi('Mão de obra nelas', fmtBRL(custoNelas),
          fmtPct(receita ? custoNelas / receita : 0) + ' do contrato') +
      kpi('Saldo', fmtBRL(receita - custoNelas),
          receita - custoNelas >= 0 ? 'antes de material e impostos' : 'custo de pessoal já passou do contrato',
          receita - custoNelas >= 0 ? 'ok' : 'bad') +
      kpi('Obras no vermelho', fmtN(estourou.length),
          'custo de pessoal maior que o contrato', estourou.length ? 'bad' : 'ok') +
      '</div>';

    html += secao('Resultado por obra',
      box(tabela('res-obra', [
        { rot: 'Obra',           campo: 'chave',     tipo: 'texto' },
        { rot: 'Status',         campo: 'status',    tipo: 'texto' },
        { rot: 'Contrato',       campo: 'valor',     tipo: 'brl'   },
        { rot: 'Mão de obra',    campo: 'custo',     tipo: 'brl'   },
        { rot: 'Saldo',          campo: 'saldo',     tipo: 'brl'   },
        { rot: '% consumido',    campo: 'consumido', tipo: 'pct', barra: true },
        { rot: 'Horas',          campo: 'horas',     tipo: 'horas' },
      ], comValor, 20, { campo: 'consumido', desc: true })),
      'ordenado pelo que já consumiu do contrato — acima de 100% o pessoal já custou ' +
      'mais que o contrato inteiro');
  }

  if (semValor.length) {
    html += secao('Obras sem valor de contrato cadastrado',
      box(tabela('res-sem-valor', [
        { rot: 'Obra',        campo: 'chave',   tipo: 'texto' },
        { rot: 'Status',      campo: 'status',  tipo: 'texto' },
        { rot: 'Mão de obra', campo: 'custo',   tipo: 'brl', barra: true },
        { rot: 'Horas',       campo: 'horas',   tipo: 'horas' },
        { rot: 'Pessoas',     campo: 'pessoas', tipo: 'num'   },
      ], semValor, 20, { campo: 'custo', desc: true })),
      'já consumiram mão de obra, mas não há valor de contrato para comparar — ' +
      'preencher o campo "Valor da Obra" no cadastro resolve');
  }

  /* ── 3. de onde vem o prejuízo ─────────────────────────────────
     Falta e atestado por pessoa. Serve para conversa, não para punição:
     atestado é direito, e a leitura certa é de volume, não de culpa. */
  const perdaPorPessoa = new Map();
  for (const r of linhas) {
    if (TIPOS[r._tipo].grupo !== 'absen') continue;
    const vh = CUSTOS.valorDe(r.colaborador, r.data);
    if (!perdaPorPessoa.has(r.colaborador))
      perdaPorPessoa.set(r.colaborador, { horas: 0, custo: 0, falta: 0, atestado: 0 });
    const p = perdaPorPessoa.get(r.colaborador);
    p.horas += r.horas;
    p.custo += r.horas * vh;
    if (r._tipo === 'FALTA') p.falta += r.horas; else p.atestado += r.horas;
  }
  const perdas = [...perdaPorPessoa.entries()]
    .map(([nome, v]) => ({ chave: nome, ...v }))
    .filter(p => p.horas > 0);

  if (perdas.length) {
    html += secao('De onde vem o prejuízo',
      box(tabela('res-perda', [
        { rot: 'Colaborador',   campo: 'chave',    tipo: 'texto' },
        { rot: 'Falta (h)',     campo: 'falta',    tipo: 'horas' },
        { rot: 'Atestado (h)',  campo: 'atestado', tipo: 'horas' },
        { rot: 'Total (h)',     campo: 'horas',    tipo: 'horas' },
        { rot: 'Custo',         campo: 'custo',    tipo: 'brl', barra: true },
      ], perdas, 15, { campo: 'custo', desc: true })),
      'hora paga sem trabalho entregue · atestado é direito do trabalhador — ' +
      'o número serve para dimensionar, não para cobrar');
  }

  /* ── 4. mês a mês ──────────────────────────────────────────────
     Mostra se o prejuízo é constante ou foi um mês fora da curva. */
  const meses = agrupar(linhas, r => r._mes).map(m => {
    const rs = linhas.filter(r => r._mes === m.chave);
    const km = resumir(rs);
    return {
      chave: rotuloMes(m.chave),
      _ord: m.chave,
      entregue: km.custoProd,
      apoio: km.custoIndir,
      perdido: km.custoAbsen,
      total: km.custo,
      pct: km.custo ? km.custoAbsen / km.custo : 0,
    };
  });

  if (meses.length > 1) {
    html += secao('Mês a mês',
      box(tabela('res-mes', [
        { rot: 'Mês',             campo: 'chave',    tipo: 'texto' },
        { rot: 'Virou entrega',   campo: 'entregue', tipo: 'brl'   },
        { rot: 'Apoio',           campo: 'apoio',    tipo: 'brl'   },
        { rot: 'Prejuízo',        campo: 'perdido',  tipo: 'brl', barra: true },
        { rot: 'Custo do mês',    campo: 'total',    tipo: 'brl'   },
        { rot: '% perdido',       campo: 'pct',      tipo: 'pct'   },
      ], meses, 12, { campo: '_ord', desc: true })),
      'um mês fora da curva costuma ser período de férias coletivas ou surto de atestado');

    html += secao('Custo por destino, mês a mês',
      box(grafico('g-res-mes', true)),
      'azul é o que virou entrega; laranja é apoio; vermelho é hora paga sem trabalho');

    setTimeout(() => {
      const ord = ordenarPor(meses, '_ord', false);
      desenhar('g-res-mes', {
        type: 'bar',
        data: { labels: ord.map(m => m.chave), datasets: [
          { label: 'Virou entrega', data: ord.map(m => m.entregue), backgroundColor: '#4A90D9', stack: 'c' },
          { label: 'Apoio',         data: ord.map(m => m.apoio),    backgroundColor: '#D68B3C', stack: 'c' },
          { label: 'Prejuízo',      data: ord.map(m => m.perdido),  backgroundColor: '#C9595E', stack: 'c' },
        ] },
        options: {
          scales: { x: { stacked: true, ticks: EIXO, grid: { display: false }, border: BORDA_EIXO },
                    y: { stacked: true, ticks: EIXO, grid: GRADE, border: BORDA_EIXO, beginAtZero: true } },
          plugins: { tooltip: Object.assign({}, DICA, {
            callbacks: { label: (c) => '  ' + c.dataset.label + ': ' + fmtBRL(c.raw) },
          }) },
        },
      });
    }, 0);
  }

  return html;
}


/* ── COBERTURA ───────────────────────────────────────────────────
   Responde duas perguntas que a tabela `registros` sozinha não responde:

     1. Quem deveria estar lançando e não está?
     2. Quando as pessoas lançam — no dia, ou semanas depois?

   A segunda vivia numa aba separada ("Quando Lançaram"). Era a mesma
   pergunta vista de outro ângulo: ambas tratam de disciplina de
   lançamento. Juntar evita abrir duas telas para cobrar a mesma pessoa.

   Quem saiu da empresa NÃO entra na cobrança — aparece numa seção
   própria, porque a empresa ainda precisa do histórico dessa pessoa.
   ─────────────────────────────────────────────────────────────── */
function telaCobertura(linhas) {
  const hoje = isoDe(new Date());
  // Sem filtro de data, vale desde o lançamento mais antigo. Calcula o mínimo
  // em vez de confiar na ordem em que o banco devolveu as linhas.
  let maisAntigo = hoje;
  for (const r of S.linhas) if (r.data && r.data < maisAntigo) maisAntigo = r.data;
  const de   = S.filtros.de  || maisAntigo;
  const ate  = (S.filtros.ate && S.filtros.ate < hoje) ? S.filtros.ate : hoje;

  // A pergunta é "quem sumiu", então o filtro de pessoa não se aplica aqui.
  const base = S.linhas.filter(r => {
    if (de  && r.data < de)  return false;
    if (ate && r.data > ate) return false;
    if (S.filtros.setor && r.setor !== S.filtros.setor) return false;
    return true;
  });

  const uteis = diasUteisEntre(de, ate);

  // o que cada pessoa lançou
  const porPessoa = new Map();
  for (const r of base) {
    if (!porPessoa.has(r.colaborador))
      porPessoa.set(r.colaborador, { dias: new Set(), horas: 0, ultimo: '', setor: r.setor });
    const p = porPessoa.get(r.colaborador);
    p.dias.add(r.data); p.horas += r.horas;
    if (r.data > p.ultimo) p.ultimo = r.data;
    if (r.setor) p.setor = r.setor;
  }

  // último lançamento de sempre, mesmo fora do período filtrado
  const ultimoDeSempre = new Map();
  const horasDeSempre  = new Map();
  for (const r of S.linhas) {
    const a = ultimoDeSempre.get(r.colaborador);
    if (!a || r.data > a) ultimoDeSempre.set(r.colaborador, r.data);
    horasDeSempre.set(r.colaborador, (horasDeSempre.get(r.colaborador) || 0) + r.horas);
  }

  /* ── quem é do quadro hoje ──────────────────────────────────────
     Antes, qualquer nome visto em `registros` entrava na cobrança. Como
     a tabela guarda o histórico de quem já saiu, ex-funcionários
     apareciam eternamente como "98 dias úteis parado". O cadastro de
     `profiles` tem o status — é ele que manda. */
  const perfilDe = new Map();
  S.perfis.forEach(p => { if (p.nome) perfilDe.set(p.nome, p); });

  const situacao = (nome) => {
    const p = perfilDe.get(nome);
    if (!p)          return 'sem-cadastro';   // lançou, mas não está em profiles
    if (p.is_admin)  return 'admin';          // admin não lança
    return (p.status || 'ATIVO').toUpperCase() === 'ATIVO' ? 'ativo' : 'inativo';
  };

  const nomes = new Set();
  S.perfis.forEach(p => {
    if (situacao(p.nome) === 'ativo' && !ehLider(p.nome)) nomes.add(p.nome);
  });
  // quem lançou mas não tem cadastro continua sendo cobrado — sumir do radar
  // seria pior do que aparecer sem setor.
  S.linhas.forEach(r => {
    if (r.colaborador && situacao(r.colaborador) === 'sem-cadastro') nomes.add(r.colaborador);
  });

  const setorDoPerfil = {};
  S.perfis.forEach(p => { if (p.nome) setorDoPerfil[p.nome] = p.setor; });

  const pessoas = [...nomes].map(nome => {
    const p = porPessoa.get(nome);
    const ult = ultimoDeSempre.get(nome) || '';
    const lancados = p ? p.dias.size : 0;
    const faltando = uteis.filter(d => !(p && p.dias.has(d)));
    return {
      chave: nome,
      setor: setorDoPerfil[nome] || (p && p.setor) || '—',
      ultimo: ult,
      atraso: ult ? diasUteisDesde(ult) : null,   // null = nunca lançou
      lancados,
      faltam: faltando.length,
      cobertura: uteis.length ? lancados / uteis.length : 0,
      horas: p ? p.horas : 0,
      diasFaltando: faltando,
      cadastro: situacao(nome) === 'sem-cadastro' ? 'sem cadastro' : '',
    };
  }).filter(p => !(S.filtros.setor && p.setor !== S.filtros.setor));

  // quadro completo, para controle — inclui quem saiu
  const inativos = S.perfis
    .filter(p => situacao(p.nome) === 'inativo' && !ehLider(p.nome))
    .map(p => ({
      chave: p.nome,
      setor: p.setor || '—',
      ultimo: ultimoDeSempre.get(p.nome) || '',
      horas: horasDeSempre.get(p.nome) || 0,
    }))
    .filter(p => !(S.filtros.setor && p.setor !== S.filtros.setor));

  const nunca      = pessoas.filter(p => p.atraso === null);
  const semHoje    = pessoas.filter(p => p.atraso !== null && p.ultimo < hoje && ehDiaUtil(hoje));
  const atrasados  = pessoas.filter(p => p.atraso !== null && p.atraso >= 3);
  const emDia      = pessoas.filter(p => p.atraso === 0);

  /* ── pontualidade: quanto tempo depois as pessoas lançam ────────
     Veio da aba "Quando Lançaram". Depende do carimbo `created_at`;
     registros antigos sem carimbo ficam de fora e isso é declarado. */
  const comCarimbo  = S.linhas.filter(r => r._criadoEm);
  const semCarimbo  = S.linhas.length - comCarimbo.length;
  const temCarimbo  = comCarimbo.length > 0;

  let pontual = null;
  if (temCarimbo) {
    const noPrazo    = comCarimbo.filter(r => r._atraso >= 0 && r._atraso <= 3).length;
    const futuros    = comCarimbo.filter(r => r._atraso < 0);
    pontual = {
      noPrazo, futuros,
      medio: comCarimbo.reduce((s, r) => s + Math.max(0, r._atraso), 0) / comCarimbo.length,
      pct: noPrazo / comCarimbo.length,
    };
  }

  let html = '<div class="kpis">' +
    kpi('Colaboradores ativos', fmtN(pessoas.length),
        S.perfis.length ? 'cobrados de lançamento' : 'vistos nos lançamentos') +
    kpi('Em dia', fmtN(emDia.length), 'lançaram hoje', emDia.length ? 'ok' : '') +
    kpi('Sem lançar hoje', fmtN(semHoje.length),
        ehDiaUtil(hoje) ? 'em ' + fmtData(hoje) : 'hoje não é dia útil',
        semHoje.length ? 'warn' : 'ok') +
    kpi('Atrasados', fmtN(atrasados.length), '3 dias úteis ou mais',
        atrasados.length ? 'bad' : 'ok') +
    kpi('Nunca lançaram', fmtN(nunca.length), 'nenhum registro no sistema',
        nunca.length ? 'bad' : 'ok') +
    kpi('Inativos', fmtN(inativos.length), 'fora da cobrança') +
    (pontual ? kpi('Lançam em até 3 dias', fmtPct(pontual.pct),
        fmtN(pontual.noPrazo) + ' de ' + fmtN(comCarimbo.length),
        pontual.pct > 0.75 ? 'ok' : 'warn') : '') +
    (pontual ? kpi('Data futura', fmtN(pontual.futuros.length),
        'lançou antes de trabalhar', pontual.futuros.length ? 'bad' : 'ok') : '') +
    '</div>';

  html += '<div class="box" style="margin-bottom:18px;border-color:var(--line-2)">' +
    '<span class="muted" style="font-size:12.5px">' +
    'Período conferido: <b>' + fmtData(de) + '</b> a <b>' + fmtData(ate) + '</b> · ' +
    '<b>' + uteis.length + '</b> dias úteis (segunda a sexta). ' +
    'Feriados não são descontados, então aparecem como dia sem lançamento. ' +
    'Quem está marcado como <b>INATIVO</b> no cadastro não é cobrado — a lista dessas ' +
    'pessoas fica mais abaixo.' +
    (S.filtros.colab ? ' O filtro de colaborador não vale nesta tela — ela existe para mostrar quem está faltando.' : '') +
    '</span></div>';

  if (nunca.length) {
    html += secao('Nunca lançaram nada',
      box(tabela('cob-nunca', [
        { rot: 'Colaborador', campo: 'chave',    tipo: 'texto' },
        { rot: 'Setor',       campo: 'setor',    tipo: 'texto' },
        { rot: 'Cadastro',    campo: 'cadastro', tipo: 'texto' },
      ], nunca, 15, { campo: 'chave', desc: false })),
      'estão cadastrados mas nunca usaram o sistema');
  }

  const comAtraso = pessoas.filter(p => p.atraso !== null && p.atraso > 0);
  html += secao('Quem está sem lançar',
    box(tabela('cob-atraso', [
      { rot: 'Colaborador',        campo: 'chave',  tipo: 'texto' },
      { rot: 'Setor',              campo: 'setor',  tipo: 'texto' },
      { rot: 'Último lançamento',  campo: 'ultimo', tipo: 'data'  },
      { rot: 'Dias úteis parado',  campo: 'atraso', tipo: 'num', barra: true },
      { rot: 'Horas no período',   campo: 'horas',  tipo: 'horas' },
    ], comAtraso, 15, { campo: 'atraso', desc: true })),
    comAtraso.length ? 'do mais parado para o menos — só gente ativa' : '');

  html += secao('Cobertura do período',
    box(tabela('cob-geral', [
      { rot: 'Colaborador',     campo: 'chave',     tipo: 'texto' },
      { rot: 'Setor',           campo: 'setor',     tipo: 'texto' },
      { rot: 'Dias lançados',   campo: 'lancados',  tipo: 'num'   },
      { rot: 'Dias a conferir', campo: 'faltam',    tipo: 'num', barra: true },
      { rot: '% coberto',       campo: 'cobertura', tipo: 'pct'   },
      { rot: 'Horas',           campo: 'horas',     tipo: 'horas' },
    ], pessoas, 20, { campo: 'faltam', desc: true })),
    'de ' + uteis.length + ' dias úteis no período · ' + fmtN(pessoas.length) + ' pessoas');

  // ── quadro inteiro, inclusive quem saiu ──
  if (inativos.length) {
    html += secao('Colaboradores inativos',
      box(tabela('cob-inativos', [
        { rot: 'Colaborador',        campo: 'chave',  tipo: 'texto' },
        { rot: 'Setor',              campo: 'setor',  tipo: 'texto' },
        { rot: 'Último lançamento',  campo: 'ultimo', tipo: 'data'  },
        { rot: 'Horas no histórico', campo: 'horas',  tipo: 'horas' },
      ], inativos, 15, { campo: 'ultimo', desc: true })),
      'marcados como INATIVO no cadastro — não entram na cobrança, mas o ' +
      'histórico de horas continua valendo nas outras telas');
  }

  // ── obras paradas ──
  const obraUltimo = new Map();
  for (const r of S.linhas) {
    if (!ehProjetoReal(r) || !r.obra) continue;
    const a = obraUltimo.get(r.obra);
    if (!a || r.data > a.ultimo) obraUltimo.set(r.obra, { ultimo: r.data });
  }
  const obras = [...obraUltimo.entries()].map(([nome, v]) => {
    const o = obraCadastrada(nome);
    return {
      chave: nome,
      ultimo: v.ultimo,
      atraso: diasUteisDesde(v.ultimo),
      status: o ? (o.status || 'EM ANDAMENTO') : '— não cadastrada —',
    };
  }).filter(o => o.atraso >= 5);

  html += secao('Obras sem movimento',
    box(tabela('cob-obras', [
      { rot: 'Obra',               campo: 'chave',  tipo: 'texto' },
      { rot: 'Status no cadastro', campo: 'status', tipo: 'texto' },
      { rot: 'Último lançamento',  campo: 'ultimo', tipo: 'data'  },
      { rot: 'Dias úteis parada',  campo: 'atraso', tipo: 'num', barra: true },
    ], obras, 20, { campo: 'atraso', desc: true })),
    fmtN(obras.length) + ' obras sem nenhuma hora há 5 dias úteis ou mais — ' +
    'confira o status: se está CONCLUIDA, parar é o esperado');

  /* ── a partir daqui, o que era a aba "Quando Lançaram" ────────── */
  if (temCarimbo) {
    const faixas = [
      { rot: 'No mesmo dia',    teste: a => a === 0           },
      { rot: '1 a 3 dias',      teste: a => a >= 1 && a <= 3  },
      { rot: '4 a 7 dias',      teste: a => a >= 4 && a <= 7  },
      { rot: '8 a 30 dias',     teste: a => a >= 8 && a <= 30 },
      { rot: 'mais de 30 dias', teste: a => a > 30            },
      { rot: 'data futura',     teste: a => a < 0             },
    ];
    const dist = faixas.map(f => {
      const rs = comCarimbo.filter(r => f.teste(r._atraso));
      return { chave: f.rot, n: rs.length,
               horas: rs.reduce((s, r) => s + r.horas, 0),
               pct: rs.length / comCarimbo.length };
    });

    // o que entrou nos últimos 7 dias referente a período antigo
    const seteDias = isoDe(new Date(Date.now() - 7 * 86400000));
    const retroRecentes = comCarimbo.filter(r => r._criadoEm >= seteDias && r._atraso > 7);
    if (retroRecentes.length) {
      const mexeuEm = ordenarPor(agrupar(retroRecentes, r => r._mes), 'chave', true)
        .map(m => rotuloMes(m.chave) + ': ' + fmtHoras(m.horasLancadas) + ' h').join('  ·  ');
      html += '<div class="box" style="border-color:rgba(210,150,63,.38);margin-bottom:22px">' +
        '<div style="color:var(--warning-text);font-weight:600;margin-bottom:5px">' +
        'Por que os números mudam de uma medição para outra</div>' +
        '<div class="muted" style="font-size:12.5px">Nos últimos 7 dias entraram <b>' +
        fmtN(retroRecentes.length) + '</b> lançamentos referentes a períodos anteriores, somando <b>' +
        fmtHoras(retroRecentes.reduce((s,r)=>s+r.horas,0)) + ' h</b>. ' +
        'Eles alteraram o total destes meses: <b>' + esc(mexeuEm) + '</b>.<br>' +
        'Isso não é erro do painel nem do sistema — é gente lançando hora com atraso. ' +
        'Um mês só para de mudar quando todo mundo tiver lançado.</div></div>';
    }

    html += secao('Quanto tempo depois as pessoas lançam',
      box(tabela('cob-faixa', [
        { rot: 'Atraso',      campo: 'chave', tipo: 'texto' },
        { rot: 'Lançamentos', campo: 'n',     tipo: 'num', barra: true },
        { rot: '% do total',  campo: 'pct',   tipo: 'pct'   },
        { rot: 'Horas',       campo: 'horas', tipo: 'horas' },
      ], dist, null, { campo: 'n', desc: true })),
      'do dia trabalhado até o dia em que foi digitado' +
      (semCarimbo ? ' · ' + fmtN(semCarimbo) + ' registros sem carimbo de criação ficam fora' : ''));

    html += secao('Mês trabalhado × mês em que foi lançado',
      box(grafico('g-cob-lanc', true)),
      'as barras azuis são o trabalho do mês; a linha laranja, o que foi digitado naquele mês');

    // ranking de quem lança com mais atraso — só gente ativa
    const atrasadosAtivos = comCarimbo.filter(r => r._atraso > 7 && nomes.has(r.colaborador));
    const porColab = agrupar(atrasadosAtivos, r => r.colaborador);
    porColab.forEach(c => {
      const rs = comCarimbo.filter(r => r.colaborador === c.chave);
      c.total = rs.length;
      c.pctAtraso = rs.length ? c.n / rs.length : 0;
      c.pior = rs.length ? Math.max(...rs.map(r => r._atraso || 0)) : 0;
    });
    if (porColab.length) {
      html += secao('Quem lança com mais atraso',
        box(tabela('cob-colab', [
          { rot: 'Colaborador',         campo: 'chave',     tipo: 'texto' },
          { rot: 'Lanç. atrasados',     campo: 'n',         tipo: 'num', barra: true },
          { rot: 'De um total de',      campo: 'total',     tipo: 'num'   },
          { rot: '% atrasado',          campo: 'pctAtraso', tipo: 'pct'   },
          { rot: 'Maior atraso (dias)', campo: 'pior',      tipo: 'num'   },
        ], porColab, 15, { campo: 'n', desc: true })),
        'acima de 7 dias entre trabalhar e lançar — só colaboradores ativos');
    }

    if (pontual.futuros.length) {
      const fut = pontual.futuros.map(r => ({
        chave: r.colaborador, obra: r.obra,
        criado: r._criadoEm, data: r.data,
        frente: Math.abs(r._atraso), horas: r.horas,
      }));
      html += secao('Lançamentos com data futura',
        box(tabela('cob-futuro', [
          { rot: 'Colaborador',   campo: 'chave',  tipo: 'texto' },
          { rot: 'Obra',          campo: 'obra',   tipo: 'texto' },
          { rot: 'Digitado em',   campo: 'criado', tipo: 'data'  },
          { rot: 'Data lançada',  campo: 'data',   tipo: 'data'  },
          { rot: 'Dias à frente', campo: 'frente', tipo: 'num', barra: true },
          { rot: 'Horas',         campo: 'horas',  tipo: 'horas' },
        ], fut, 15, { campo: 'frente', desc: true })),
        'a pessoa lançou hora de um dia que ainda não chegou — quase sempre ' +
        'data digitada errada, e infla um mês que ainda não aconteceu');
    }
  }

  // ── dias faltando de quem tem mais buraco ──
  const piores = ordenarPor(pessoas.filter(p => p.faltam > 0), 'faltam', true).slice(0, 12);
  if (piores.length) {
    html += secao('Quais dias estão faltando',
      box('<div class="tabela-rolagem"><table><thead><tr>' +
        '<th>Colaborador</th><th>Dias úteis sem lançamento</th>' +
        '</tr></thead><tbody>' +
        piores.map(p => '<tr><td>' + esc(p.chave) + '</td><td class="livre">' +
          p.diasFaltando.slice(0, 22).map(d => fmtData(d)).join('  ·  ') +
          (p.diasFaltando.length > 22 ? '  … e mais ' + (p.diasFaltando.length - 22) : '') +
          '</td></tr>').join('') +
        '</tbody></table></div>'),
      'as 12 maiores lacunas — confira se são feriados antes de cobrar');
  }

  if (temCarimbo) {
    setTimeout(() => {
      const meses = [...new Set([...comCarimbo.map(r => r._mes), ...comCarimbo.map(r => r._mesCriado)])]
        .filter(Boolean).sort();
      const trabalhadas = meses.map(m =>
        comCarimbo.filter(r => r._mes === m).reduce((s, r) => s + r.horas, 0));
      const digitadas = meses.map(m =>
        comCarimbo.filter(r => r._mesCriado === m).reduce((s, r) => s + r.horas, 0));
      desenhar('g-cob-lanc', {
        type: 'bar',
        data: { labels: meses.map(rotuloMes), datasets: [
          { label: 'Horas do mês (trabalho)', data: trabalhadas, backgroundColor: '#4A90D9' },
          { label: 'Horas digitadas no mês',  data: digitadas, type: 'line',
            borderColor: '#D68B3C', backgroundColor: '#D68B3C', borderWidth: 2,
            tension: .3, pointRadius: 3 },
        ] },
      });
    }, 0);
  }

  return html;
}


/* ── DETALHE DA OBRA ─────────────────────────────────────────────
   Abre uma janela com tudo o que existe sobre uma obra: o que está no
   cadastro (contrato, prazo, responsáveis, escopo) e o que veio dos
   lançamentos (quem trabalhou, quando, em qual disciplina, fazendo o quê).

   Só leitura, como o resto do painel.
   ─────────────────────────────────────────────────────────────── */
function abrirDetalheObra(nomeObra) {
  const reg = S.linhas.filter(r => r.obra === nomeObra);
  const o   = obraCadastrada(nomeObra);
  const k   = resumir(reg);

  const linha = (rot, val) => val
    ? '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--line)">' +
      '<span class="muted" style="min-width:140px;font-size:11.5px">' + rot + '</span>' +
      '<span style="font-size:12.5px">' + esc(val) + '</span></div>'
    : '';

  const dinheiro = (v) => (v && Number(v)) ? fmtBRL(Number(v)) : '';

  let cadastro = '';
  if (o) {
    cadastro =
      linha('Status',            o.status || 'EM ANDAMENTO') +
      linha('Prioridade',        o.prioridade) +
      linha('Tipo de obra',      o.tipo_obra) +
      linha('Código do projeto', o.codigo_projeto) +
      linha('Início',            o.data_inicio ? fmtData(o.data_inicio) : '') +
      linha('Prazo final',       o.data_fim ? fmtData(o.data_fim) : '') +
      linha('Valor do contrato', dinheiro(o.valor_obra)) +
      linha('Área',              o.area) +
      linha('Cidade / Estado',   [o.sigla_cidade, o.cliente_estado].filter(Boolean).join(' / ')) +
      linha('Recurso',           o.recurso_financeiro) +
      linha('Responsáveis',      o.responsaveis) +
      linha('Resp. técnicos',    o.responsaveis_tecnicos) +
      linha('Cliente',           o.cliente_endereco) +
      linha('Contrato',          o.contrato_info) +
      linha('Escopo',            o.escopo);
  }
  if (!cadastro) {
    cadastro = '<div class="muted" style="font-size:12.5px;padding:8px 0">' +
      'Esta obra não está no cadastro — só existe nos lançamentos. ' +
      'Pode ser nome digitado diferente do cadastrado.</div>';
  }

  // quanto do contrato já foi em mão de obra
  let barraCusto = '';
  if (o && numBRL(o.valor_obra) && CUSTOS.quantos()) {
    const pct = k.custo / numBRL(o.valor_obra);
    barraCusto = '<div style="margin-top:12px">' +
      '<div class="muted" style="font-size:11.5px;margin-bottom:5px">Consumo do contrato em mão de obra</div>' +
      '<div style="height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden">' +
      '<div style="height:100%;width:' + Math.min(100, pct * 100).toFixed(1) + '%;background:' +
      (pct > 0.8 ? 'var(--bad)' : pct > 0.5 ? 'var(--warn)' : 'var(--cat-prod)') + '"></div></div>' +
      '<div style="font-size:12px;margin-top:5px">' + fmtBRL(k.custo) + ' de ' +
      fmtBRL(numBRL(o.valor_obra)) + ' — <b>' + fmtPct(pct) + '</b></div></div>';
  }

  const porColab = ordenarPor(agrupar(reg, r => r.colaborador), 'horas', true);
  const porDisc  = ordenarPor(agrupar(reg, r => r.disciplina),  'horas', true);
  const ultimos  = ordenarPor(reg, 'data', true).slice(0, 60);

  const tab = (titulo, html) =>
    '<div class="secao" style="margin-bottom:18px"><h2>' + titulo + '</h2>' + html + '</div>';

  const corpo =
    '<div class="grid2" style="margin-bottom:18px">' +
      '<div><div class="secao"><h2>Cadastro da obra</h2>' + box(cadastro) + '</div></div>' +
      '<div><div class="secao"><h2>Números do período filtrado</h2>' + box(
        '<div class="kpis" style="margin-bottom:0">' +
          kpi('Horas', fmtHoras(k.horas), fmtN(k.n) + ' lançamentos') +
          kpi('Pessoas', fmtN(k.nColabs), fmtN(k.nDatas) + ' dias com movimento') +
          (CUSTOS.quantos() ? kpi('Custo', fmtBRL(k.custo), 'mão de obra') : '') +
        '</div>' + barraCusto) + '</div></div>' +
    '</div>' +

    tab('Quem trabalhou', tabela('det-colab', [
      { rot: 'Colaborador', campo: 'chave',  tipo: 'texto' },
      { rot: 'Horas',       campo: 'horas',  tipo: 'horas', barra: true },
      { rot: 'Dias',        campo: 'nDatas', tipo: 'num'   },
      { rot: 'Lanç.',       campo: 'n',      tipo: 'num'   },
    ], porColab, 40, { campo: 'horas', desc: true })) +

    (porDisc.length ? tab('Por disciplina', tabela('det-disc', [
      { rot: 'Disciplina', campo: 'chave',  tipo: 'texto' },
      { rot: 'Horas',      campo: 'horas',  tipo: 'horas', barra: true },
      { rot: 'Pessoas',    campo: 'nColabs',tipo: 'num'   },
    ], porDisc, 30, { campo: 'horas', desc: true })) : '') +

    tab('Últimos lançamentos',
      '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Data</th><th>Colaborador</th><th>Disciplina</th><th class="num">Horas</th>' +
      '<th>Tarefa / Observação</th></tr></thead><tbody>' +
      ultimos.map(r => '<tr>' +
        '<td>' + fmtData(r.data) + '</td>' +
        '<td>' + esc(r.colaborador) + '</td>' +
        '<td>' + esc(r.disciplina || '—') + '</td>' +
        '<td class="num">' + (r.hora_str || fmtHoras(r.horas)) + '</td>' +
        '<td class="livre">' + esc(r.tarefa || r.obs || '') + '</td>' +
        '</tr>').join('') +
      '</tbody></table></div>' +
      (reg.length > 60 ? '<div class="muted" style="font-size:11px;padding:7px 9px">' +
        'mostrando 60 de ' + fmtN(reg.length) + '</div>' : ''));

  $('#detalhe-titulo').textContent = nomeObra;
  $('#detalhe-corpo').innerHTML = corpo;
  $('#detalhe').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}

function fecharDetalhe() {
  $('#detalhe').classList.add('oculto');
  $('#detalhe-corpo').innerHTML = '';
  document.body.style.overflow = '';
}


/* ── QUANDO LANÇARAM (admin) ─────────────────────────────────────
   Cada registro tem duas datas:
     `data`       — o dia em que a pessoa trabalhou
     `created_at` — o dia em que ela digitou isso no sistema

   Quando as duas são diferentes, o lançamento é retroativo: ele entra
   num mês que já tinha sido medido e muda o total. É por isso que um
   número conferido na semana passada não bate com o de hoje.

   Esta tela mostra esse descompasso, e ignora o filtro de período —
   a pergunta aqui é sobre o histórico inteiro.
   ─────────────────────────────────────────────────────────────── */
/* ── CONFERÊNCIA COM O SISTEMA ───────────────────────────────────
   O registro-horas pagina ordenando por `data`, que se repete centenas
   de vezes. O Postgres não garante a ordem entre linhas empatadas de
   uma consulta para outra, então algumas vêm duas vezes e outras não
   vêm — e o total de cada obra sai errado, para mais ou para menos.

   Não podemos alterar aquele sistema: ele está integrado à empresa.
   O que dá para fazer é provar a diferença sempre que alguém perguntar.

   Esta tela faz as DUAS leituras ao vivo e compara:
     • por `id`   — o jeito correto, que o painel usa
     • por `data` — o jeito do sistema, com o defeito

   As duas são somente leitura.
   ─────────────────────────────────────────────────────────────── */
async function rodarConferencia() {
  const alvo = $('#conf-resultado');
  const btn  = $('#btn-conferir');
  if (!alvo) return;
  btn.disabled = true; btn.textContent = 'Conferindo…';
  alvo.innerHTML = '<div class="vazio">Lendo o banco das duas formas, aguarde…</div>';

  const ler = async (coluna, crescente) => {
    let todos = [], de = 0;
    while (true) {
      let q = sb.from('registros').select('id,obra,horas')
        .order(coluna, { ascending: crescente }).range(de, de + 999);
      if (!S.admin) q = q.eq('user_id', S.usuario.id);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      todos = todos.concat(data);
      if (data.length < 1000) break;
      de += 1000;
    }
    return todos;
  };

  let certo, comoOSistema, totalReal;
  try {
    let qc = sb.from('registros').select('id', { count: 'exact', head: true });
    if (!S.admin) qc = qc.eq('user_id', S.usuario.id);
    totalReal = (await qc).count;
    certo        = await ler('id', true);
    comoOSistema = await ler('data', false);
  } catch (e) {
    alvo.innerHTML = '<div class="vazio">Não foi possível ler: ' + esc(e.message || e) + '</div>';
    btn.disabled = false; btn.textContent = '↻ Conferir de novo';
    return;
  }

  const unicosCerto  = new Set(certo.map(r => r.id)).size;
  const unicosSistema = new Set(comoOSistema.map(r => r.id)).size;
  const duplicadas = comoOSistema.length - unicosSistema;
  const perdidas   = totalReal - unicosSistema;

  const somarPorObra = (arr) => {
    const m = {};
    arr.forEach(r => { if (!r.obra) return; m[r.obra] = (m[r.obra] || 0) + (Number(r.horas) || 0); });
    return m;
  };
  const a = somarPorObra(certo), b = somarPorObra(comoOSistema);
  const divergentes = Object.keys(a)
    .map(o => ({ chave: o, correto: a[o], sistema: b[o] || 0, dif: (b[o] || 0) - a[o] }))
    .filter(d => Math.abs(d.dif) > 0.01)
    .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));

  const totalDif = divergentes.reduce((s, d) => s + Math.abs(d.dif), 0);

  let html = '<div class="kpis">' +
    kpi('Registros no banco', fmtN(totalReal), 'a verdade') +
    kpi('Lidos pelo painel', fmtN(unicosCerto),
        unicosCerto === totalReal ? 'tudo, sem repetir' : 'DIVERGE',
        unicosCerto === totalReal ? 'ok' : 'bad') +
    kpi('Repetidos na leitura do sistema', fmtN(duplicadas),
        'contados duas vezes', duplicadas ? 'bad' : 'ok') +
    kpi('Perdidos na leitura do sistema', fmtN(perdidas),
        'não chegaram na tela', perdidas ? 'bad' : 'ok') +
    kpi('Obras com valor diferente', fmtN(divergentes.length),
        fmtHoras(totalDif) + ' h de erro somado', divergentes.length ? 'warn' : 'ok') +
    '</div>';

  if (!divergentes.length) {
    html += '<div class="box"><span style="color:var(--success-text)">' +
      'Nesta leitura as duas formas deram o mesmo resultado.</span> ' +
      '<span class="muted">Isso acontece de vez em quando — o sorteio das páginas ' +
      'variou a favor. Rode de novo daqui a pouco e provavelmente vai divergir.</span></div>';
  } else {
    html += secao('Onde o sistema mostra valor diferente',
      box(tabela('conf-obras', [
        { rot: 'Obra',                 campo: 'chave',   tipo: 'texto' },
        { rot: 'Correto (painel)',     campo: 'correto', tipo: 'horas' },
        { rot: 'O sistema mostraria',  campo: 'sistema', tipo: 'horas' },
        { rot: 'Erro',                 campo: 'dif',     tipo: 'horas', barra: true },
      ], divergentes, 60, { campo: 'dif', desc: true })),
      'positivo = o sistema infla; negativo = o sistema esconde');
  }

  html += '<div class="box" style="margin-top:18px">' +
    '<div class="muted" style="font-size:12.5px">' +
    'Medido agora, ao vivo, lendo o banco das duas formas. ' +
    'Nenhum dado foi alterado. O resultado muda a cada execução — é essa ' +
    'instabilidade que faz os dois sistemas nunca baterem.' +
    '</div></div>';

  alvo.innerHTML = html;
  btn.disabled = false; btn.textContent = '↻ Conferir de novo';
}

function blocoConferencia() {
  return '<div class="box" style="border-color:var(--line-2);margin-bottom:22px">' +
    '<div style="display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap">' +
      '<div style="flex:1 1 380px">' +
        '<div style="font-weight:600;color:var(--text-primary);margin-bottom:4px">' +
        'Por que o Registro de Horas mostra outro número</div>' +
        '<div class="muted" style="font-size:12.5px">' +
        'Aquele sistema lê os lançamentos de um jeito que repete algumas linhas e ' +
        'perde outras, mudando a cada carregamento. Como ele não pode ser alterado, ' +
        'use este botão para medir a diferença na hora e mostrar a quem perguntar.' +
        '</div>' +
      '</div>' +
      '<button id="btn-conferir" class="primario" style="width:auto;padding:9px 18px">' +
      '⟳ Conferir agora</button>' +
    '</div>' +
    '<div id="conf-resultado" style="margin-top:var(--s4)"></div>' +
    '</div>';
}

/* ───────────────────────────────────────────────────────────────
   11. RENDER
   ─────────────────────────────────────────────────────────────── */
function render() {
  lerFiltros();
  limparGraficos();
  const linhas = filtrar();

  $('#contador').textContent = fmtN(linhas.length) + ' de ' + fmtN(S.linhas.length) + ' registros';

  const av = $('#aviso-integridade');
  if (av) {
    const i = S.integridade;
    if (S.modoSistema && i) {
      // modo espelho: mostra o que está sendo reproduzido, sem alarme
      av.classList.remove('oculto');
      av.style.borderColor = 'rgba(210,150,63,.38)';
      av.style.background  = 'rgba(217,151,63,.10)';
      av.style.color       = 'var(--warning-text)';
      av.innerHTML = '<b>Modo "igual ao sistema" ligado</b> — o painel está lendo do mesmo jeito ' +
        'que o Registro de Horas, inclusive repetindo e perdendo linhas. ' +
        'Nesta leitura: <b>' + fmtN(i.repetidos) + '</b> repetidas e <b>' +
        fmtN(i.perdidos == null ? 0 : i.perdidos) + '</b> não vieram, de ' +
        fmtN(i.totalNoBanco) + ' no banco. ' +
        'Estes números mudam a cada Atualizar. Desmarque a caixa para ver os valores reais.';
    } else {
      av.style.borderColor = 'rgba(210,102,107,.42)';
      av.style.background  = 'rgba(201,89,94,.1)';
      av.style.color       = 'var(--danger-text)';
      const problema = i && !i.ok;
      av.classList.toggle('oculto', !problema);
      if (problema) {
        av.textContent = '⚠ Leitura incompleta: o banco tem ' + fmtN(i.totalNoBanco) +
          ' registros e o painel carregou ' + fmtN(i.carregados) +
          '. Clique em Atualizar; se persistir, os números desta tela estão subestimados.';
      }
    }
  }
  $('#resumo-base').textContent = S.admin
    ? fmtN(S.linhas.length) + ' lançamentos · ' + new Set(S.linhas.map(r => r.colaborador)).size + ' colaboradores'
    : 'seus lançamentos';
  $('#txt-atualizado').textContent = textoAtualizado();

  let html;
  switch (S.aba) {
    case 'colaboradores': html = telaAgrupada(linhas, 'Colaborador', r => r.colaborador, 'tab-colab'); break;
    case 'obras':         html = telaAgrupada(linhas, 'Obra',        r => r.obra,        'tab-obra', true); break;
    case 'setores':       html = telaAgrupada(linhas, 'Setor',       r => r.setor,       'tab-setor'); break;
    case 'disciplinas':   html = telaAgrupada(linhas, 'Disciplina',  r => r.disciplina,  'tab-disc'); break;
    case 'indireto':      html = telaIndireto(linhas);   break;
    case 'custos':        html = telaCustos(linhas);     break;
    case 'fechamento':    html = telaFechamento(linhas); break;
    case 'resultado':     html = telaResultado(linhas);  break;
    case 'custohora':     html = telaCustoHora(linhas);  break;
    case 'cobertura':     html = telaCobertura(linhas);  break;
    case 'alertas':       html = telaAlertas(linhas);    break;
    case 'registros':     html = telaRegistros(linhas);  break;
    default:              html = telaResumo(linhas);
  }
  $('#conteudo').innerHTML = html;
}

/* ───────────────────────────────────────────────────────────────
   12. EXPORTAÇÃO
   ─────────────────────────────────────────────────────────────── */
/* Planilha das obras — uma linha por obra, com tudo o que a tela mostra
   mais o que fica no cadastro. Serve para a análise fora do painel, onde
   dá para cruzar com planilha de contrato, medição, etc.

   Duas abas: as obras com hora lançada e as cadastradas que estão paradas.
   Sem a segunda, uma obra que ninguém tocou some da análise justamente
   quando ela é o caso mais interessante. */
function exportarObrasExcel() {
  const dados = S.obrasNaTela || [];
  if (!dados.length) { alert('Nenhuma obra no filtro atual.'); return; }

  const FMT_HORA = '[h]:mm';
  const FMT_BRL  = 'R$ #,##0';
  const FMT_PCT  = '0.0%';
  const emHoras  = (h) => (Number(h) || 0) / 24;

  const col = (n) => {
    let t = '';
    for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      t = String.fromCharCode(65 + (n - 1) % 26) + t;
    }
    return t;
  };
  const formatar = (aba, indice, de, ate, z) => {
    const letra = col(indice);
    for (let i = de; i <= ate; i++) {
      const c = aba[letra + i];
      if (c && typeof c.v === 'number') { c.t = 'n'; c.z = z; }
    }
  };

  // último lançamento de cada obra, mesmo fora do filtro de data
  const ultimo = new Map();
  for (const r of S.linhas) {
    if (!r.obra) continue;
    const a = ultimo.get(r.obra);
    if (!a || r.data > a) ultimo.set(r.obra, r.data);
  }

  const cab = ['Obra', 'Status', 'Prioridade', 'Cidade', 'Estado', 'Tipo de obra',
               'Horas', 'Produtivas', 'Indireto', '% produtivas',
               'Lançamentos', 'Dias com movimento', 'Pessoas',
               'Custo de mão de obra', 'Valor do contrato', '% consumido', 'Saldo',
               'Data início', 'Prazo', 'Último lançamento', 'Dias úteis parada'];

  const aoa = [cab];
  ordenarPor(dados, 'horas', true).forEach(d => {
    const o   = obraCadastrada(d.chave);
    const val = o ? numBRL(o.valor_obra) : 0;
    const ult = ultimo.get(d.chave) || '';
    aoa.push([
      d.chave,
      o ? (o.status || 'EM ANDAMENTO') : '— não cadastrada —',
      o ? (o.prioridade || '') : '',
      o ? (o.sigla_cidade || '') : '',
      o ? (o.cliente_estado || '') : '',
      o ? (o.tipo_obra || '') : '',
      emHoras(d.horas), emHoras(d.prod), emHoras(d.indir), d.taxaProd || 0,
      d.n || 0, d.nDatas || 0, d.nColabs || 0,
      d.custo || 0, val, val ? (d.custo || 0) / val : 0, val ? val - (d.custo || 0) : 0,
      o && o.data_inicio ? fmtData(o.data_inicio) : '',
      o && o.data_fim    ? fmtData(o.data_fim)    : '',
      ult ? fmtData(ult) : '',
      ult ? diasUteisDesde(ult) : '',
    ]);
  });

  const aba = XLSX.utils.aoa_to_sheet(aoa);
  const ultLinha = aoa.length;
  [6, 7, 8].forEach(i => formatar(aba, i, 2, ultLinha, FMT_HORA));
  [9, 15].forEach(i => formatar(aba, i, 2, ultLinha, FMT_PCT));
  [13, 14, 16].forEach(i => formatar(aba, i, 2, ultLinha, FMT_BRL));
  aba['!cols'] = cab.map((c, i) => ({ wch: i === 0 ? 38 : Math.max(11, c.length + 2) }));
  aba['!autofilter'] = { ref: 'A1:' + col(cab.length - 1) + ultLinha };
  aba['!freeze'] = { xSplit: 1, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba, 'Obras');

  // ── aba 2: cadastradas sem nenhuma hora ──
  const comHoras = new Set(dados.map(d => normalizar(d.chave)));
  const paradas = Object.values(S.obras)
    .filter(o => o.ativo !== false && !comHoras.has(normalizar(o.nome)))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  if (paradas.length) {
    const cab2 = ['Obra', 'Status', 'Prioridade', 'Cidade', 'Estado',
                  'Valor do contrato', 'Data início', 'Prazo', 'Responsáveis'];
    const aoa2 = [cab2];
    paradas.forEach(o => aoa2.push([
      o.nome, o.status || 'EM ANDAMENTO', o.prioridade || '',
      o.sigla_cidade || '', o.cliente_estado || '', numBRL(o.valor_obra),
      o.data_inicio ? fmtData(o.data_inicio) : '',
      o.data_fim    ? fmtData(o.data_fim)    : '',
      o.responsaveis || '',
    ]));
    const aba2 = XLSX.utils.aoa_to_sheet(aoa2);
    formatar(aba2, 5, 2, aoa2.length, FMT_BRL);
    aba2['!cols'] = cab2.map((c, i) => ({ wch: i === 0 ? 38 : Math.max(12, c.length + 2) }));
    aba2['!autofilter'] = { ref: 'A1:' + col(cab2.length - 1) + aoa2.length };
    XLSX.utils.book_append_sheet(wb, aba2, 'Cadastradas sem horas');
  }

  XLSX.writeFile(wb, 'obras_' + isoDe(new Date()) + '.xlsx');
}


function exportarExcel() {
  const linhas = filtrar();
  if (!linhas.length) { alert('Nada para exportar no filtro atual.'); return; }

  // Formato de hora IGUAL ao da exportação do Registro de Horas.
  // No Excel, duração é fração de dia (8h = 8/24) e o formato é '[h]:mm'.
  // Os colchetes em [h] impedem que a soma zere a cada 24h: sem eles,
  // 4940 horas apareceriam como 20:52 em vez de 4940:52.
  const FMT_HORA = '[h]:mm';
  const emHoras = (h) => (Number(h) || 0) / 24;

  const col = (n) => {           // 0 -> 'A', 25 -> 'Z', 26 -> 'AA'
    let s = '';
    for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(65 + (n - 1) % 26) + s;
    }
    return s;
  };

  // aplica o formato de duração numa coluna inteira da aba
  const formatarHoras = (aba, indiceColuna, primeiraLinha, ultimaLinha) => {
    const letra = col(indiceColuna);
    for (let i = primeiraLinha; i <= ultimaLinha; i++) {
      const c = aba[letra + i];
      if (c && typeof c.v === 'number') { c.t = 'n'; c.z = FMT_HORA; }
    }
  };

  const wb = XLSX.utils.book_new();

  /* ── aba Registros: mesmas colunas, mesma ordem e mesmo formato do
        Registro de Horas. "Tipo de hora" vai no fim, para não deslocar
        as colunas que são comparadas lado a lado. ── */
  const aoa = [['Data','Colaborador','Setor','Obra / Projeto','Disciplina',
                'Tarefa','Horas','Observação','Tipo de hora']];
  ordenarPor(linhas, 'data', true).forEach(r => aoa.push([
    fmtData(r.data), r.colaborador || '', r.setor || '', r.obra || '',
    r.disciplina || '', r.tarefa || '', emHoras(r.horas), r.obs || '',
    TIPOS[r._tipo].nome,
  ]));

  const abaReg = XLSX.utils.aoa_to_sheet(aoa);
  formatarHoras(abaReg, 6, 2, aoa.length);          // coluna G = Horas

  // linha TOTAL no mesmo lugar que a dele: rótulo na coluna E, soma na G
  const lTotal = aoa.length + 1;
  abaReg['E' + lTotal] = { t: 's', v: 'TOTAL' };
  abaReg['G' + lTotal] = { t: 'n', f: 'SUM(G2:G' + aoa.length + ')', z: FMT_HORA };
  abaReg['!ref'] = 'A1:I' + lTotal;
  abaReg['!cols'] = [{wch:12},{wch:26},{wch:19},{wch:26},{wch:23},
                     {wch:26},{wch:11},{wch:31},{wch:15}];
  XLSX.utils.book_append_sheet(wb, abaReg, 'Registros');

  /* ── aba Resumo: as colunas de hora também em [h]:mm ── */
  const resumoAoA = [['Colaborador','Horas pagas','Produtivas','Indiretas','Falta/atestado',
    'Férias/feriado (fora)','% Produtivo','% Ausência','Dias-pessoa','h/dia',
    'Custo produtivo','Custo indireto','Custo falta/atestado','Custo total']];
  ordenarPor(agrupar(linhas, r => r.colaborador), 'horas', true).forEach(g => resumoAoA.push([
    g.chave,
    emHoras(g.horas), emHoras(g.prod), emHoras(g.indir), emHoras(g.absen), emHoras(g.fora),
    +(g.taxaProd * 100).toFixed(1), +(g.taxaAbsen * 100).toFixed(1),
    g.nDias, emHoras(g.mediaDia),
    +g.custoProd.toFixed(2), +g.custoIndir.toFixed(2), +g.custoAbsen.toFixed(2), +g.custo.toFixed(2),
  ]));

  const abaRes = XLSX.utils.aoa_to_sheet(resumoAoA);
  [1,2,3,4,5,9].forEach(i => formatarHoras(abaRes, i, 2, resumoAoA.length));  // B..F e J
  const rTotal = resumoAoA.length + 1;
  abaRes['A' + rTotal] = { t: 's', v: 'TOTAL' };
  [1,2,3,4,5].forEach(i => {
    const L = col(i);
    abaRes[L + rTotal] = { t: 'n', f: 'SUM(' + L + '2:' + L + resumoAoA.length + ')', z: FMT_HORA };
  });
  [10,11,12,13].forEach(i => {
    const L = col(i);
    abaRes[L + rTotal] = { t: 'n', f: 'SUM(' + L + '2:' + L + resumoAoA.length + ')' };
  });
  abaRes['!ref'] = 'A1:N' + rTotal;
  abaRes['!cols'] = [{wch:26},{wch:12},{wch:12},{wch:12},{wch:15},{wch:19},
                     {wch:12},{wch:12},{wch:12},{wch:9},
                     {wch:16},{wch:15},{wch:19},{wch:14}];
  XLSX.utils.book_append_sheet(wb, abaRes, 'Resumo');

  XLSX.writeFile(wb, 'produtividade_' + isoDe(new Date()) + '.xlsx');
}

/* ───────────────────────────────────────────────────────────────
   12b. ATUALIZAÇÃO AUTOMÁTICA

   O Supabase tem "realtime" de verdade, mas ligar isso exige habilitar
   a replicação da tabela no painel do projeto — acesso que não temos.
   Então o painel relê sozinho: a cada poucos minutos, e sempre que a
   aba volta a ficar visível. Para o uso deste painel é o suficiente.
   ─────────────────────────────────────────────────────────────── */
const INTERVALO_ATUALIZAR = 3 * 60 * 1000;   // 3 minutos
const OCULTO_PARA_RELER   = 60 * 1000;       // volta à aba após 1 min → relê

function textoAtualizado() {
  if (!S.atualizadoEm) return '';
  const seg = Math.round((Date.now() - S.atualizadoEm.getTime()) / 1000);
  if (seg < 45)  return 'atualizado agora';
  if (seg < 90)  return 'atualizado há 1 min';
  if (seg < 3600) return 'atualizado há ' + Math.round(seg / 60) + ' min';
  return 'atualizado ' + S.atualizadoEm.toLocaleTimeString('pt-BR',
    { hour: '2-digit', minute: '2-digit' });
}

async function atualizarAutomatico() {
  if (!S.usuario) return;
  if (document.hidden) return;                  // aba em segundo plano: não gasta requisição
  if (S.aba === 'custohora') return;            // não atrapalha o cadastro de valores
  await carregarDados(true);
}

/* ── TEMPO REAL ──────────────────────────────────────────────────
   O Supabase avisa o navegador quando a tabela muda, sem precisar
   perguntar de tempos em tempos. Mas isso só chega se a tabela
   `registros` estiver na publicação de realtime do projeto — e o
   subscribe conecta mesmo quando ela não está. Ou seja: "conectado"
   NÃO prova que funciona; prova é receber um evento.

   Por isso o selo do topo só vira "ao vivo" quando o primeiro evento
   de verdade chega, e a releitura a cada 3 minutos continua ligada
   como rede de segurança.

   Nada aqui altera o sistema de Registro de Horas: o painel apenas
   escuta o banco.
   ─────────────────────────────────────────────────────────────── */
function marcarSeloTempoReal(estado, dica) {
  const el = $('#selo-tempo-real');
  if (!el) return;
  el.classList.toggle('aovivo', estado === 'aovivo');
  el.textContent = estado === 'aovivo' ? 'ao vivo'
                 : estado === 'ligando' ? '⏱ conectando…'
                 : '⏱ periódico';
  el.title = dica || '';
}

function ligarRealtime() {
  if (S.canalRealtime) { try { sb.removeChannel(S.canalRealtime); } catch (e) {} }
  marcarSeloTempoReal('ligando');

  S.canalRealtime = sb.channel('painel-registros')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'registros' },
        () => {
          S.ultimoEventoEm = new Date();
          if (!S.aoVivo) {
            S.aoVivo = true;
            marcarSeloTempoReal('aovivo',
              'O banco avisa o painel na hora em que alguém lança. Confirmado às ' +
              S.ultimoEventoEm.toLocaleTimeString('pt-BR'));
          }
          // Vários lançamentos seguidos geram vários eventos: espera 1,5 s
          // e relê uma vez só, em vez de uma vez por evento.
          clearTimeout(S.debounceRealtime);
          S.debounceRealtime = setTimeout(() => {
            if (S.aba !== 'custohora') carregarDados(true);
          }, 1500);
        })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // conectado, mas ainda sem prova de que a tabela está publicada
        if (!S.aoVivo) marcarSeloTempoReal('periodico',
          'Conectado ao banco, aguardando o primeiro lançamento para confirmar. ' +
          'Até lá, o painel relê a cada 3 minutos.');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        S.aoVivo = false;
        marcarSeloTempoReal('periodico',
          'Sem conexão ao vivo — o painel relê a cada 3 minutos.');
        setTimeout(ligarRealtime, 20000);   // tenta de novo mais tarde
      } else if (status === 'CLOSED') {
        S.aoVivo = false;
        marcarSeloTempoReal('periodico', 'Conexão encerrada.');
      }
    });
}

function desligarRealtime() {
  clearTimeout(S.debounceRealtime);
  if (S.canalRealtime) { try { sb.removeChannel(S.canalRealtime); } catch (e) {} }
  S.canalRealtime = null; S.aoVivo = false;
}

function ligarAtualizacaoAutomatica() {
  if (S.timerAtualizar) clearInterval(S.timerAtualizar);
  S.timerAtualizar = setInterval(atualizarAutomatico, INTERVALO_ATUALIZAR);

  // mantém o "há X min" correndo mesmo sem recarregar
  setInterval(() => {
    const el = $('#txt-atualizado');
    if (el && S.usuario) el.textContent = textoAtualizado();
  }, 20000);

  // ao voltar para a aba depois de um tempo, relê antes de a pessoa olhar
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.ocultoDesde = Date.now(); return; }
    const parada = Date.now() - (S.ocultoDesde || 0);
    if (S.usuario && parada > OCULTO_PARA_RELER) atualizarAutomatico();
  });

  // voltou a ter internet
  window.addEventListener('online', () => { if (S.usuario) atualizarAutomatico(); });
}

/* ───────────────────────────────────────────────────────────────
   13. EVENTOS E INÍCIO
   ─────────────────────────────────────────────────────────────── */
function ligarEventos() {
  $('#form-login').addEventListener('submit', entrar);
  $('#btn-sair').addEventListener('click', sair);
  $('#btn-atualizar').addEventListener('click', () => carregarDados());
  $('#btn-excel').addEventListener('click', exportarExcel);

  $('#nav-abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba]');
    if (!b) return;
    S.aba = b.dataset.aba;
    $$('#nav-abas button').forEach(x => x.classList.toggle('ativa', x === b));
    render();
  });

  ['#f-de','#f-ate','#f-colab','#f-setor','#f-disc','#f-tipo']
    .forEach(s => $(s).addEventListener('change', render));

  // Obra: escolher ADICIONA à lista em vez de trocar. O select volta para
  // "todas as obras" logo em seguida, pronto para a próxima escolha.
  $('#f-obra').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) S.obrasSel.add(v);
    e.target.value = '';
    desenharChipsObra();
    render();
  });

  // tirar uma etiqueta, ou limpar todas
  $('#chips-obra').addEventListener('click', (e) => {
    const x = e.target.closest('[data-tirar-obra]');
    if (x) { S.obrasSel.delete(x.dataset.tirarObra); desenharChipsObra(); render(); return; }
    if (e.target.closest('#btn-limpar-obras')) {
      S.obrasSel.clear(); desenharChipsObra(); render();
    }
  });

  // "igual ao sistema": muda os critérios de contagem e o formato das horas
  const chk = $('#chk-modo-sistema');
  if (chk) {
    chk.checked = localStorage.getItem('viavoz_modo_sistema') === '1';
    S.modoSistema = chk.checked;
    chk.addEventListener('change', async () => {
      S.modoSistema = chk.checked;
      try { localStorage.setItem('viavoz_modo_sistema', chk.checked ? '1' : '0'); } catch (e) {}
      // o modo muda COMO os dados são lidos, então precisa buscar de novo
      await carregarDados();
    });
  }

  let t;
  $('#f-busca').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 250); });

  $('#f-periodo').addEventListener('change', (e) => {
    if (!e.target.value) return;
    aplicarAtalhoPeriodo(e.target.value);
    render();
  });

  $('#btn-limpar').addEventListener('click', () => {
    ['#f-de','#f-ate','#f-colab','#f-setor','#f-obra','#f-disc','#f-tipo','#f-busca','#f-periodo']
      .forEach(s => { $(s).value = ''; });
    S.obrasSel.clear();
    desenharChipsObra();
    render();
  });

  // ── aba Custo/Hora ──
  // 'change' dispara ao sair do campo, então não salva a cada tecla digitada
  $('#conteudo').addEventListener('change', (e) => {
    const inp = e.target.closest('.cst-in');
    if (inp) { CUSTOS.definir(inp.dataset.nome, inp.value); render(); return; }

    const arq = e.target.closest('#arq-custos');
    if (arq && arq.files && arq.files[0]) {
      CUSTOS.importar(arq.files[0], render);
      arq.value = '';
    }
  });

  $('#conteudo').addEventListener('click', (e) => {
    if (e.target.closest('#btn-conferir'))     { rodarConferencia(); return; }
    if (e.target.closest('#btn-excel-obras'))  { exportarObrasExcel(); return; }

    // ── aumento com data ──
    const abrir = e.target.closest('[data-abrir-aumento]');
    if (abrir) {
      S.editandoAumento = S.editandoAumento === abrir.dataset.abrirAumento
        ? null : abrir.dataset.abrirAumento;
      render();
      return;
    }
    if (e.target.closest('#btn-aum-cancelar')) { S.editandoAumento = null; render(); return; }

    const salvar = e.target.closest('#btn-aum-salvar');
    if (salvar) {
      const v  = $('#in-aum-valor').value;
      const de = $('#in-aum-de').value;
      if (!de)  { alert('Informe a partir de que dia o novo valor passa a valer.'); return; }
      if (!CUSTOS.definirAumento(salvar.dataset.nome, v, de)) {
        alert('Valor inválido. Ex: 110 ou 110,50'); return;
      }
      S.editandoAumento = null;
      render();
      return;
    }

    const tirar = e.target.closest('[data-tirar-aumento]');
    if (tirar) {
      CUSTOS.tirarAumento(tirar.dataset.tirarAumento, tirar.dataset.de);
      render();
      return;
    }
    if (e.target.closest('#btn-cst-exportar')) { CUSTOS.exportar(); return; }
    if (e.target.closest('#btn-cst-importar')) { $('#arq-custos').click(); return; }
    if (e.target.closest('#btn-cst-limpar'))   { if (CUSTOS.limpar()) render(); return; }

    const massaVazios = e.target.closest('#btn-cst-vazios');
    const massaTodos  = e.target.closest('#btn-cst-todos');
    if (massaVazios || massaTodos) {
      const bruto = $('#in-cst-massa').value;
      const v = Number(String(bruto).replace(',', '.'));
      if (!isFinite(v) || v <= 0) { alert('Digite um valor válido. Ex: 95 ou 95,50'); return; }

      // mesma lista que está na tela — inclusive quando ela está recortada
      // por disciplina, setor ou obra. Nunca os inativos: sobrescrever o
      // valor de quem saiu mudaria o custo de meses já fechados.
      const nomes = S.custoNaTela || nomesParaCusto().ativos;
      const alvos = massaTodos ? nomes : nomes.filter(n => !CUSTOS.valorDe(n));
      if (!alvos.length) { alert('Ninguém para preencher.'); return; }

      if (massaTodos) {
        const jaTem = nomes.filter(n => CUSTOS.valorDe(n)).length;
        if (jaTem && !confirm(
            'Isso vai substituir o valor de ' + jaTem + ' colaborador(es) que já tem valor próprio.\n\n' +
            'Aplicar R$ ' + v.toLocaleString('pt-BR') + ' por hora aos ' + alvos.length + '?')) return;
      }

      alvos.forEach(n => CUSTOS.definir(n, v));
      render();
      return;
    }

    const ir = e.target.closest('[data-ir]');
    if (ir) {
      S.aba = ir.dataset.ir;
      $$('#nav-abas button').forEach(x => x.classList.toggle('ativa', x.dataset.aba === S.aba));
      render();
    }
  });

  // abrir o detalhe de uma obra
  $('#conteudo').addEventListener('click', (e) => {
    if (e.target.closest('th')) return;                 // clique no cabeçalho é ordenação
    const tr = e.target.closest('tr[data-abrir]');
    if (tr) abrirDetalheObra(tr.dataset.abrir);
  });

  $('#detalhe-fechar').addEventListener('click', fecharDetalhe);
  $('#detalhe').addEventListener('click', (e) => {
    if (e.target.id === 'detalhe') fecharDetalhe();     // clique no fundo fecha
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#detalhe').classList.contains('oculto')) fecharDetalhe();
  });

  // ordenação por clique no cabeçalho
  $('#conteudo').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-campo]');
    if (!th) return;
    const id = th.dataset.tab, campo = th.dataset.campo;
    const atual = S.ordem[id];
    S.ordem[id] = (atual && atual.campo === campo) ? { campo, desc: !atual.desc } : { campo, desc: true };
    S.pagina[id] = 1;          // reordenou: a leitura recomeca do topo
    render();
  });

  // troca de página das tabelas
  // O render() refaz a tela inteira, entao a rolagem voltaria para o topo e
  // a pessoa perderia de vista a tabela que estava lendo. Guarda e devolve.
  $('#conteudo').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab-pag]');
    if (!b || b.disabled) return;
    const y = window.scrollY;
    S.pagina[b.dataset.tabPag] = Number(b.dataset.pag) || 1;
    render();
    window.scrollTo({ top: y, behavior: 'instant' });
  });
}

(async function iniciar() {
  CUSTOS.carregar();
  ligarEventos();
  // começa no mês corrente para não puxar anos de histórico de cara
  aplicarAtalhoPeriodo('mes');
  $('#f-periodo').value = 'mes';

  const { data: { session } } = await sb.auth.getSession();
  if (session) await iniciarSessao();
})();
