<header class="valora-auvo-topbar">
    <button class="brand-btn" type="button" data-target="home" aria-label="Valora">
      <img
        class="brand-logo"
        src="/frontend/img/logo-favicon-dark.png"
        alt="Valora"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <span class="brand-fallback">V</span>
    </button>

    <button class="mobile-menu-btn" id="mobileMenuBtn" type="button" aria-label="Abrir menu">
      <i class="fa-solid fa-bars"></i>
    </button>

    <nav class="desktop-nav" aria-label="Menu principal">
      <div class="nav-group" data-menu-group>
        <button class="nav-trigger" type="button">
          Operação <i class="fa-solid fa-chevron-down"></i>
        </button>

        <div class="dropdown">
          <button class="dropdown-item" type="button" data-target="home">Dashboard</button>
          <button class="dropdown-item" type="button" data-target="orcamentos">Orçamentos</button>
          <button class="dropdown-item" type="button" data-target="contratos-admin">Contratos</button>
          <button class="dropdown-item" type="button" data-target="area-cliente-admin">Dados para Contrato</button>
        </div>
      </div>

      <div class="nav-group" data-menu-group>
        <button class="nav-trigger" type="button">
          Cadastros <i class="fa-solid fa-chevron-down"></i>
        </button>

        <div class="dropdown">
          <button class="dropdown-item" type="button" data-target="clientes">Clientes</button>
          <button class="dropdown-item" type="button" data-target="arquivos-tecnicos">Arquivos Técnicos</button>
          <button class="dropdown-item" type="button" data-target="fornecedores">Fornecedores</button>
          <button class="dropdown-item" type="button" data-target="cotacoes">Cotações</button>
          <button class="dropdown-item" type="button" data-target="produtos">Produtos</button>
          <button class="dropdown-item" type="button" data-target="patrimonio">Patrimônio</button>
          <button class="dropdown-item" type="button" data-target="usuarios">Usuários</button>
          <button class="dropdown-item" type="button" data-target="empresa">Empresa</button>
        </div>
      </div>

      <div class="nav-group" data-menu-group>
        <button class="nav-trigger" type="button">
          Financeiro <i class="fa-solid fa-chevron-down"></i>
        </button>

        <div class="dropdown dropdown-financeiro">
          <button class="dropdown-item" type="button" data-target="financeiro">Visão Geral</button>
          <button class="dropdown-item" type="button" data-target="vendas-financeiro">Vendas pendentes</button>
          <button class="dropdown-item" type="button" data-target="contas-receber">Contas a Receber</button>
          <button class="dropdown-item" type="button" data-target="contas-pagar">Contas a Pagar</button>
          <button class="dropdown-item" type="button" data-target="fluxo-caixa">Fluxo de Caixa</button>
          <button class="dropdown-item" type="button" data-target="categorias-financeiras">Categorias</button>
          <button class="dropdown-item" type="button" data-target="formas-pagamento">Formas de Pagamento</button>
          <button class="dropdown-item" type="button" data-target="contas-bancos">Contas/Bancos</button>
          <button class="dropdown-item" type="button" data-target="cadastros-financeiros">Cadastros Financeiros</button>
          <button class="dropdown-item" type="button" data-target="relatorios-financeiros">Relatórios Financeiros</button>
        </div>
      </div>

      <div class="nav-group" data-menu-group>
        <button class="nav-trigger" type="button">
          Relatórios <i class="fa-solid fa-chevron-down"></i>
        </button>

        <div class="dropdown">
          <button class="dropdown-item" type="button" data-target="home">Dashboard</button>
          <button class="dropdown-item" type="button" data-target="formularios">Formulários</button>
        </div>
      </div>

      <button class="nav-link" type="button" data-target="formularios">Formulários</button>
      <button class="nav-link" type="button" data-target="ajuda">Ajuda</button>
    </nav>

    <div class="right-actions">
      <button class="plain-action" type="button" data-target="ajuda">
        Primeiros passos
      </button>

      <button class="new-action" type="button" data-target="orcamentos">
        <span class="plus">+</span>
        <span class="label">Novo Orçamento</span>
      </button>

      <button class="bell-btn valora-menu-bell" type="button" data-action="agenda" data-agenda-global-open aria-label="Notificações">
        <i class="fa-solid fa-bell"></i>
        <span class="agenda-badge" id="agendaBadge">0</span>
      </button>

      <div class="settings-wrap" id="settingsWrap">
        <button class="settings-trigger" id="settingsBtn" type="button" aria-label="Configurações de aparência">
          <i class="fa-solid fa-gear"></i>
        </button>

        <div class="settings-menu" id="settingsMenu">
          <div class="settings-title">Aparência</div>

          <button class="theme-option" type="button" data-theme-option="light">
            <span class="theme-radio"></span>
            <span>Tema claro</span>
          </button>

          <button class="theme-option" type="button" data-theme-option="dark">
            <span class="theme-radio"></span>
            <span>Tema escuro</span>
          </button>

          <div class="settings-divider"></div>

          <button class="settings-link" type="button" data-target="config" data-target="config">
            <i class="fa-solid fa-sliders"></i>
            Configurações
          </button>

          <button class="settings-link" type="button" data-target="empresa" data-target="empresa">
            <i class="fa-solid fa-building"></i>
            Minha Empresa
          </button>

          <button class="settings-link" type="button" data-target="perfil" data-target="perfil">
            <i class="fa-regular fa-user"></i>
            Meu Perfil
          </button>
        </div>
      </div>

      <div class="user-wrap" id="userWrap">
        <button class="user-trigger" id="userProfileBtn" type="button">
          <span class="user-initials" id="sidebarUserInitials">U</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>

        <div class="user-menu" id="userDropdown">
          <div class="user-card">
            <strong id="sidebarUserName">Usuário</strong>
            <span id="sidebarUserEmail">email@empresa.com</span>
          </div>

          <button type="button" data-target="perfil" data-target="perfil">
            <i class="fa-regular fa-user"></i>
            Meu Perfil
          </button>

          <button type="button" data-target="empresa" data-target="empresa">
            <i class="fa-solid fa-building"></i>
            Minha Empresa
          </button>

          <button type="button" data-target="config" data-target="config">
            <i class="fa-solid fa-gear"></i>
            Configurações
          </button>

          <button type="button" class="danger" data-action="logout" data-action="logout">
            <i class="fa-solid fa-arrow-right-from-bracket"></i>
            Sair do Sistema
          </button>
        </div>
      </div>
    </div>
  </header>

  <div class="mobile-panel" id="mobilePanel">
    <div class="mobile-search-wrap">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input id="mobileMenuSearch" type="search" placeholder="Buscar no menu" autocomplete="off" aria-label="Buscar no menu" />
      <button id="mobileMenuSearchClear" type="button" aria-label="Limpar busca" hidden><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="mobile-section">
      <div class="mobile-title">Operação</div>
      <button class="mobile-link" type="button" data-target="home"><i class="fa-solid fa-chart-line"></i> Dashboard</button>
      <button class="mobile-link" type="button" data-target="orcamentos"><i class="fa-solid fa-file-invoice-dollar"></i> Orçamentos</button>
      <button class="mobile-link" type="button" data-target="contratos-admin"><i class="fa-solid fa-file-contract"></i> Contratos</button>
      <button class="mobile-link" type="button" data-target="area-cliente-admin"><i class="fa-solid fa-address-card"></i> Dados para Contrato</button>
    </div>

    <div class="mobile-section">
      <div class="mobile-title">Cadastros</div>
      <button class="mobile-link" type="button" data-target="clientes"><i class="fa-solid fa-user-group"></i> Clientes</button>
      <button class="mobile-link" type="button" data-target="arquivos-tecnicos"><i class="fa-solid fa-folder-tree"></i> Arquivos Técnicos</button>
      <button class="mobile-link" type="button" data-target="fornecedores"><i class="fa-solid fa-truck"></i> Fornecedores</button>
      <button class="mobile-link" type="button" data-target="cotacoes"><i class="fa-solid fa-scale-balanced"></i> Cotações</button>
      <button class="mobile-link" type="button" data-target="produtos"><i class="fa-solid fa-box-open"></i> Produtos</button>
      <button class="mobile-link" type="button" data-target="patrimonio"><i class="fa-solid fa-tags"></i> Patrimônio</button>
      <button class="mobile-link" type="button" data-target="usuarios"><i class="fa-solid fa-id-badge"></i> Usuários</button>
      <button class="mobile-link" type="button" data-target="empresa"><i class="fa-solid fa-building"></i> Empresa</button>
    </div>

    <div class="mobile-section">
      <div class="mobile-title">Financeiro</div>
      <button class="mobile-link" type="button" data-target="financeiro"><i class="fa-solid fa-chart-pie"></i> Visão Geral</button>
      <button class="mobile-link" type="button" data-target="vendas-financeiro"><i class="fa-solid fa-cart-arrow-down"></i> Vendas pendentes</button>
      <button class="mobile-link" type="button" data-target="contas-receber"><i class="fa-solid fa-hand-holding-dollar"></i> Contas a Receber</button>
      <button class="mobile-link" type="button" data-target="contas-pagar"><i class="fa-solid fa-file-invoice-dollar"></i> Contas a Pagar</button>
      <button class="mobile-link" type="button" data-target="fluxo-caixa"><i class="fa-solid fa-money-bill-transfer"></i> Fluxo de Caixa</button>
      <button class="mobile-link" type="button" data-target="categorias-financeiras"><i class="fa-solid fa-folder-tree"></i> Categorias</button>
      <button class="mobile-link" type="button" data-target="formas-pagamento"><i class="fa-solid fa-credit-card"></i> Formas de Pagamento</button>
      <button class="mobile-link" type="button" data-target="contas-bancos"><i class="fa-solid fa-building-columns"></i> Contas/Bancos</button>
      <button class="mobile-link" type="button" data-target="cadastros-financeiros"><i class="fa-solid fa-sliders"></i> Cadastros Financeiros</button>
      <button class="mobile-link" type="button" data-target="relatorios-financeiros"><i class="fa-solid fa-chart-column"></i> Relatórios Financeiros</button>
    </div>

    <div class="mobile-section">
      <div class="mobile-title">Ajustes</div>
      <button class="mobile-link" type="button" data-target="formularios"><i class="fa-solid fa-wand-magic-sparkles"></i> Formulários</button>
      <button class="mobile-link" type="button" data-target="config"><i class="fa-solid fa-gear"></i> Configurações</button>
      <button class="mobile-link" type="button" data-target="ajuda"><i class="fa-regular fa-circle-question"></i> Ajuda</button>
    </div>
  </div>
