// Static fixture DOM only: never bootstrap the app, open storage or send requests.
for (const element of document.querySelectorAll('[data-snapshot-style]')) {
  for (const [name, value, priority] of JSON.parse(element.dataset.snapshotStyle)) {
    element.style.setProperty(name, value, priority);
  }
  delete element.dataset.snapshotStyle;
}
const dialogs = [...document.querySelectorAll('dialog[open]')];
const syncViewport = () => {
  for (const dialog of dialogs) {
    dialog.style.setProperty('--dialog-viewport-height', `${window.visualViewport?.height ?? innerHeight}px`);
    dialog.style.setProperty('--dialog-viewport-top', `${window.visualViewport?.offsetTop ?? 0}px`);
  }
};
syncViewport();
window.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
for (const dialog of dialogs) dialog.removeAttribute('open');
dialogs.at(-1)?.showModal();
document.addEventListener('click', event => {
  if (event.target.closest('a,button')) event.preventDefault();
});
document.addEventListener('submit', event => event.preventDefault());
document.addEventListener('cancel', event => event.preventDefault(), true);
document.documentElement.dataset.previewReady = 'true';
