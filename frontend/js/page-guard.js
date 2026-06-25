// Compatibilidade: o backend já faz o guard via cookie.
(() => {
  if (!document.cookie.includes('user_id=')) {
    // Não força redirecionamento aqui para não atrapalhar testes locais;
    // a API/backend já responde 401 ou redireciona quando necessário.
  }
})();
