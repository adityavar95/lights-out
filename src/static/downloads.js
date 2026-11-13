// The top bar's Download assets button: every 4K sky and texture and the satellite ground, at once, so nothing has to load
// later. It says Assets ready when they're all here, as in a built exe. Until then the 3D stage streams lighter skies and textures, and
// satellite tiles from Esri, so nothing depends on pressing it.
const btn = () => document.getElementById('dlbtn');
let watched = false;  // this page saw a download run, so it's still on the lighter versions

function draw({state, done, total, failed, missing}) {
  const b = btn(), running = state === 'running';
  watched ||= running;
  const finished = !running && !missing && watched, ready = !running && !missing && !watched;
  b.hidden = false;
  b.classList.toggle('tvbtn', !running && !ready);
  b.disabled = running || ready;
  b.onclick = finished ? () => location.reload() : startDownload;
  const label = running ? `Downloading ${total ? Math.floor(done / total * 100) : 0}%` : finished ? 'Reload for 4K' : ready ? 'Assets ready' : state === 'error' ? 'Retry download' : 'Download assets';
  // a round icon like its neighbours when there's nothing to watch (all here, or not started); words while it runs or needs a click
  const icon = ready || label === 'Download assets';
  b.classList.toggle('themebtn', icon);
  b.setAttribute('aria-label', label);
  if (icon) b.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/></svg>${ready ? '<i class="dlok" aria-hidden="true"></i>' : ''}`;
  else b.textContent = label;
  b.title = label + ': ' + (running ? `${done.toLocaleString()} of ${total.toLocaleString()} files`
    : ready ? 'Every 4K sky, texture and satellite tile is on this computer'
    : state === 'error' ? `${failed.toLocaleString()} files failed. What's done is kept.`
    : '4K skies, textures and satellite ground for every circuit, about 600 MB, so nothing has to load later');
}

async function refresh() {
  const s = await fetch('/api/assets').then(r => r.json()).catch(() => null);
  if (!s) {  // no answer: mid-download (the server restarting, say) ask again, or the button stays on "Downloading" for good
    if (watched) setTimeout(refresh, 5000);
    return;
  }
  draw(s);
  if (s.state === 'running') setTimeout(refresh, 1000);
}

export const canDownload = () => !btn().hidden && !btn().disabled;

export async function startDownload() {
  try {
    if (!(await fetch('/api/assets/download', {method: 'POST'})).ok) throw new Error('refused');
    refresh();
  } catch (e) {
    btn().textContent = 'Retry download';
    btn().title = "The download couldn't start.";
  }
}

export const setupDownloads = () => refresh().catch(() => {});  // only an offer: no answer, no button
