export function renderUI(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>KoboTTS</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
  .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 1.5rem; }
  .card h2 { font-size: 1rem; margin-bottom: 1rem; color: #555; text-transform: uppercase; letter-spacing: .05em; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .field { display: flex; flex-direction: column; gap: .3rem; }
  .field.full { grid-column: 1 / -1; }
  label { font-size: .85rem; font-weight: 500; color: #444; }
  input, select { padding: .5rem .75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: .95rem; width: 100%; }
  input:focus, select:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: transparent; }
  .server-row { display: flex; gap: .5rem; }
  .server-row select { flex: 0 0 auto; width: auto; }
  .server-row input { flex: 1; }
  .actions { display: flex; gap: .75rem; margin-top: 1rem; }
  button { padding: .55rem 1.25rem; border: none; border-radius: 6px; font-size: .95rem; font-weight: 500; cursor: pointer; }
  #btn-load { background: #2563eb; color: #fff; }
  #btn-load:hover { background: #1d4ed8; }
  #btn-load:disabled { background: #93c5fd; cursor: default; }
  #btn-generate { background: #16a34a; color: #fff; display: none; }
  #btn-generate:hover { background: #15803d; }
  #btn-generate:disabled { background: #86efac; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th { text-align: left; padding: .5rem .75rem; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: .8rem; color: #6b7280; text-transform: uppercase; }
  td { padding: .5rem .75rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:hover td { background: #fafafa; }
  .badge { display: inline-block; padding: .15rem .5rem; border-radius: 99px; font-size: .78rem; font-weight: 500; }
  .badge-has { background: #dcfce7; color: #166534; }
  .badge-none { background: #f3f4f6; color: #6b7280; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-err { background: #fee2e2; color: #991b1b; }
  .badge-skip { background: #fef9c3; color: #854d0e; }
  #log { font-family: monospace; font-size: .85rem; background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; max-height: 260px; overflow-y: auto; white-space: pre-wrap; display: none; margin-top: 1rem; }
  #table-section { display: none; }
  #error-banner { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; margin-top: 1rem; display: none; font-size: .9rem; }
</style>
</head>
<body>
<h1>KoboTTS — Audio Generator</h1>

<div class="card">
  <h2>Connection</h2>
  <div class="fields">
    <div class="field full">
      <label for="token">Kobo API Token</label>
      <input type="password" id="token" placeholder="Your Kobo API token" autocomplete="off" />
    </div>
    <div class="field full">
      <label for="server-preset">Server</label>
      <div class="server-row">
        <select id="server-preset">
          <option value="https://kf.kobotoolbox.org">Global</option>
          <option value="https://eu.kobotoolbox.org">EU</option>
          <option value="custom">Other…</option>
        </select>
        <input type="text" id="server-custom" placeholder="https://your-kobo-server.org" style="display:none" />
      </div>
    </div>
    <div class="field full">
      <label for="asset-uid">Project UID</label>
      <input type="text" id="asset-uid" placeholder="aXXXXXXXXXXXXX" />
    </div>
    <div class="field">
      <label for="voice">Voice</label>
      <select id="voice">
        <option value="alloy">Alloy</option>
        <option value="echo">Echo</option>
        <option value="fable">Fable</option>
        <option value="onyx">Onyx</option>
        <option value="nova">Nova</option>
        <option value="shimmer">Shimmer</option>
      </select>
    </div>
  </div>
  <div class="actions">
    <button id="btn-load">Load Questions</button>
  </div>
  <div id="error-banner"></div>
</div>

<div id="table-section" class="card">
  <h2>Questions</h2>
  <table>
    <thead>
      <tr>
        <th><input type="checkbox" id="chk-all" checked title="Select all" /></th>
        <th>Name</th>
        <th>Label</th>
        <th>Hint</th>
        <th>Audio</th>
      </tr>
    </thead>
    <tbody id="question-tbody"></tbody>
  </table>
  <div class="actions">
    <button id="btn-generate">Generate Audio</button>
  </div>
  <div id="log"></div>
</div>

<script>
(function () {
  const $ = (id) => document.getElementById(id);

  // Server preset / custom toggle
  $('server-preset').addEventListener('change', () => {
    const custom = $('server-custom');
    custom.style.display = $('server-preset').value === 'custom' ? 'block' : 'none';
  });

  function getServerUrl() {
    const preset = $('server-preset').value;
    return preset === 'custom' ? $('server-custom').value.trim().replace(/\\/$/, '') : preset;
  }

  // Select-all checkbox
  $('chk-all').addEventListener('change', (e) => {
    document.querySelectorAll('.chk-row').forEach((c) => (c.checked = e.target.checked));
  });

  function showError(msg) {
    const el = $('error-banner');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearError() { $('error-banner').style.display = 'none'; }

  // Load Questions
  $('btn-load').addEventListener('click', async () => {
    clearError();
    const token = $('token').value.trim();
    const assetUid = $('asset-uid').value.trim();
    const serverUrl = getServerUrl();
    if (!token || !assetUid || !serverUrl) { showError('Please fill in all connection fields.'); return; }

    $('btn-load').disabled = true;
    $('btn-load').textContent = 'Loading…';
    try {
      const res = await fetch('/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ koboToken: token, serverUrl, assetUid }),
      });
      if (!res.ok) { showError(await res.text()); return; }
      const rows = await res.json();
      renderTable(rows);
      $('table-section').style.display = 'block';
      $('btn-generate').style.display = 'inline-block';
    } catch (e) {
      showError(e.message);
    } finally {
      $('btn-load').disabled = false;
      $('btn-load').textContent = 'Load Questions';
    }
  });

  function renderTable(rows) {
    const tbody = $('question-tbody');
    tbody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const badge = row.hasAudio
        ? '<span class="badge badge-has">✓ has audio</span>'
        : '<span class="badge badge-none">none</span>';
      tr.innerHTML =
        '<td><input type="checkbox" class="chk-row" data-name="' + row.name + '" checked /></td>' +
        '<td><code>' + esc(row.name) + '</code></td>' +
        '<td>' + esc(row.label) + '</td>' +
        '<td>' + esc(row.hint) + '</td>' +
        '<td>' + badge + '</td>';
      tbody.appendChild(tr);
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Generate Audio
  $('btn-generate').addEventListener('click', async () => {
    clearError();
    const token = $('token').value.trim();
    const assetUid = $('asset-uid').value.trim();
    const serverUrl = getServerUrl();
    const voice = $('voice').value;
    const selected = [...document.querySelectorAll('.chk-row:checked')].map((c) => c.dataset.name);
    if (selected.length === 0) { showError('Select at least one question.'); return; }

    $('btn-generate').disabled = true;
    $('btn-generate').textContent = 'Generating…';
    const log = $('log');
    log.style.display = 'block';
    log.textContent = '';

    try {
      const res = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ koboToken: token, serverUrl, assetUid, voice, questionNames: selected }),
      });
      if (!res.ok) { showError(await res.text()); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const evt = JSON.parse(line.slice(6));
          const icon = evt.status === 'generated' ? '✅' : evt.status === 'error' ? '❌' : '⏭';
          log.textContent += icon + ' ' + evt.question + (evt.message ? ': ' + evt.message : '') + '\\n';
          log.scrollTop = log.scrollHeight;
          // update badge in table
          const chk = document.querySelector('.chk-row[data-name="' + evt.question + '"]');
          if (chk && evt.status === 'generated') {
            const td = chk.closest('tr').querySelector('td:last-child');
            td.innerHTML = '<span class="badge badge-has">✓ has audio</span>';
          }
        }
      }
      log.textContent += '\\nDone.\\n';
    } catch (e) {
      showError(e.message);
    } finally {
      $('btn-generate').disabled = false;
      $('btn-generate').textContent = 'Generate Audio';
    }
  });
})();
</script>
</body>
</html>`;
}
