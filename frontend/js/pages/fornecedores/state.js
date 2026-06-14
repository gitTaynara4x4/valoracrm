export const state = {
  fornecedores: [],
  fornecedoresPage: { offset: 0, limit: 50, total: 0, hasMore: false },
  camposFornecedores: [],
  fornecedorEditandoId: null,
  campoEditandoId: null,
};

export const API_FORNECEDORES = '/api/fornecedores';
export const API_CAMPOS = '/api/fornecedores/campos';