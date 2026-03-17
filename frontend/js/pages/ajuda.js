// /frontend/js/pages/ajuda.js

document.addEventListener('DOMContentLoaded', () => {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const questionButton = item.querySelector('.faq-question');
    const answerDiv = item.querySelector('.faq-answer');

    questionButton.addEventListener('click', () => {
      // Verifica se o item clicado já está aberto
      const isActive = item.classList.contains('active');

      // Primeiro, fecha todos os itens que estiverem abertos
      faqItems.forEach(otherItem => {
        otherItem.classList.remove('active');
        otherItem.querySelector('.faq-answer').style.maxHeight = null;
      });

      // Se o item que clicamos NÃO estava aberto, nós abrimos ele agora
      if (!isActive) {
        item.classList.add('active');
        // O scrollHeight pega exatamente a altura do texto lá dentro para animar certinho
        answerDiv.style.maxHeight = answerDiv.scrollHeight + "px";
      }
    });
  });
});