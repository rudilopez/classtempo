'use strict';

const contents = document.querySelector('#contents-panel');
const narrow = window.matchMedia('(max-width: 900px)');
const syncContents = () => { contents.open = !narrow.matches; };
syncContents();
narrow.addEventListener('change', syncContents);

const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const topics = [...document.querySelectorAll('[data-topic]')].map((section) => ({
  section, title: section.dataset.topic, description: section.dataset.description,
  content: normalize(section.textContent),
}));
const input = document.querySelector('#guide-search');
const form = document.querySelector('.guide-search');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const search = () => {
  const words = normalize(input.value).split(/\s+/).filter(Boolean);
  results.replaceChildren();
  if (!words.length) { results.hidden = true; status.textContent = ''; return; }
  const found = topics.filter((topic) => words.every((word) => topic.content.includes(word)
    || normalize(`${topic.title} ${topic.description}`).includes(word)))
    .sort((a, b) => words.filter((w) => normalize(b.title).includes(w)).length - words.filter((w) => normalize(a.title).includes(w)).length);
  for (const topic of found) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${topic.section.id}`;
    link.textContent = topic.title;
    const description = document.createElement('small');
    description.textContent = topic.description;
    link.append(description); item.append(link); results.append(item);
  }
  results.hidden = !found.length;
  status.textContent = found.length ? `${found.length} matching ${found.length === 1 ? 'topic' : 'topics'}` : 'No topic found. Try “cues”, “repeat”, “video” or “offline”.';
};
input.addEventListener('input', search);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  results.querySelector('a')?.click();
});

// Close only the mobile contents panel, then move focus to the selected heading.
document.querySelectorAll('.contents').forEach((area) => area.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const destination = document.getElementById(link.hash.slice(1));
  if (!destination) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (narrow.matches) contents.open = false;
  if (location.hash !== link.hash) history.pushState(null, '', link.hash);
  const heading = destination.querySelector('h2');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  destination.scrollIntoView({ block: 'start' });
}));

const navigation = [...document.querySelectorAll('.contents nav a')];
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    navigation.forEach((link) => {
      if (link.hash === `#${visible.target.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-90px 0px -65% 0px' });
  topics.forEach((topic) => observer.observe(topic.section));
}

const dialog = document.querySelector('#image-dialog');
const enlarged = document.querySelector('#enlarged-image');
const caption = document.querySelector('#image-caption');
const dialogTitle = document.querySelector('#image-dialog-title');
let opener = null;
let previousOverflow = '';
document.querySelectorAll('[data-zoom]').forEach((button) => button.addEventListener('click', () => {
  const screenshot = button.querySelector('img');
  if (typeof dialog.showModal !== 'function') { window.open(screenshot.src, '_blank', 'noopener'); return; }
  opener = button;
  enlarged.src = screenshot.src;
  enlarged.alt = screenshot.alt;
  enlarged.classList.toggle('is-landscape', screenshot.naturalWidth > screenshot.naturalHeight);
  caption.textContent = button.closest('figure')?.querySelector('figcaption')?.textContent ?? '';
  dialogTitle.textContent = 'App screenshot';
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  document.querySelector('#close-image').focus();
}));
document.querySelector('#close-image').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.style.overflow = previousOverflow;
  opener?.focus({ preventScroll: true });
});
