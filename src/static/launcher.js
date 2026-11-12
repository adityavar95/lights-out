// Launcher buttons: data-call names the pywebview API call (or a local action) each button makes.
// pywebview injects window.pywebview.api a moment after the page loads
const api = (name, ...args) => window.pywebview?.api?.[name]?.(...args);
const openApp = () => api('open_app');
function openBrowser() {
  api('open_browser');
  pick.hidden = true;
  away.hidden = false;
  document.body.classList.add('away');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-call]');
  if (!b) return;
  if (b.dataset.call === 'open_app') openApp();
  else if (b.dataset.call === 'browser') openBrowser();
  else api(b.dataset.call);
});
where.textContent = `Ready on ${location.host}`;
addEventListener('keydown', e => {
  if (!pick.hidden && e.key === 'Enter' && document.activeElement === document.body) openApp();
  if (!pick.hidden && (e.key === 'b' || e.key === 'B')) openBrowser();
});
