// /frontend/js/pages/configuracoes.js

// Função local de Toast (Notificação) padronizada do Valora
function toast(msg, error = false, ms = 3000) {
  const el = document.getElementById("valora-toast");
  if (!el) return;
  el.textContent = msg || "";
  
  if (error) {
    el.classList.add("is-error");
  } else {
    el.classList.remove("is-error");
  }
  
  el.classList.add("show");
  
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove("show");
  }, ms);
}

document.addEventListener("DOMContentLoaded", () => {
  // =========================================
  // LÓGICA DO TEMA (APARÊNCIA)
  // =========================================
  const selectTema = document.getElementById("select-tema");
  
  if (selectTema) {
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
      
      toast("Aparência atualizada!");
    });
  }

  // =========================================
  // LÓGICA DE RELATAR BUG
  // =========================================
  const formBug = document.getElementById("form-bug");
  
  if (formBug) {
    formBug.addEventListener("submit", async (e) => {
      e.preventDefault(); // Impede a página de recarregar
      
      const descricaoInput = document.getElementById("bug-descricao");
      const descricao = descricaoInput.value.trim();
      
      if (!descricao) {
        toast("Por favor, descreva o problema antes de enviar.", true);
        return;
      }

      const btnSubmit = document.getElementById("btn-enviar-bug");
      const textoOriginal = btnSubmit.innerHTML;
      
      // Feedback visual de carregamento
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Enviando...';

      try {
        /*
          Aqui você pode conectar com o seu Backend!
          Exemplo:
          await fetch('/api/bugs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ descricao: descricao })
          });
        */
        
        // Simulando um tempo de requisição para o backend (1 segundo)
        await new Promise(resolve => setTimeout(resolve, 1000));

        toast("Relato enviado com sucesso! Obrigado por ajudar a melhorar o sistema.");
        formBug.reset(); // Limpa a caixinha de texto

      } catch (error) {
        console.error("Erro ao enviar bug:", error);
        toast("Erro ao enviar relato. Tente novamente mais tarde.", true);
      } finally {
        // Restaura o botão
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = textoOriginal;
      }
    });
  }
});