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
  const { canal } = req.query;
  let query = supabase.from('pedidos').select('*, clientes(nome)').order('criado_em', { ascending: false });
  if (canal) query = query.eq('canal', canal);
  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
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
// INTEGRAÇÃO BLING — OAuth 2.0
// ============================================================
let blingAccessToken = null;
let blingTokenExpiry = null;

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
      // Atualiza refresh token
      await supabase.from('configuracoes').upsert({ chave: 'bling_refresh_token', valor: response.data.refresh_token });
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

      // Filtra apenas Atendido e Atendido Sankhya
      const pedidosFiltrados = pedidosBling;
        console.log('Status encontrados:', pedidosBling.map(p => p.situacao?.valor));
       
      for (const p of pedidosFiltrados) {
        // Identifica o marketplace pelo nome da loja
        const nomeLoja = p.loja?.nome?.toLowerCase() || '';
        const canal =
          nomeLoja.includes('shopee') ? 'Shopee' :
          nomeLoja.includes('amazon') ? 'Amazon' :
          nomeLoja.includes('mercado') ? 'Mercado Livre' :
          nomeLoja.includes('whatsapp') ? 'WhatsApp' :
          nomeLoja.includes('site') ? 'Site' : 'Bling';

        await supabase.from('pedidos').upsert({
          id_externo: `bling_${p.id}`,
          canal,
          cliente_nome: p.contato?.nome || '',
          valor: p.totalVenda || 0,
          status: p.situacao?.valor || 'Atendido',
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
    await supabase.from('configuracoes').upsert({ chave: 'bling_refresh_token', valor: response.data.refresh_token });
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
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CRM Vendas rodando na porta ${PORT}`);
  console.log(`📱 WhatsApp: ${MEU_NUMERO}`);
  console.log(`🏭 Expedição: ${EXPEDICAO_NUMBER}`);
});
