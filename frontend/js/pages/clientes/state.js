export const state = {
  clientes: [],
  clientesPage: { offset: 0, limit: 50, total: 0, hasMore: false },
  clientesLoading: false,
  camposClientes: [],
  formularioClientes: null,
  usarFichaPrincipalClientes: false,
  clienteEditandoId: null,
  campoEditandoId: null,
  lastSavedClienteId: null,
};

export const API_CLIENTES = '/api/clientes';
export const API_CAMPOS = '/api/campos-clientes';
export const API_FORMULARIOS = '/api/formularios';