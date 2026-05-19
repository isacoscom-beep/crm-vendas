// ============================================================
// CRM VENDAS — Servidor Principal
// ============================================================
// Integrações: WhatsApp (Z-API), Bling, WooCommerce,
//              Mercado Livre, Shopee, Google Business
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// CONFIGURAÇÕES — lidas do arquivo .env
// ============================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ZAPI = {
  instanceId: process.env.ZAPI_INSTANCE_ID,
  token: process.env.ZAPI_TOKEN,
  base: `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`,
};

const EXPEDICAO_NUMBER = process.env.EXPEDICAO_NUMBER || '5519996887125';
const MEU_NUMERO = process.env.MEU_NUMERO || '5519996343057';

// ============================================================
// CIDADES E ROTAS
// ============================================================
const CIDADES = [
  'Barueri','Caieiras','Cajamar','Campinas','Carapicuíba',
  'Cotia','Diadema','Embu das Artes','Francisco Morato',
  'Franco da Rocha','Guarujá','Guarulhos','Hortolândia',
  'Ibiúna','Itanhaém','Itapecerica da Serra','Itapevi',
  'Itariri','Jandira','Jundiaí','Juquitiba','Juquiá',
  'Mairiporã','Mauá','Miracatu','Mongaguá','Osasco',
  'Pedro de Toledo','Peruíbe','Piedade','São José dos Campos',
  'Grande SP','Lapa','Pompéia','Zona Norte','Zona Leste',
  'Zona Sul','Butantã','Itaim Bibi','Jaguaré','Moema',
  'Pinheiros','Rio Pequeno','Vila Mariana','Santo André',
  'São Bernardo','Centro','Ipiranga','Santana de Parnaíba',
  'Tatuapé','Vila Carrão','Vila Formosa','Sapopemba',
  'Aricanduva','Vila Matilde','Vila Prudente','Mooca',
  'São João Clímaco',
];

// ============================================================
// HELPER: Extrair cidades de uma mensagem de rota
// ============================================================
function extrairCidades(mensagem) {
  const cidadesEncontradas = [];
  const msgLower = mensagem.toLowerCase();
  for (const cidade of CIDADES) {
    if (msgLower.includes(cidade.toLowerCase())) {
      cidadesEncontradas.push(cidade);
    }
  }
  return cidadesEncontradas;
}

// ============================================================
// HELPER: Extrair data da mensagem de rota
// ============================================================
function extrairData(mensagem) {
  const match = mensagem.match(/\((\d{2}\/\d{2})\)/);
  if (match) {
    const [dia, mes] = match[1].split('/');
    const ano = new Date().getFullYear();
    return new Date(`${ano}-${mes}-${dia}`);
  }
  return null;
}

// ============================================================
// HELPER: Enviar mensagem WhatsApp via Z-API
// ============================================================
async function enviarWhatsapp(numero, mensagem) {
  try {
    const numeroFormatado = numero.replace(/\D/g, '');
    const response = await axios.post(`${ZAPI.base}/send-text`, {
      phone: numeroFormatado,
      message: mensagem,
    });
    return { ok: true, data: response.data };
  } catch (err) {
    console.error('Erro ao enviar WhatsApp:', err.message);
    return { ok: false, erro: err.message };
  }
}

// ============================================================
// WEBHOOK — Recebe mensagens do WhatsApp via Z-API
// ============================================================
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (!body || !body.phone || !body.text?.message) return;

  const numeroRemetente = body.phone.replace(/\D/g, '');
  const mensagem = body.text.message;
  const expedNumero = EXPEDICAO_NUMBER.replace(/\D/g, '');

  if (numeroRemetente === expedNumero) {
    await processarRotaExpedicao(mensagem);
    return;
  }

  await processarMensagemCliente(numeroRemetente, mensagem);
});

// ============================================================
// PROCESSAR ROTA DA EXPEDIÇÃO
// ============================================================
async function processarRotaExpedicao(mensagem) {
  if (!mensagem.toLowerCase().includes('previsão de rota') &&
      !mensagem.toLowerCase().includes('previsao de rota')) return;

  const cidades = extrairCidades(mensagem);
  const dataRota = extrairData(mensagem);
  if (!cidades.length) return;

  const dataEntrega = dataRota || new Date(Date.now() + 86400000);
  await supabase.from('rotas_diarias').insert({
    mensagem_original: mensagem,
    cidades: cidades,
    data_entrega: dataEntrega.toISOString().split('T')[0],
    criado_em: new Date().toISOString(),
  });

  const { data: clientes } = await supabase
    .from('clientes')
    .select('*')
    .in('cidade', cidades)
    .eq('status', 'Ativo')
    .not('whatsapp', 'is', null);

  if (!clientes || !clientes.length) return;

  for (const cliente of clientes) {
    const msg = `Olá ${cliente.nome}! 😊 Amanhã passaremos na sua região (${cliente.cidade}). Garanta seu pedido até as 15h de hoje para receber amanhã! Qualquer dúvida é só chamar. 🚚`;
    await enviarWhatsapp(cliente.whatsapp, msg);
    await new Promise(r => setTimeout(r, 1500));
  }

  await supabase.from('atividades').insert({
    tipo: 'rota_disparada',
    descricao: `Rota disparada para ${clientes.length} clientes em ${cidades.join(', ')}`,
    criado_em: new Date().toISOString(),
  });
}

// ============================================================
// PROCESSAR MENSAGEM DE CLIENTE (Bot)
// ============================================================
async function processarMensagemCliente(numero, mensagem) {
  const msgLower = mensagem.toLowerCase().trim();

  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('whatsapp', numero)
    .single();

  if (msgLower.includes('pedido') || msgLower.includes('quero') || msgLower.includes('comprar')) {
    const resposta = cliente
      ? `Olá ${cliente.nome}! 😊 Para fazer seu pedido, pode me informar os produtos e quantidades. Lembre-se que pedidos devem ser feitos até as 15h para entrega no dia seguinte! 🚚`
      : `Olá! 😊 Para fazer seu pedido, pode me informar os produtos e quantidades. Lembre-se que pedidos devem ser feitos até as 15h para entrega no dia seguinte! 🚚`;
    await enviarWhatsapp(numero, resposta);
  } else if (msgLower.includes('rota') || msgLower.includes('entrega') || msgLower.includes('quando')) {
    const cidade = cliente?.cidade;
    if (cidade) {
      const { data: proximaRota } = await supabase
        .from('rotas_diarias')
        .select('*')
        .contains('cidades', [cidade])
        .gte('data_entrega', new Date().toISOString().split('T')[0])
        .order('data_entrega', { ascending: true })
        .limit(1)
        .single();

      if (proximaRota) {
        const dataFormatada = new Date(proximaRota.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
        await enviarWhatsapp(numero, `Olá ${cliente.nome}! 😊 A próxima entrega na sua região (${cidade}) está prevista para ${dataFormatada}. Faça seu pedido até as 15h do dia anterior! 🚚`);
      } else {
        await enviarWhatsapp(numero, `Olá ${cliente?.nome || ''}! 😊 Ainda não temos uma rota confirmada para sua região. Assim que confirmarmos, te avisamos! 🚚`);
      }
    }
  } else if (msgLower.includes('oi') || msgLower.includes('olá') || msgLower.includes('ola') || msgLower.includes('bom dia') || msgLower.includes('boa tarde')) {
    const nome = cliente?.nome ? ` ${cliente.nome}` : '';
    await enviarWhatsapp(numero, `Olá${nome}! 😊 Como posso te ajudar? Você pode me perguntar sobre pedidos, entregas ou rotas! 🚚`);
  }

  await supabase.from('conversas').upsert({
    whatsapp: numero,
    cliente_id: cliente?.id || null,
    ultima_mensagem: mensagem,
    status: 'Recebido',
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'whatsapp' });
}

// ============================================================
// API — CLIENTES
// ============================================================
app.get('/api/clientes', async (req, res) => {
  const { rota, status, busca } = req.query;
  let query = supabase.from('clientes').select('*').order('nome');
  if (rota) query = query.eq('rota', rota);
  if (status) query = query.eq('status', status);
  if (busca) query = query.ilike('nome', `%${busca}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/clientes', async (req, res) => {
  const { data, error } = await supabase.from('clientes').insert({
    ...req.body,
    criado_em: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.put('/api/clientes/:id', async (req, res) => {
  const { data, error } = await supabase.from('clientes').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.delete('/api/clientes/:id', async (req, res) => {
  const { error } = await supabase.from('clientes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ ok: true });
});

// ============================================================
// API — PEDIDOS
// ============================================================
app.get('/api/pedidos', async (req, res) => {
  const { canal, dataInicial, dataFinal } = req.query;
  let query = supabase.from('pedidos').select('*, clientes(nome)').order('criado_em', { ascending: false });
  if (canal) query = query.eq('canal', canal);
  if (dataInicial) query = query.gte('criado_em', dataInicial);
  if (dataFinal) query = query.lte('criado_em', dataFinal + 'T23:59:59');
  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });
  res.json((data || []).map(p => ({ ...p, canal: normalizarCanal(p.canal) })));
});

app.post('/api/pedidos', async (req, res) => {
  const { data, error } = await supabase.from('pedidos').insert({
    ...req.body,
    criado_em: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  if (req.body.cliente_id) {
    await supabase.from('clientes').update({ ultimo_pedido: new Date().toISOString().split('T')[0] }).eq('id', req.body.cliente_id);
  }
  res.json(data);
});

// ============================================================
// API — ROTAS DIÁRIAS
// ============================================================
app.get('/api/rotas-diarias', async (req, res) => {
  const { data, error } = await supabase.from('rotas_diarias').select('*').order('data_entrega', { ascending: false }).limit(30);
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/rotas-diarias', async (req, res) => {
  const { cidades, data_entrega, disparar } = req.body;
  const { data: rota, error } = await supabase.from('rotas_diarias').insert({
    cidades, data_entrega,
    mensagem_original: `Rota manual para ${data_entrega}`,
    criado_em: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ erro: error.message });

  if (disparar) {
    const { data: clientes } = await supabase.from('clientes').select('*').in('cidade', cidades).eq('status', 'Ativo').not('whatsapp', 'is', null);
    for (const cliente of (clientes || [])) {
      const msg = `Olá ${cliente.nome}! 😊 Amanhã passaremos na sua região (${cliente.cidade}). Garanta seu pedido até as 15h de hoje para receber amanhã! Qualquer dúvida é só chamar. 🚚`;
      await enviarWhatsapp(cliente.whatsapp, msg);
      await new Promise(r => setTimeout(r, 1500));
    }
    return res.json({ rota, clientes_notificados: clientes?.length || 0 });
  }
  res.json(rota);
});

// ============================================================
// API — OPORTUNIDADES (PIPELINE)
// ============================================================
app.get('/api/oportunidades', async (req, res) => {
  const { data, error } = await supabase.from('oportunidades').select('*').order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/oportunidades', async (req, res) => {
  const { data, error } = await supabase.from('oportunidades').insert({ ...req.body, criado_em: new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.put('/api/oportunidades/:id', async (req, res) => {
  const { data, error } = await supabase.from('oportunidades').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

// ============================================================
// API — CONVERSAS
// ============================================================
app.get('/api/conversas', async (req, res) => {
  const { data, error } = await supabase.from('conversas').select('*, clientes(nome, cidade)').order('atualizado_em', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

// ============================================================
// API — ATIVIDADES / DASHBOARD
// ============================================================
app.get('/api/atividades', async (req, res) => {
  const { data, error } = await supabase.from('atividades').select('*').order('criado_em', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.get('/api/dashboard', async (req, res) => {
  const [clientes, pedidos, oportunidades, rotas] = await Promise.all([
    supabase.from('clientes').select('id, status, cidade, canal, criado_em'),
    supabase.from('pedidos').select('id, valor, canal, status, criado_em'),
    supabase.from('oportunidades').select('id, valor, etapa'),
    supabase.from('rotas_diarias').select('id, cidades, data_entrega').order('data_entrega', { ascending: false }).limit(5),
  ]);

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
  const pedidosMes = (pedidos.data || []).filter(p => p.criado_em >= inicioMes);
  const receitaMes = pedidosMes.reduce((s, p) => s + parseFloat(p.valor || 0), 0);

  res.json({
    clientes: {
      total: clientes.data?.length || 0,
      ativos: clientes.data?.filter(c => c.status === 'Ativo').length || 0,
    },
    pedidos: {
      total: pedidos.data?.length || 0,
      mes: pedidosMes.length,
      receita_mes: receitaMes,
    },
    oportunidades: {
      abertas: oportunidades.data?.filter(o => o.etapa !== 'Fechado').length || 0,
    },
    rotas_recentes: rotas.data || [],
  });
});

// ============================================================
// ANALYTICS — Comportamento de compra dos clientes
// ============================================================

async function buscarTodosPedidos() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('cliente_nome, criado_em, valor, canal')
    .order('criado_em', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(p => ({ ...p, canal: normalizarCanal(p.canal) }));
}

function agruparPorCliente(pedidos) {
  const mapa = {};
  for (const p of pedidos) {
    const nome = p.cliente_nome?.trim();
    if (!nome) continue;
    if (!mapa[nome]) mapa[nome] = { compras: [], totalGasto: 0, canais: new Set() };
    mapa[nome].compras.push(p.criado_em);
    mapa[nome].totalGasto += parseFloat(p.valor || 0);
    mapa[nome].canais.add(p.canal);
  }
  return mapa;
}

// Clientes inativos há mais de X dias (padrão: 60 dias)
app.get('/api/analytics/inativos', async (req, res) => {
  try {
    const dias = parseInt(req.query.dias) || 60;
    const pedidos = await buscarTodosPedidos();
    const mapa = agruparPorCliente(pedidos);
    const agora = new Date();
    const resultado = [];

    for (const [nome, dados] of Object.entries(mapa)) {
      const ultimaCompra = new Date(dados.compras[dados.compras.length - 1]);
      const diasSemComprar = Math.floor((agora - ultimaCompra) / 86400000);
      if (diasSemComprar >= dias) {
        resultado.push({
          cliente: nome,
          ultima_compra: dados.compras[dados.compras.length - 1].split('T')[0],
          dias_sem_comprar: diasSemComprar,
          total_compras: dados.compras.length,
          total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
          canais: [...dados.canais],
        });
      }
    }

    resultado.sort((a, b) => b.dias_sem_comprar - a.dias_sem_comprar);
    res.json({ total: resultado.length, dias_filtro: dias, clientes: resultado });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Clientes que compraram apenas uma vez
app.get('/api/analytics/unica-compra', async (req, res) => {
  try {
    const { canal } = req.query;
    const pedidos = await buscarTodosPedidos();
    const mapa = agruparPorCliente(pedidos);
    const agora = new Date();

    const { data: clientes } = await supabase.from('clientes').select('nome, whatsapp');
    const mapaWA = {};
    for (const c of (clientes || [])) {
      if (c.nome) mapaWA[c.nome.trim().toLowerCase()] = c.whatsapp;
    }

    const resultado = [];
    for (const [nome, dados] of Object.entries(mapa)) {
      if (dados.compras.length !== 1) continue;
      if (canal && !dados.canais.has(canal)) continue;
      const wa = mapaWA[nome.toLowerCase()] || null;
      if (!wa) continue;
      const dataCompra = new Date(dados.compras[0]);
      const diasDesde = Math.floor((agora - dataCompra) / 86400000);
      resultado.push({
        cliente: nome,
        whatsapp: wa,
        data_compra: dados.compras[0].split('T')[0],
        dias_desde_compra: diasDesde,
        total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
        canais: [...dados.canais],
      });
    }

    resultado.sort((a, b) => b.dias_desde_compra - a.dias_desde_compra);
    res.json({ total: resultado.length, clientes: resultado });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Clientes recorrentes com período médio de recompra
app.get('/api/analytics/recorrentes', async (req, res) => {
  try {
    const { canal, status_recorrencia } = req.query;
    const pedidos = await buscarTodosPedidos();
    const mapa = agruparPorCliente(pedidos);
    const agora = new Date();

    const { data: clientes } = await supabase.from('clientes').select('nome, whatsapp');
    const mapaWA = {};
    for (const c of (clientes || [])) {
      if (c.nome) mapaWA[c.nome.trim().toLowerCase()] = c.whatsapp;
    }

    const resultado = [];
    for (const [nome, dados] of Object.entries(mapa)) {
      if (dados.compras.length < 2) continue;
      if (canal && !dados.canais.has(canal)) continue;
      const wa = mapaWA[nome.toLowerCase()] || null;
      if (!wa) continue;

      const datas = dados.compras.map(d => new Date(d)).sort((a, b) => a - b);
      let totalDias = 0;
      for (let i = 1; i < datas.length; i++) {
        totalDias += (datas[i] - datas[i - 1]) / 86400000;
      }
      const mediaRecorrenciaDias = Math.round(totalDias / (datas.length - 1));
      const ultimaCompra = datas[datas.length - 1];
      const diasSemComprar = Math.floor((agora - ultimaCompra) / 86400000);
      const proximaCompraEstimada = new Date(ultimaCompra.getTime() + mediaRecorrenciaDias * 86400000);
      const diasParaProxima = Math.floor((proximaCompraEstimada - agora) / 86400000);
      const statusRec = diasParaProxima < 0 ? 'atrasado' : diasParaProxima <= 7 ? 'proximo' : 'em_dia';

      if (status_recorrencia && statusRec !== status_recorrencia) continue;

      resultado.push({
        cliente: nome,
        whatsapp: wa,
        total_compras: datas.length,
        media_recorrencia_dias: mediaRecorrenciaDias,
        ultima_compra: ultimaCompra.toISOString().split('T')[0],
        dias_sem_comprar: diasSemComprar,
        proxima_compra_estimada: proximaCompraEstimada.toISOString().split('T')[0],
        dias_para_proxima: diasParaProxima,
        status_recorrencia: statusRec,
        total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
        canais: [...dados.canais],
      });
    }

    resultado.sort((a, b) => b.total_compras - a.total_compras);
    res.json({ total: resultado.length, clientes: resultado });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ============================================================
// NOTIFICAÇÕES — Fila de aprovação de mensagens automáticas
// ============================================================

app.post('/api/notificacoes/gerar', async (req, res) => {
  try {
    const pedidos = await buscarTodosPedidos();
    const mapa = agruparPorCliente(pedidos);
    const agora = new Date();

    const { data: clientes } = await supabase.from('clientes').select('nome, whatsapp').not('whatsapp', 'is', null);
    const mapaWA = {};
    for (const c of (clientes || [])) {
      if (c.nome) mapaWA[c.nome.trim().toLowerCase()] = c.whatsapp;
    }

    const candidatas = [];

    for (const [nome, dados] of Object.entries(mapa)) {
      const ultimaCompra = new Date(dados.compras[dados.compras.length - 1]);
      const diasSemComprar = Math.floor((agora - ultimaCompra) / 86400000);
      const wa = mapaWA[nome.toLowerCase()] || null;
      const primeiroNome = nome.split(' ')[0];

      if (dados.compras.length === 1 && diasSemComprar >= 30) {
        candidatas.push({
          tipo: 'unica_compra',
          cliente_nome: nome,
          cliente_whatsapp: wa,
          mensagem: `Olá ${primeiroNome}! 😊 Faz um tempo que não te vemos por aqui. Temos novidades e produtos fresquinhos esperando por você! Quer dar uma olhada? 🌿`,
          dias_sem_comprar: diasSemComprar,
          total_compras: 1,
          total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
          ultima_compra: ultimaCompra.toISOString().split('T')[0],
          status: 'pendente',
          criado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        });
      } else if (dados.compras.length >= 2) {
        const datas = dados.compras.map(d => new Date(d)).sort((a, b) => a - b);
        let totalDias = 0;
        for (let i = 1; i < datas.length; i++) totalDias += (datas[i] - datas[i - 1]) / 86400000;
        const mediaRecorrenciaDias = Math.round(totalDias / (datas.length - 1));
        const proximaEstimada = new Date(ultimaCompra.getTime() + mediaRecorrenciaDias * 86400000);
        const diasParaProxima = Math.floor((proximaEstimada - agora) / 86400000);

        if (diasParaProxima >= -7 && diasParaProxima <= 7) {
          const tipo = diasParaProxima < 0 ? 'recorrente_atrasado' : 'recorrente_proximo';
          const mensagem = diasParaProxima < 0
            ? `Olá ${primeiroNome}! 😊 Pela sua frequência de compras, você costuma pedir a cada ${mediaRecorrenciaDias} dias. Está na hora de repor! Posso te ajudar? 🌿`
            : `Olá ${primeiroNome}! 😊 Pelos seus hábitos de compra, você vai precisar de produtos em breve. Já posso separar alguma coisa para você? 🌿`;
          candidatas.push({
            tipo,
            cliente_nome: nome,
            cliente_whatsapp: wa,
            mensagem,
            dias_sem_comprar: diasSemComprar,
            total_compras: datas.length,
            total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
            ultima_compra: ultimaCompra.toISOString().split('T')[0],
            proxima_compra_estimada: proximaEstimada.toISOString().split('T')[0],
            status: 'pendente',
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          });
        } else if (diasSemComprar >= 60) {
          candidatas.push({
            tipo: 'inativo',
            cliente_nome: nome,
            cliente_whatsapp: wa,
            mensagem: `Olá ${primeiroNome}! 😊 Sentimos sua falta! Faz ${diasSemComprar} dias desde sua última compra. Temos novidades que você vai adorar! Que tal fazermos um pedido? 🌿`,
            dias_sem_comprar: diasSemComprar,
            total_compras: datas.length,
            total_gasto: parseFloat(dados.totalGasto.toFixed(2)),
            ultima_compra: ultimaCompra.toISOString().split('T')[0],
            status: 'pendente',
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          });
        }
      }
    }

    const { data: existentes } = await supabase.from('notificacoes').select('cliente_nome').eq('status', 'pendente');
    const nomesExistentes = new Set((existentes || []).map(n => n.cliente_nome));
    const novas = candidatas.filter(n => !nomesExistentes.has(n.cliente_nome));

    if (novas.length > 0) await supabase.from('notificacoes').insert(novas);

    res.json({ geradas: novas.length, total_analisados: Object.keys(mapa).length });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/notificacoes', async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('notificacoes').select('*').order('criado_em', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data || []);
});

app.put('/api/notificacoes/:id', async (req, res) => {
  const { data, error } = await supabase.from('notificacoes')
    .update({ ...req.body, atualizado_em: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/notificacoes/:id/aprovar', async (req, res) => {
  const { data: notif, error } = await supabase.from('notificacoes').select('*').eq('id', req.params.id).single();
  if (error || !notif) return res.status(404).json({ erro: 'Notificação não encontrada' });
  if (!notif.cliente_whatsapp) return res.status(400).json({ erro: 'Cliente sem WhatsApp cadastrado' });

  const mensagem = notif.mensagem_editada || notif.mensagem;
  const resultado = await enviarWhatsapp(notif.cliente_whatsapp, mensagem);

  const novoStatus = resultado.ok ? 'enviada' : 'erro';
  await supabase.from('notificacoes').update({
    status: novoStatus,
    enviado_em: resultado.ok ? new Date().toISOString() : null,
    atualizado_em: new Date().toISOString(),
  }).eq('id', req.params.id);

  if (resultado.ok) res.json({ ok: true });
  else res.status(500).json({ erro: resultado.erro });
});

app.post('/api/notificacoes/:id/rejeitar', async (req, res) => {
  const { data, error } = await supabase.from('notificacoes')
    .update({ status: 'rejeitada', atualizado_em: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

// ============================================================
// INTEGRAÇÃO BLING — OAuth 2.0
// ============================================================
let blingAccessToken = null;
let blingTokenExpiry = null;

// Mapeamento de IDs de status do Bling para nomes legíveis
const STATUS_BLING = {
  1: 'Em Aberto',
  2: 'Em Andamento',
  3: 'Cancelado',
  4: 'Vencido',
  6: 'Atendido',
  9: 'Atendido Sankhya',
  10: 'Verificado',
  11: 'Parcialmente Atendido',
};

function resolverStatus(situacao) {
  if (!situacao) return 'Desconhecido';
  const id = typeof situacao === 'object' ? situacao.id : situacao;
  const valor = typeof situacao === 'object' ? situacao.valor : null;
  // Se valor é texto real (não número), usa direto
  if (valor && isNaN(valor)) return valor;
  // Caso contrário, resolve pelo ID
  return STATUS_BLING[Number(id)] || STATUS_BLING[Number(valor)] || `Status ${id ?? valor}`;
}

const LOJAS_BLING = {
  205540675: 'Mercado Livre',
  205673727: 'Shopee',
  205664970: 'Amazon',
};

function resolverCanal(p) {
  const lojaId = p.loja?.id;
  return LOJAS_BLING[lojaId] || 'WhatsApp';
}

// Pedidos do site próprio e Bling direto são todos via WhatsApp
function normalizarCanal(canal) {
  if (!canal || canal === 'Site' || canal === 'Bling') return 'WhatsApp';
  return canal;
}

async function getBlingToken() {
  // Tenta usar token salvo no Supabase (refresh token)
  if (blingAccessToken && blingTokenExpiry > Date.now()) return blingAccessToken;
  try {
    const { data: cfg } = await supabase.from('configuracoes').select('valor').eq('chave', 'bling_refresh_token').single();
    if (cfg?.valor) {
      const credentials = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
      const response = await axios.post('https://www.bling.com.br/Api/v3/oauth/token',
        `grant_type=refresh_token&refresh_token=${cfg.valor}`,
        { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      blingAccessToken = response.data.access_token;
      blingTokenExpiry = Date.now() + (response.data.expires_in * 1000);
      // Atualiza refresh token (onConflict garante sobrescrita correta)
      await supabase.from('configuracoes').upsert({ chave: 'bling_refresh_token', valor: response.data.refresh_token }, { onConflict: 'chave' });
      return blingAccessToken;
    }
  } catch (err) {
    console.error('Erro ao renovar token Bling:', err.message);
  }
  return null;
}

// ============================================================
// BLING — Sincronizar TODOS os pedidos com paginação
// Filtra apenas: Atendido e Atendido Sankhya
// Separa por marketplace automaticamente
// ============================================================
app.get('/api/bling/pedidos', async (req, res) => {
  try {
    const token = await getBlingToken();
    if (!token) return res.status(500).json({ erro: 'Bling não autenticado. Acesse /bling/auth para conectar.' });

    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;

    while (continuar) {
      const response = await axios.get('https://www.bling.com.br/Api/v3/pedidos/vendas', {
        headers: { Authorization: `Bearer ${token}` },
        params: { pagina, limite: 100 }
      });

      const pedidosBling = response.data?.data || [];
      if (!pedidosBling.length) { continuar = false; break; }

      // Filtra apenas pedidos Atendido e Atendido Sankhya (resolve IDs numéricos também)
      const pedidosFiltrados = pedidosBling.filter(p => {
        const status = resolverStatus(p.situacao);
        return status === 'Atendido' || status === 'Atendido Sankhya';
      });

      for (const p of pedidosFiltrados) {
        const canal = resolverCanal(p);
        const status = resolverStatus(p.situacao);

        await supabase.from('pedidos').upsert({
          id_externo: `bling_${p.id}`,
          canal,
          cliente_nome: p.contato?.nome || '',
          valor: parseFloat(p.total || p.totalVenda || 0),
          status,
          criado_em: p.data || new Date().toISOString(),
        }, { onConflict: 'id_externo' });

        totalSincronizados++;
      }

      pagina++;
      await new Promise(r => setTimeout(r, 500));

      // Se veio menos de 100 resultados, chegou na última página
      if (pedidosBling.length < 100) continuar = false;
    }

    res.json({ sincronizados: totalSincronizados, paginas: pagina - 1 });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao conectar com Bling: ' + err.message });
  }
});

// ============================================================
// BLING — Descobre nomes dos IDs de loja encontrados nos pedidos
// ============================================================
app.get('/api/bling/lojas', async (req, res) => {
  try {
    const token = await getBlingToken();
    if (!token) return res.status(500).json({ erro: 'Bling não autenticado' });

    // Busca os IDs únicos de loja nos pedidos
    const response = await axios.get('https://www.bling.com.br/Api/v3/pedidos/vendas', {
      headers: { Authorization: `Bearer ${token}` },
      params: { pagina: 1, limite: 100 }
    });
    const pedidos = response.data?.data || [];
    const idsUnicos = [...new Set(pedidos.map(p => p.loja?.id).filter(id => id && id !== 0))];

    // Tenta buscar detalhes de cada loja
    const lojas = [];
    for (const id of idsUnicos) {
      try {
        const r = await axios.get(`https://www.bling.com.br/Api/v3/lojas/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        lojas.push({ id, dados: r.data?.data });
      } catch {
        lojas.push({ id, dados: null, erro: 'não encontrado' });
      }
    }
    res.json({ ids_encontrados: idsUnicos, lojas });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ============================================================
// BLING — Debug: mostra dados brutos dos pedidos para diagnóstico
// ============================================================
app.get('/api/bling/debug', async (req, res) => {
  try {
    const token = await getBlingToken();
    if (!token) return res.status(500).json({ erro: 'Bling não autenticado' });
    const response = await axios.get('https://www.bling.com.br/Api/v3/pedidos/vendas', {
      headers: { Authorization: `Bearer ${token}` },
      params: { pagina: 1, limite: 10 }
    });
    const pedidos = response.data?.data || [];
    res.json(pedidos.map(p => ({
      id: p.id,
      loja_nome: p.loja?.nome,
      loja_id: p.loja?.id,
      numeroPedidoLoja: p.numeroPedidoLoja,
      situacao_id: p.situacao?.id,
      situacao_valor: p.situacao?.valor,
      total: p.total,
      totalVenda: p.totalVenda,
      contato: p.contato?.nome,
      canal_detectado: resolverCanal(p),
      status_detectado: resolverStatus(p.situacao),
    })));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ============================================================
// BLING — Callback OAuth (autorização inicial)
// ============================================================
app.get('/bling/auth', (req, res) => {
  const url = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${process.env.BLING_CLIENT_ID}&redirect_uri=https://handsome-forgiveness-production-a14c.up.railway.app/bling/callback`;
  res.redirect(url);
});

app.get('/bling/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ erro: 'Código não recebido' });
  try {
    const credentials = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://www.bling.com.br/Api/v3/oauth/token',
      `grant_type=authorization_code&code=${code}&redirect_uri=https://handsome-forgiveness-production-a14c.up.railway.app/bling/callback`,
      { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    blingAccessToken = response.data.access_token;
    blingTokenExpiry = Date.now() + (response.data.expires_in * 1000);
    await supabase.from('configuracoes').upsert({ chave: 'bling_refresh_token', valor: response.data.refresh_token }, { onConflict: 'chave' });
    res.send('<h2>✅ Bling conectado com sucesso! Pode fechar esta aba.</h2>');
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao obter token: ' + err.message });
  }
});

// ============================================================
// INTEGRAÇÃO MERCADO LIVRE
// ============================================================
app.get('/api/ml/pedidos', async (req, res) => {
  try {
    const response = await axios.get('https://api.mercadolibre.com/orders/search', {
      headers: { Authorization: `Bearer ${process.env.ML_TOKEN}` },
      params: { seller: process.env.ML_SELLER_ID, limit: 50 }
    });
    const pedidosML = response.data?.results || [];
    for (const p of pedidosML) {
      await supabase.from('pedidos').upsert({
        id_externo: `ml_${p.id}`,
        canal: 'Mercado Livre',
        valor: parseFloat(p.total_amount || 0),
        status: p.status === 'paid' ? 'Atendido' : 'Em aberto',
        criado_em: p.date_created || new Date().toISOString(),
      }, { onConflict: 'id_externo' });
    }
    res.json({ sincronizados: pedidosML.length });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao conectar com Mercado Livre.' });
  }
});

// ============================================================
// IMPORTAR CLIENTES VIA CSV
// ============================================================
app.post('/api/importar-clientes', async (req, res) => {
  const { clientes } = req.body;
  if (!clientes?.length) return res.status(400).json({ erro: 'Nenhum cliente enviado' });

  const inseridos = [];
  for (const c of clientes) {
    const { data } = await supabase.from('clientes').upsert({
      nome: c.nome,
      whatsapp: c.whatsapp?.replace(/\D/g, ''),
      email: c.email,
      cidade: c.cidade || c.regiao,
      rota: c.rota,
      canal: c.canal || 'WhatsApp',
      status: c.status || 'Ativo',
      criado_em: new Date().toISOString(),
    }, { onConflict: 'whatsapp' }).select().single();
    if (data) inseridos.push(data);
  }
  res.json({ inseridos: inseridos.length });
});

// ============================================================
// DISPARAR MENSAGEM MANUAL POR CIDADE
// ============================================================
app.post('/api/disparar', async (req, res) => {
  const { cidades, mensagem } = req.body;
  const { data: clientes } = await supabase.from('clientes').select('*').in('cidade', cidades).eq('status', 'Ativo').not('whatsapp', 'is', null);
  if (!clientes?.length) return res.json({ enviados: 0 });

  let enviados = 0;
  for (const c of clientes) {
    const msg = mensagem.replace('{nome}', c.nome).replace('{cidade}', c.cidade);
    const resultado = await enviarWhatsapp(c.whatsapp, msg);
    if (resultado.ok) enviados++;
    await new Promise(r => setTimeout(r, 1500));
  }
  res.json({ enviados, total: clientes.length });
});

// ============================================================
// MIGRAÇÃO — Normaliza canais "Site" e "Bling" para "WhatsApp"
// ============================================================
app.post('/api/admin/normalizar-canais', async (req, res) => {
  const canaisParaNormalizar = ['Site', 'Bling'];
  let total = 0;
  for (const canal of canaisParaNormalizar) {
    const { data } = await supabase.from('pedidos').update({ canal: 'WhatsApp' }).eq('canal', canal).select('id');
    total += data?.length || 0;
  }
  res.json({ ok: true, atualizados: total });
});

// ============================================================
// DISPARAR MENSAGEM PARA LISTA DE CLIENTES (Segmentos)
// ============================================================
app.post('/api/disparar-lista', async (req, res) => {
  const { clientes, mensagem } = req.body;
  if (!clientes?.length || !mensagem) return res.status(400).json({ erro: 'Dados inválidos' });
  let enviados = 0;
  for (const c of clientes) {
    if (!c.whatsapp) continue;
    const msg = mensagem
      .replace('{nome}', c.nome || c.cliente || '')
      .replace('{periodicidade}', c.media_recorrencia_dias || '?');
    const resultado = await enviarWhatsapp(c.whatsapp, msg);
    if (resultado.ok) enviados++;
    await new Promise(r => setTimeout(r, 1500));
  }
  res.json({ enviados, total: clientes.length });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CRM Vendas rodando na porta ${PORT}`);
  console.log(`📱 WhatsApp: ${MEU_NUMERO}`);
  console.log(`🏭 Expedição: ${EXPEDICAO_NUMBER}`);
});
