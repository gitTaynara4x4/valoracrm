const MODULOS = [
  { key: "dashboard", label: "Dashboard", desc: "Visão geral do sistema" },
  { key: "clientes", label: "Clientes", desc: "Cadastro e gestão de clientes" },
  { key: "fornecedores", label: "Fornecedores", desc: "Cadastro e gestão de fornecedores" },
  { key: "produtos", label: "Produtos", desc: "Catálogo e itens" },
  { key: "propostas", label: "Propostas", desc: "Orçamentos e propostas" },
  { key: "usuarios", label: "Usuários", desc: "Gestão de acessos" },
  { key: "empresa", label: "Empresa", desc: "Dados da empresa" },
  { key: "configuracoes", label: "Configurações", desc: "Preferências e ajustes" },
];

const stateUsuarios = {
  lista: [],
  filtrados: [],
  editandoId: null,
  currentUser: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function roleLabel(role) {
  const r = normalizeText(role);
  if (r === "owner") return "Owner";
  if (r === "admin") return "Admin";
  if (r === "visualizador") return "Visualizador";
  return "Colaborador";
}

function roleClass(role) {
  const r = normalizeText(role);
  return ["owner", "admin", "colaborador", "visualizador"].includes(r) ? r : "colaborador";
}

function statusLabel(active) {
  return active ? "Ativo" : "Inativo";
}

function buildPermissionsGrid() {
  const container = $("permissions-grid-body");
  if (!container) return;

  container.innerHTML = MODULOS.map((mod) => `
    <div class="permissions-grid perm-row">
      <div class="perm-module">
        <strong>${escapeHtml(mod.label)}</strong>
        <span>${escapeHtml(mod.desc)}</span>
      </div>

      <label class="perm-check">
        <input type="checkbox" data-modulo="${mod.key}" data-acao="ver" />
      </label>

      <label class="perm-check">
        <input type="checkbox" data-modulo="${mod.key}" data-acao="criar" />
      </label>

      <label class="perm-check">
        <input type="checkbox" data-modulo="${mod.key}" data-acao="editar" />
      </label>

      <label class="perm-check">
        <input type="checkbox" data-modulo="${mod.key}" data-acao="excluir" />
      </label>
    </div>
  `).join("");
}

function toast(msg, error = false, ms = 2600) {
  const el = $("valora-toast");
  if (!el) return;

  el.textContent = msg || "";
  el.classList.toggle("is-error", !!error);
  el.classList.add("show");

  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove("show");
  }, ms);
}

let _confirmResolver = null;
function confirmDialog({
  title = "Confirmar",
  message = "Tem certeza?",
  confirmText = "OK",
  cancelText = "Cancelar"
} = {}) {
  const backdrop = $("Valora-confirm-backdrop");
  $("Valora-confirm-title").textContent = title;
  $("Valora-confirm-message").textContent = message;
  $("Valora-confirm-ok").textContent = confirmText;
  $("Valora-confirm-cancel").textContent = cancelText;

  if (!backdrop) return Promise.resolve(false);
  backdrop.classList.add("show");

  return new Promise((resolve) => {
    _confirmResolver = resolve;
  });
}

function closeConfirm(result = false) {
  const backdrop = $("Valora-confirm-backdrop");
  if (backdrop) backdrop.classList.remove("show");

  if (typeof _confirmResolver === "function") {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

function openModal(edicao = false) {
  $("modal-usuario-backdrop")?.classList.add("show");
  $("modal-title").textContent = edicao ? "Editar usuário" : "Novo usuário";
  setTimeout(() => $("usuario-nome")?.focus(), 80);
}

function closeModal() {
  $("modal-usuario-backdrop")?.classList.remove("show");
  limparFormulario();
}

function clearPermissionsForm() {
  document.querySelectorAll('#permissions-grid-body input[type="checkbox"]').forEach((el) => {
    el.checked = false;
  });
}

function setPermissionsVisibility() {
  const papel = normalizeText($("usuario-papel")?.value);
  const bloco = $("bloco-permissoes");
  const note = $("permissions-note");
  const btnLeitura = $("btn-marcar-leitura");

  const hide = papel === "owner" || papel === "admin";

  if (bloco) bloco.style.display = hide ? "none" : "";
  if (btnLeitura) btnLeitura.style.display = hide ? "none" : "";
  if (note) {
    note.innerHTML = hide
      ? `Usuários com papel <strong>${roleLabel(papel)}</strong> possuem acesso amplo. As permissões por módulo não precisam ser configuradas manualmente.`
      : `Usuários com papel <strong>${roleLabel(papel)}</strong> usam as permissões abaixo. Marque exatamente o que este usuário poderá fazer.`;
  }
}

function limparFormulario() {
  stateUsuarios.editandoId = null;
  $("form-usuario")?.reset();
  $("usuario-id").value = "";
  $("usuario-papel").value = "colaborador";
  $("usuario-ativo").value = "true";
  $("usuario-senha").required = true;
  
  // Limpa o preview da foto
  if ($("usuario-foto")) $("usuario-foto").value = "";
  if ($("avatar-preview")) {
    $("avatar-preview").src = "";
    $("avatar-preview").style.display = "none";
  }
  if ($("avatar-default-icon")) {
    $("avatar-default-icon").style.display = "block";
  }

  clearPermissionsForm();
  setPermissionsVisibility();
}

function preencherFormularioBasico(usuario) {
  stateUsuarios.editandoId = usuario.id;
  $("usuario-id").value = usuario.id;
  $("usuario-nome").value = usuario.nome || "";
  $("usuario-email").value = usuario.email || "";
  $("usuario-telefone").value = usuario.telefone || "";
  $("usuario-cargo").value = usuario.cargo || "";
  $("usuario-papel").value = usuario.papel || "colaborador";
  $("usuario-ativo").value = String(Boolean(usuario.ativo));
  $("usuario-senha").value = "";
  $("usuario-senha").required = false;

  // Lógica para foto ao editar (se a API retornar uma URL da foto no futuro)
  if (usuario.foto_url) {
    $("avatar-preview").src = usuario.foto_url;
    $("avatar-preview").style.display = "block";
    $("avatar-default-icon").style.display = "none";
  } else {
    $("avatar-preview").src = "";
    $("avatar-preview").style.display = "none";
    $("avatar-default-icon").style.display = "block";
  }

  clearPermissionsForm();
  setPermissionsVisibility();
}

function setPermissionCheck(modulo, acao, value) {
  const el = document.querySelector(
    `#permissions-grid-body input[data-modulo="${modulo}"][data-acao="${acao}"]`
  );
  if (el) el.checked = !!value;
}

function preencherPermissoes(permissoes = {}) {
  clearPermissionsForm();

  MODULOS.forEach((mod) => {
    const p = permissoes?.[mod.key] || {};
    setPermissionCheck(mod.key, "ver", !!p.pode_ver);
    setPermissionCheck(mod.key, "criar", !!p.pode_criar);
    setPermissionCheck(mod.key, "editar", !!p.pode_editar);
    setPermissionCheck(mod.key, "excluir", !!p.pode_excluir);
  });
}

function coletarPermissoes() {
  const mapa = {};

  MODULOS.forEach((mod) => {
    mapa[mod.key] = {
      modulo: mod.key,
      pode_ver: false,
      pode_criar: false,
      pode_editar: false,
      pode_excluir: false,
    };
  });

  document.querySelectorAll('#permissions-grid-body input[type="checkbox"]').forEach((check) => {
    const modulo = check.dataset.modulo;
    const acao = check.dataset.acao;
    if (!mapa[modulo]) return;

    if (acao === "ver") mapa[modulo].pode_ver = check.checked;
    if (acao === "criar") mapa[modulo].pode_criar = check.checked;
    if (acao === "editar") mapa[modulo].pode_editar = check.checked;
    if (acao === "excluir") mapa[modulo].pode_excluir = check.checked;
  });

  return Object.values(mapa);
}

function liberarSomenteLeitura() {
  clearPermissionsForm();
  MODULOS.forEach((mod) => setPermissionCheck(mod.key, "ver", true));
}

function atualizarContagem() {
  const total = stateUsuarios.filtrados.length;
  $("contagem-usuarios").textContent = `${total} usuário${total === 1 ? "" : "s"}`;
}

function renderTabela() {
  const tbody = $("tabela-usuarios");
  const lista = stateUsuarios.filtrados;

  if (!lista.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state table-loading">Nenhum usuário encontrado.</td>
      </tr>
    `;
    atualizarContagem();
    return;
  }

  tbody.innerHTML = lista.map((usuario) => `
    <tr>
      <td>
        <div class="user-main">
          <strong>${escapeHtml(usuario.nome || "Sem nome")}</strong>
          <span>ID #${usuario.id}</span>
        </div>
      </td>
      <td>${escapeHtml(usuario.email || "-")}</td>
      <td>${escapeHtml(usuario.telefone || "-")}</td>
      <td><span class="badge-cargo">${escapeHtml(usuario.cargo || "-")}</span></td>
      <td><span class="badge-role ${roleClass(usuario.papel)}">${escapeHtml(roleLabel(usuario.papel))}</span></td>
      <td><span class="badge-status ${usuario.ativo ? "ativo" : "inativo"}">${escapeHtml(statusLabel(!!usuario.ativo))}</span></td>
      <td style="text-align:right;">
        <button class="btn-icon" type="button" title="Editar" data-edit-id="${usuario.id}">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon danger" type="button" title="Excluir" data-del-id="${usuario.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join("");

  atualizarContagem();
}

function aplicarFiltro() {
  const q = normalizeText($("busca-usuarios").value);

  if (!q) {
    stateUsuarios.filtrados = [...stateUsuarios.lista];
    renderTabela();
    return;
  }

  stateUsuarios.filtrados = stateUsuarios.lista.filter((usuario) => {
    const blob = [
      usuario.nome,
      usuario.email,
      usuario.telefone,
      usuario.cargo,
      usuario.papel,
      usuario.ativo ? "ativo" : "inativo",
    ].map(normalizeText).join(" ");

    return blob.includes(q);
  });

  renderTabela();
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (res.status === 401) {
    toast("Sessão expirada. Faça login novamente.", true);
    throw new Error("Sessão expirada");
  }

  const raw = await res.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!res.ok) {
    const msg = data?.detail || data?.message || `Erro HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function carregarMeuPerfilPermissoes() {
  try {
    const me = await api("/api/permissoes/me");
    stateUsuarios.currentUser = me;
  } catch (err) {
    console.error("[usuarios] erro ao carregar /me:", err);
  }
}

async function carregarUsuarios() {
  try {
    const lista = await api("/api/usuarios");
    stateUsuarios.lista = Array.isArray(lista) ? lista : [];
    stateUsuarios.filtrados = [...stateUsuarios.lista];
    renderTabela();
  } catch (err) {
    console.error("[usuarios] erro ao carregar:", err);
    $("tabela-usuarios").innerHTML = `
      <tr>
        <td colspan="7" class="empty-state table-loading" style="color:#ef4444;">
          Erro ao carregar usuários: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
    $("contagem-usuarios").textContent = "0 usuários";
  }
}

function coletarPayloadUsuario() {
  // Nota: Como as requisições para a API são em application/json, 
  // caso queira enviar o arquivo da foto no futuro, precisaremos alterar o payload
  // para usar o formato FormData ou enviar a foto como string Base64.
  return {
    nome: $("usuario-nome").value.trim(),
    email: $("usuario-email").value.trim(),
    telefone: $("usuario-telefone").value.trim() || null,
    cargo: $("usuario-cargo").value.trim() || null,
    senha: $("usuario-senha").value || null,
    papel: $("usuario-papel").value,
    ativo: $("usuario-ativo").value === "true",
  };
}

async function salvarPermissoesDoUsuario(usuarioId, papel) {
  const role = normalizeText(papel);

  let permissoes = [];
  if (role === "colaborador" || role === "visualizador") {
    permissoes = coletarPermissoes();
  }

  await api(`/api/permissoes/usuarios/${usuarioId}`, {
    method: "PUT",
    body: JSON.stringify({
      papel: role,
      permissoes,
    }),
  });
}

async function salvarUsuario(event) {
  event.preventDefault();

  const payload = coletarPayloadUsuario();
  const btnSalvar = $("btn-salvar-usuario");

  if (!payload.nome) {
    toast("Informe o nome do usuário.", true);
    return;
  }

  if (!payload.email) {
    toast("Informe o e-mail do usuário.", true);
    return;
  }

  if (!stateUsuarios.editandoId && !payload.senha) {
    toast("Informe a senha do novo usuário.", true);
    return;
  }

  btnSalvar.disabled = true;
  btnSalvar.textContent = "Salvando...";

  try {
    let usuarioSalvo = null;

    if (stateUsuarios.editandoId) {
      usuarioSalvo = await api(`/api/usuarios/${stateUsuarios.editandoId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      await salvarPermissoesDoUsuario(stateUsuarios.editandoId, payload.papel);
      toast("Usuário atualizado com sucesso!");
    } else {
      usuarioSalvo = await api("/api/usuarios", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await salvarPermissoesDoUsuario(usuarioSalvo.id, payload.papel);
      toast("Usuário cadastrado com sucesso!");
    }

    closeModal();
    await carregarUsuarios();
  } catch (err) {
    console.error("[usuarios] erro ao salvar:", err);
    toast(err.message || "Não foi possível salvar o usuário.", true);
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = "Salvar usuário";
  }
}

async function carregarUsuarioParaEdicao(id) {
  const usuario = stateUsuarios.lista.find((u) => u.id === id);
  if (!usuario) return;

  preencherFormularioBasico(usuario);

  try {
    const resp = await api(`/api/permissoes/usuarios/${id}`);
    if (resp?.papel) {
      $("usuario-papel").value = resp.papel;
    }
    setPermissionsVisibility();
    preencherPermissoes(resp?.permissoes || {});
  } catch (err) {
    console.error("[usuarios] erro ao carregar permissões do usuário:", err);
    toast(err.message || "Não foi possível carregar as permissões do usuário.", true);
  }

  openModal(true);
}

async function excluirUsuario(id) {
  const item = stateUsuarios.lista.find((u) => u.id === id);
  const nome = item?.nome || "este usuário";

  const confirmado = await confirmDialog({
    title: "Excluir usuário",
    message: `Tem certeza que deseja excluir permanentemente o usuário ${nome}?`,
    confirmText: "Excluir",
  });

  if (!confirmado) return;

  try {
    await api(`/api/usuarios/${id}`, { method: "DELETE" });
    toast("Usuário excluído com sucesso!");
    await carregarUsuarios();
  } catch (err) {
    console.error("[usuarios] erro ao excluir:", err);
    toast(err.message || "Não foi possível excluir o usuário.", true);
  }
}

function bindTabelaEventos() {
  $("tabela-usuarios").addEventListener("click", (event) => {
    const btnEdit = event.target.closest("[data-edit-id]");
    const btnDelete = event.target.closest("[data-del-id]");

    if (btnEdit) {
      const id = Number(btnEdit.dataset.editId);
      carregarUsuarioParaEdicao(id);
      return;
    }

    if (btnDelete) {
      const id = Number(btnDelete.dataset.delId);
      excluirUsuario(id);
    }
  });
}

function bindAvatarUpload() {
  const inputFoto = $("usuario-foto");
  if (!inputFoto) return;

  inputFoto.addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(event) {
        $("avatar-preview").src = event.target.result;
        $("avatar-preview").style.display = "block";
        if ($("avatar-default-icon")) {
          $("avatar-default-icon").style.display = "none";
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

function bindUI() {
  $("Valora-confirm-cancel")?.addEventListener("click", () => closeConfirm(false));
  $("Valora-confirm-ok")?.addEventListener("click", () => closeConfirm(true));

  $("btn-novo-usuario")?.addEventListener("click", () => {
    limparFormulario();
    openModal(false);
  });

  $("btn-fechar-modal")?.addEventListener("click", closeModal);
  $("btn-cancelar-modal")?.addEventListener("click", closeModal);
  $("btn-marcar-leitura")?.addEventListener("click", liberarSomenteLeitura);
  $("usuario-papel")?.addEventListener("change", setPermissionsVisibility);

  $("modal-usuario-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $("modal-usuario-backdrop")) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("modal-usuario-backdrop")?.classList.contains("show")) closeModal();
      if ($("Valora-confirm-backdrop")?.classList.contains("show")) closeConfirm(false);
    }
  });

  $("form-usuario")?.addEventListener("submit", salvarUsuario);
  $("busca-usuarios")?.addEventListener("input", aplicarFiltro);

  bindTabelaEventos();
  bindAvatarUpload(); // Ativa a lógica de preview de foto
}

document.addEventListener("DOMContentLoaded", async () => {
  buildPermissionsGrid();
  bindUI();
  await carregarMeuPerfilPermissoes();
  await carregarUsuarios();
  setPermissionsVisibility();
});