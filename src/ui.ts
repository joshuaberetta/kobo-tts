export function renderUI(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>KoboTTS</title>
<link rel="stylesheet" href="https://unpkg.com/@mantine/core@7/styles.css" />
</head>
<body>
<div id="root"></div>
<script type="module">
import { createElement as h, useState, useRef, useEffect } from 'https://esm.sh/react@18';
import { createRoot } from 'https://esm.sh/react-dom@18/client';
import {
  MantineProvider, Container, Title, Paper, Stack, Group,
  TextInput, PasswordInput, Select, Button, Checkbox, Table,
  Badge, Text, Alert, Code
} from 'https://esm.sh/@mantine/core@7?deps=react@18,react-dom@18';

function App() {
  const [token, setToken] = useState('');
  const [serverPreset, setServerPreset] = useState('https://kf.kobotoolbox.org');
  const [serverCustom, setServerCustom] = useState('');
  const [assetUid, setAssetUid] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [logLines, setLogLines] = useState([]);
  const [audioStatus, setAudioStatus] = useState({});
  const logRef = useRef(null);

  function getServerUrl() {
    return serverPreset === 'custom'
      ? serverCustom.trim().replace(/\\/$/, '')
      : serverPreset;
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  async function loadQuestions() {
    setError('');
    const t = token.trim(), uid = assetUid.trim(), srv = getServerUrl();
    if (!t || !uid || !srv) { setError('Please fill in all connection fields.'); return; }
    setLoadingQuestions(true);
    try {
      const res = await fetch('/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ koboToken: t, serverUrl: srv, assetUid: uid }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      const data = await res.json();
      setRows(data);
      setSelected(new Set(data.map(r => r.name)));
      // audioStatus: { [name]: { [iso]: boolean } }
      const status = {};
      for (const r of data) {
        status[r.name] = {};
        for (const l of r.languages) status[r.name][l.iso] = l.hasAudio;
      }
      setAudioStatus(status);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function generateAudio() {
    setError('');
    const t = token.trim(), uid = assetUid.trim(), srv = getServerUrl();
    const selectedNames = [...selected];
    if (selectedNames.length === 0) { setError('Select at least one question.'); return; }
    setGenerating(true);
    setLogLines([]);
    try {
      const res = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ koboToken: t, serverUrl: srv, assetUid: uid, voice, questionNames: selectedNames }),
      });
      if (!res.ok) { setError(await res.text()); return; }
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
          setLogLines(prev => [...prev, evt]);
          if (evt.status === 'generated') {
            const iso = evt.iso ?? '';
            setAudioStatus(prev => ({
              ...prev,
              [evt.question]: { ...(prev[evt.question] ?? {}), [iso]: true },
            }));
          }
        }
      }
      setLogLines(prev => [...prev, { question: '', status: 'done', message: 'Done.' }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  const allSelected = rows !== null && rows.length > 0 && rows.every(r => selected.has(r.name));
  const someSelected = rows !== null && rows.some(r => selected.has(r.name)) && !allSelected;

  const tableRows = rows ? rows.map(row => {
    const isMulti = row.languages.length > 1;
    const rowAudioStatus = audioStatus[row.name] ?? {};

    const audioBadges = row.languages.map(lang =>
      h(Badge, {
        key: lang.iso,
        color: rowAudioStatus[lang.iso] ? 'green' : 'gray',
        variant: 'light',
      }, isMulti ? (lang.iso.toUpperCase() + (rowAudioStatus[lang.iso] ? ' ✓' : ' —')) : (rowAudioStatus[lang.iso] ? '✓ has audio' : 'none'))
    );

    const labelCell = isMulti
      ? h(Stack, { gap: 2 }, row.languages.map(lang =>
          h(Group, { key: lang.iso, gap: 4, wrap: 'nowrap' },
            h(Badge, { size: 'xs', variant: 'outline', color: 'gray', style: { flexShrink: 0 } }, lang.iso.toUpperCase()),
            h(Text, { size: 'sm' }, lang.label)
          )
        ))
      : h(Text, { size: 'sm' }, row.languages[0]?.label ?? '');

    const hintCell = isMulti
      ? h(Stack, { gap: 2 }, row.languages.map(lang =>
          h(Group, { key: lang.iso, gap: 4, wrap: 'nowrap' },
            h(Badge, { size: 'xs', variant: 'outline', color: 'gray', style: { flexShrink: 0 } }, lang.iso.toUpperCase()),
            h(Text, { size: 'sm', c: 'dimmed' }, lang.hint)
          )
        ))
      : h(Text, { size: 'sm', c: 'dimmed' }, row.languages[0]?.hint ?? '');

    return h(Table.Tr, { key: row.name },
      h(Table.Td, null,
        h(Checkbox, {
          checked: selected.has(row.name),
          onChange: e => setSelected(prev => {
            const next = new Set(prev);
            e.target.checked ? next.add(row.name) : next.delete(row.name);
            return next;
          }),
        })
      ),
      h(Table.Td, null, h(Code, null, row.name)),
      h(Table.Td, null, labelCell),
      h(Table.Td, null, hintCell),
      h(Table.Td, null, h(Group, { gap: 4, wrap: 'wrap' }, audioBadges))
    );
  }) : [];

  const logEntries = logLines.map((evt, i) => {
    if (evt.status === 'done') {
      return h(Text, { key: i, size: 'sm', ff: 'monospace', c: 'gray.4' }, evt.message || 'Done.');
    }
    const icon = evt.status === 'generated' ? '✅' : evt.status === 'error' ? '❌' : '⏭';
    const c = evt.status === 'generated' ? 'green.4' : evt.status === 'error' ? 'red.4' : 'yellow.4';
    const label = evt.iso ? evt.question + ' (' + evt.iso + ')' : evt.question;
    return h(Text, { key: i, size: 'sm', ff: 'monospace', c },
      icon + ' ' + label + (evt.message ? ': ' + evt.message : '')
    );
  });

  return h(Container, { size: 'md', py: 'xl' },
    h(Title, { order: 1, mb: 'xl' }, 'KoboTTS — Audio Generator'),

    h(Paper, { shadow: 'sm', p: 'lg', mb: 'lg', withBorder: true },
      h(Title, { order: 2, size: 'h4', mb: 'md', c: 'dimmed', tt: 'uppercase' }, 'Connection'),
      h(Stack, { gap: 'sm' },
        h(PasswordInput, {
          label: 'Kobo API Token',
          placeholder: 'Your Kobo API token',
          value: token,
          onChange: e => setToken(e.target.value),
          autoComplete: 'off',
        }),
        h(Select, {
          label: 'Server',
          value: serverPreset,
          onChange: v => setServerPreset(v),
          data: [
            { value: 'https://kf.kobotoolbox.org', label: 'Global' },
            { value: 'https://eu.kobotoolbox.org', label: 'EU' },
            { value: 'custom', label: 'Other…' },
          ],
        }),
        serverPreset === 'custom'
          ? h(TextInput, {
              placeholder: 'https://your-kobo-server.org',
              value: serverCustom,
              onChange: e => setServerCustom(e.target.value),
            })
          : null,
        h(TextInput, {
          label: 'Project UID',
          placeholder: 'aXXXXXXXXXXXXX',
          value: assetUid,
          onChange: e => setAssetUid(e.target.value),
        }),
        h(Select, {
          label: 'Voice',
          value: voice,
          onChange: v => setVoice(v),
          data: [
            { value: 'alloy', label: 'Alloy' },
            { value: 'ash', label: 'Ash' },
            { value: 'ballad', label: 'Ballad' },
            { value: 'cedar', label: 'Cedar' },
            { value: 'coral', label: 'Coral' },
            { value: 'echo', label: 'Echo' },
            { value: 'fable', label: 'Fable' },
            { value: 'marin', label: 'Marin' },
            { value: 'nova', label: 'Nova' },
            { value: 'onyx', label: 'Onyx' },
            { value: 'sage', label: 'Sage' },
            { value: 'shimmer', label: 'Shimmer' },
          ],
        }),
        h(Group, { mt: 'xs' },
          h(Button, { onClick: loadQuestions, loading: loadingQuestions }, 'Load Questions')
        ),
        error
          ? h(Alert, { color: 'red', title: 'Error', mt: 'xs' }, error)
          : null
      )
    ),

    rows !== null
      ? h(Paper, { shadow: 'sm', p: 'lg', withBorder: true },
          h(Title, { order: 2, size: 'h4', mb: 'md', c: 'dimmed', tt: 'uppercase' }, 'Questions'),
          h(Table.ScrollContainer, { minWidth: 600 },
            h(Table, { striped: true, highlightOnHover: true, withTableBorder: true, withColumnBorders: true },
              h(Table.Thead, null,
                h(Table.Tr, null,
                  h(Table.Th, null,
                    h(Checkbox, {
                      checked: allSelected,
                      indeterminate: someSelected,
                      onChange: e => setSelected(
                        e.target.checked ? new Set(rows.map(r => r.name)) : new Set()
                      ),
                    })
                  ),
                  h(Table.Th, null, 'Name'),
                  h(Table.Th, null, 'Label'),
                  h(Table.Th, null, 'Hint'),
                  h(Table.Th, null, 'Audio'),
                )
              ),
              h(Table.Tbody, null, tableRows)
            )
          ),
          h(Group, { mt: 'md' },
            h(Button, {
              color: 'green',
              onClick: generateAudio,
              loading: generating,
              disabled: selected.size === 0,
            }, 'Generate Audio')
          ),
          logLines.length > 0
            ? h('div', {
                ref: logRef,
                style: {
                  background: '#1e1e1e',
                  borderRadius: '6px',
                  padding: '1rem',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  marginTop: '1rem',
                },
              },
                h(Stack, { gap: 2 }, logEntries)
              )
            : null
        )
      : null
  );
}

createRoot(document.getElementById('root')).render(
  h(MantineProvider, null, h(App, null))
);
</script>
</body>
</html>`;
}
