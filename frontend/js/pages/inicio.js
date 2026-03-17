// /frontend/js/pages/inicio.js

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function toggleMenu() {
  const menu = $('#mobileMenu');
  if (!menu) return;
  menu.classList.toggle('active');
}

function closeMenu() {
  const menu = $('#mobileMenu');
  if (!menu) return;
  menu.classList.remove('active');
}

function toggleFaq(button) {
  const faqItem = button?.closest('.faq-item');
  if (!faqItem) return;

  const isActive = faqItem.classList.contains('active');

  $$('.faq-item').forEach(item => item.classList.remove('active'));

  if (!isActive) {
    faqItem.classList.add('active');
  }
}

function initSmoothScroll() {
  $$('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;

      const targetElement = $(targetId);
      if (!targetElement) return;

      e.preventDefault();

      window.scrollTo({
        top: targetElement.offsetTop - 80,
        behavior: 'smooth'
      });

      closeMenu();
    });
  });
}

function initHeaderScroll() {
  const header = $('header');
  if (!header) return;

  const updateHeader = () => {
    if (window.scrollY > 50) {
      header.style.padding = '12px 0';
      header.style.backdropFilter = 'blur(16px) saturate(180%)';
      header.style.webkitBackdropFilter = 'blur(16px) saturate(180%)';
    } else {
      header.style.padding = '16px 0';
      header.style.backdropFilter = 'blur(20px) saturate(180%)';
      header.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
    }
  };

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

function initFadeIn() {
  const els = $$('.fade-in');
  if (!els.length || !('IntersectionObserver' in window)) {
    els.forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.style.animationPlayState = 'running';
      obs.unobserve(entry.target);
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  els.forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
}

function initOutsideMenuClose() {
  document.addEventListener('click', (e) => {
    const menu = $('#mobileMenu');
    const toggle = $('.mobile-toggle');
    if (!menu || !toggle) return;
    if (!menu.classList.contains('active')) return;

    const clickedInsideMenu = menu.contains(e.target);
    const clickedToggle = toggle.contains(e.target);

    if (!clickedInsideMenu && !clickedToggle) {
      closeMenu();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSmoothScroll();
  initHeaderScroll();
  initFadeIn();
  initOutsideMenuClose();
});

window.toggleMenu = toggleMenu;
window.toggleFaq = toggleFaq;