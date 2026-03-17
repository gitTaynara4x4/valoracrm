// /frontend/js/pages/empresa.js

document.addEventListener("DOMContentLoaded", () => {
  
  // Função auxiliar para chamadas de API do seu backend (com tratamento de erro)
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || "Erro na requisição ao servidor.");
    }
    return res.json();
  }

  // ==========================================
  // CARREGAR DADOS DO BANCO DE DADOS (GET)
  // ==========================================
  async function carregarDadosEmpresa() {
    try {
      const empresa = await apiFetch("/api/empresa/atual");
      
      // Preenche Formulário 1 (Dados Básicos)
      document.getElementById("empNome").value = empresa.nome || "";
      document.getElementById("empCNPJ").value = empresa.cnpj || "";
      document.getElementById("empTelefone").value = empresa.telefone || "";
      document.getElementById("empEmail").value = empresa.email || "";
      
      // Preenche Formulário 2 (Endereço)
      document.getElementById("empCEP").value = empresa.cep || "";
      document.getElementById("empEstado").value = empresa.estado || "";
      document.getElementById("empCidade").value = empresa.cidade || "";
      document.getElementById("empRua").value = empresa.rua || "";
      document.getElementById("empNumero").value = empresa.numero || "";
      document.getElementById("empComplemento").value = empresa.complemento || "";

      // Mostra a logo se já existir no banco
      if (empresa.logo_url) {
        document.getElementById("logoPreviewBox").innerHTML = `<img src="${empresa.logo_url}" alt="Logo da Empresa">`;
      }

    } catch (err) {
      console.error("Erro ao carregar a empresa:", err);
      window.showToast("Não foi possível carregar os dados. Verifique a conexão.", "error");
    }
  }
  
  carregarDadosEmpresa();

  // ==========================================
  // UPLOAD DA LOGO DA EMPRESA (POST)
  // ==========================================
  const btnUpload = document.getElementById("btnUploadLogo");
  const logoInput = document.getElementById("logoInput");
  const btnRemove = document.getElementById("btnRemoveLogo");
  const previewBox = document.getElementById("logoPreviewBox");

  btnUpload.addEventListener("click", () => logoInput.click());

  logoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 1. Mostra a imagem na tela instantaneamente para o usuário
    const reader = new FileReader();
    reader.onload = (ev) => {
      previewBox.innerHTML = `<img src="${ev.target.result}" alt="Logo da Empresa">`;
    };
    reader.readAsDataURL(file);

    // 2. Prepara o envio para o Backend
    const formData = new FormData();
    formData.append("file", file);

    const originalText = btnUpload.innerHTML;
    btnUpload.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    btnUpload.disabled = true;

    try {
      const res = await fetch("/api/empresa/logo", { 
        method: "POST", 
        body: formData 
      });
      
      if (!res.ok) throw new Error("Falha ao salvar a imagem no servidor.");
      
      window.showToast("Logo da empresa atualizada com sucesso!", "success");
    } catch (err) {
      window.showToast(err.message, "error");
    } finally {
      btnUpload.innerHTML = originalText;
      btnUpload.disabled = false;
    }
  });

  btnRemove.addEventListener("click", () => {
    previewBox.innerHTML = '<i class="fa-solid fa-building" id="logoPlaceholderIcon"></i>';
    logoInput.value = "";
    // Adicional: Você pode criar uma rota DELETE /api/empresa/logo no futuro se quiser apagar do servidor
    window.showToast("Logo removida da visualização.", "success");
  });

  // ==========================================
  // SALVAR DADOS BÁSICOS (PUT)
  // ==========================================
  document.getElementById("formEmpresa").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btnSalvarEmpresa");
    btn.textContent = "Salvando...";
    btn.disabled = true;

    // O backend Python aceita envios parciais (exclude_unset=True)
    const payload = {
      nome: document.getElementById("empNome").value,
      cnpj: document.getElementById("empCNPJ").value,
      telefone: document.getElementById("empTelefone").value,
      email: document.getElementById("empEmail").value
    };

    try {
      await apiFetch("/api/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      window.showToast("Dados da empresa atualizados!", "success");
      
    } catch (err) {
      window.showToast("Erro ao salvar: " + err.message, "error");
    } finally {
      btn.textContent = "Salvar informações";
      btn.disabled = false;
    }
  });

  // ==========================================
  // SALVAR ENDEREÇO DA EMPRESA (PUT)
  // ==========================================
  document.getElementById("formEndereco").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btnSalvarEndereco");
    btn.textContent = "Atualizando...";
    btn.disabled = true;

    const payload = {
      cep: document.getElementById("empCEP").value,
      estado: document.getElementById("empEstado").value,
      cidade: document.getElementById("empCidade").value,
      rua: document.getElementById("empRua").value,
      numero: document.getElementById("empNumero").value,
      complemento: document.getElementById("empComplemento").value
    };

    try {
      await apiFetch("/api/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      window.showToast("Endereço salvo com sucesso!", "success");
    } catch (err) {
      window.showToast("Erro ao salvar endereço: " + err.message, "error");
    } finally {
      btn.textContent = "Atualizar endereço";
      btn.disabled = false;
    }
  });

  // ==========================================
  // MÁSCARAS DE INPUT (UX)
  // ==========================================
  document.getElementById("empCNPJ").addEventListener("input", function (e) {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/);
    e.target.value = !x[2] ? x[1] : x[1] + '.' + x[2] + (x[3] ? '.' + x[3] : '') + (x[4] ? '/' + x[4] : '') + (x[5] ? '-' + x[5] : '');
  });
  
  document.getElementById("empCEP").addEventListener("input", function (e) {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,5})(\d{0,3})/);
    e.target.value = !x[2] ? x[1] : x[1] + (x[2] ? '-' + x[2] : '');
  });

  // ==========================================
  // BUSCA AUTOMÁTICA DE CEP (VIACEP)
  // ==========================================
  const campoCep = document.getElementById("empCEP");
  
  campoCep.addEventListener("blur", async (e) => {
    // Tira os traços e letras para ficar só os 8 números
    const cepLimpo = e.target.value.replace(/\D/g, '');
    
    if (cepLimpo.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
        const data = await res.json();

        if (data.erro) {
          window.showToast("CEP não encontrado.", "error");
          return;
        }

        // Preenche os campos automaticamente
        document.getElementById("empRua").value = data.logradouro || "";
        document.getElementById("empCidade").value = data.localidade || "";
        document.getElementById("empEstado").value = data.uf || "";
        
        // Coloca o cursor piscando no campo "Número" para o usuário continuar digitando
        document.getElementById("empNumero").focus();
        window.showToast("Endereço preenchido automaticamente!", "success");

      } catch (err) {
        console.error("Erro na busca de CEP:", err);
        window.showToast("Erro ao buscar o CEP.", "error");
      }
    }
  });

});