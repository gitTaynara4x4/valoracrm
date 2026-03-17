// /frontend/js/pages/configuracoes.js

document.addEventListener("DOMContentLoaded", () => {
  const selectTema = document.getElementById("select-tema");
  
  if (!selectTema) return;

  // 1. Lê o tema atual e mostra certo na caixinha
  const temaAtual = localStorage.getItem('valora_theme') || 'dark';
  selectTema.value = temaAtual;

  // 2. Escuta quando o usuário muda a opção
  selectTema.addEventListener("change", (e) => {
    const novoTema = e.target.value;
    
    // Troca o tema da página atual
    document.documentElement.setAttribute('data-theme', novoTema);
    
    // Salva no navegador
    localStorage.setItem('valora_theme', novoTema);
    
    // Troca o tema do Menu Lateral (Iframe) na hora para não dar "pulo" visual
    const iframe = document.querySelector('.sidebar-frame');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.document.documentElement.setAttribute('data-theme', novoTema);
    }
    
    // Dispara a nossa notificação premium
    if (window.showToast) {
      window.showToast("Aparência atualizada!", "success");
    }
  });
});