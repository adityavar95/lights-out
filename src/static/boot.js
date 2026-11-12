// Boot failure notice, kept out of index.html so the page can run under a Content-Security-Policy with no inline scripts.
// The module graph didn't load: at once on an error, after 20 s when the CDN just hangs (and gone again if it then arrives).
const bootfail = document.getElementById('bootfail');
const bootFail = () => { bootfail.hidden = false; };
const bootTimer = setTimeout(bootFail, 20000);
const app = document.getElementById('app-js');
app.addEventListener('error', () => { clearTimeout(bootTimer); bootFail(); });
app.addEventListener('load', () => { clearTimeout(bootTimer); bootfail.hidden = true; });
document.getElementById('bootreload').addEventListener('click', () => location.reload());
