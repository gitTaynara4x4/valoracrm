(() => {
  'use strict';

  // Este arquivo é apenas o carregador do módulo de Orçamentos.
  // A ordem fica explícita aqui; os nomes dos arquivos não precisam de números.
  const BASE = '/frontend/js/pages/orcamentos/';
  const VERSION = '20260902-orcamentos-pagamento-v8';
  const MODULOS = [
    'core.js',
    'propostas.js',
    'formulario.js',
    'clientes.js',
    'produtos.js',
    'calculos.js',
    'documentos.js',
    'proposta-cliente.js',
    'contratos.js',
    'financeiro.js',
    'impressao.js',
    'configuracoes.js',
    'modelos.js',
    'inicializacao.js',
  ];

  async function carregarOrcamentos() {
    try {
      const partes = await Promise.all(MODULOS.map(async (arquivo) => {
        const resposta = await fetch(`${BASE}${arquivo}?v=${VERSION}`, {
          credentials: 'same-origin',
          cache: 'no-cache',
        });
        if (!resposta.ok) throw new Error(`${arquivo}: HTTP ${resposta.status}`);
        return resposta.text();
      }));

      // Os arquivos foram divididos em limites de funções e são recompostos no
      // mesmo escopo para preservar o comportamento do orcamentos.js original.
      const codigo = `(() => {
${partes.join('\n')}
})();
//# sourceURL=valora-orcamentos.js`;
      const blob = new Blob([codigo], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.dataset.valoraModule = 'orcamentos';
      script.onload = () => URL.revokeObjectURL(url);
      script.onerror = () => {
        URL.revokeObjectURL(url);
        console.error('[orcamentos] Falha ao executar os módulos.');
      };
      document.head.appendChild(script);
    } catch (erro) {
      console.error('[orcamentos] Falha ao carregar módulos:', erro);
      const mensagem = 'Não foi possível carregar Orçamentos. Confira frontend/js/pages/orcamentos/ e atualize a página.';
      if (typeof window.showToast === 'function') window.showToast(mensagem, 'error');
    }
  }

  carregarOrcamentos();
})();
