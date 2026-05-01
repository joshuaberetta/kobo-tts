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
  Badge, Text, Alert, Code, Tabs, Textarea
} from 'https://esm.sh/@mantine/core@7?deps=react@18,react-dom@18';

const COMMON_LANGUAGES = [
  { value: 'Amharic (am)', label: 'Amharic' },
  { value: 'Arabic (ar)', label: 'Arabic' },
  { value: 'Bengali (bn)', label: 'Bengali' },
  { value: 'English (en)', label: 'English' },
  { value: 'French (fr)', label: 'French' },
  { value: 'Hausa (ha)', label: 'Hausa' },
  { value: 'Hindi (hi)', label: 'Hindi' },
  { value: 'Indonesian (id)', label: 'Indonesian' },
  { value: 'Kinyarwanda (rw)', label: 'Kinyarwanda' },
  { value: 'Nepali (ne)', label: 'Nepali' },
  { value: 'Pashto (ps)', label: 'Pashto' },
  { value: 'Portuguese (pt)', label: 'Portuguese' },
  { value: 'Somali (so)', label: 'Somali' },
  { value: 'Spanish (es)', label: 'Spanish' },
  { value: 'Swahili (sw)', label: 'Swahili' },
  { value: 'Tigrinya (ti)', label: 'Tigrinya' },
  { value: 'Turkish (tr)', label: 'Turkish' },
  { value: 'Urdu (ur)', label: 'Urdu' },
  { value: 'other', label: 'Other…' },
];

function extractIso(langLabel) {
  if (!langLabel) return '';
  const m = langLabel.match(/\\(([a-z]{2,3})\\)$/i);
  return m ? m[1] : '';
}

function LogPanel({ entries, logRef }) {
  if (!entries.length) return null;
  return h('div', {
    ref: logRef,
    style: {
      background: '#1e1e1e',
      borderRadius: '6px',
      padding: '1rem',
      maxHeight: '260px',
      overflowY: 'auto',
      marginTop: '0.75rem',
    },
  }, h(Stack, { gap: 2 }, entries));
}

function App() {
  const [token, setToken] = useState('');
  const [serverPreset, setServerPreset] = useState('https://kf.kobotoolbox.org');
  const [serverCustom, setServerCustom] = useState('');
  const [assetUid, setAssetUid] = useState('');

  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [audioStatus, setAudioStatus] = useState({});

  const [activeTab, setActiveTab] = useState('audio');
  const [error, setError] = useState('');
  const [redeploy, setRedeploy] = useState(true);

  const [voice, setVoice] = useState('alloy');
  const [generating, setGenerating] = useState(false);
  const [audioLog, setAudioLog] = useState([]);
  const audioLogRef = useRef(null);

  const [targetLang, setTargetLang] = useState('Spanish (es)');
  const [targetCustomName, setTargetCustomName] = useState('');
  const [targetCustomIso, setTargetCustomIso] = useState('');
  const [instructions, setInstructions] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateLog, setTranslateLog] = useState([]);
  const [translateDone, setTranslateDone] = useState(false);
  const translateLogRef = useRef(null);

  useEffect(() => {
    if (audioLogRef.current) audioLogRef.current.scrollTop = audioLogRef.current.scrollHeight;
  }, [audioLog]);

  useEffect(() => {
    if (translateLogRef.current) translateLogRef.current.scrollTop = translateLogRef.current.scrollHeight;
  }, [translateLog]);

  function getServerUrl() {
    return serverPreset === 'custom'
      ? serverCustom.trim().replace(/\\/$/, '')
      : serverPreset;
  }

  function getTranslateTarget() {
    if (targetLang === 'other') {
      const iso = targetCustomIso.trim();
      const name = targetCustomName.trim() || iso;
      return { targetIso: iso, targetLangLabel: name + ' (' + iso + ')' };
    }
    return { targetIso: extractIso(targetLang), targetLangLabel: targetLang };
  }

  async function streamSSE(res, onEvent) {
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
        onEvent(JSON.parse(line.slice(6)));
      }
    }
  }

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
      setSelected(new Set(data.filter(r => !r.isGroup).map(r => r.name)));
      const status = {};
      for (const r of data) {
        if (r.isGroup) continue;
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
    if (selected.size === 0) { setError('Select at least one question.'); return; }
    setGenerating(true);
    setAudioLog([]);
    try {
      const res = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ koboToken: t, serverUrl: srv, assetUid: uid, voice, questionNames: [...selected], redeploy }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      await streamSSE(res, evt => {
        setAudioLog(prev => [...prev, evt]);
        if (evt.status === 'generated') {
          const iso = evt.iso ?? '';
          setAudioStatus(prev => ({
            ...prev,
            [evt.question]: { ...(prev[evt.question] ?? {}), [iso]: true },
          }));
        }
      });
      setAudioLog(prev => [...prev, { question: '', status: 'done', message: 'Done.' }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function translateForm() {
    setError('');
    const t = token.trim(), uid = assetUid.trim(), srv = getServerUrl();
    const { targetIso, targetLangLabel } = getTranslateTarget();
    if (!t || !uid || !srv) { setError('Please fill in all connection fields.'); return; }
    if (!targetIso) { setError('Please select or enter a target language.'); return; }
    if (selected.size === 0) { setError('Select at least one question.'); return; }
    setTranslating(true);
    setTranslateLog([]);
    setTranslateDone(false);
    try {
      const res = await fetch('/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          koboToken: t, serverUrl: srv, assetUid: uid,
          targetIso, targetLangLabel, instructions,
          questionNames: [...selected],
          redeploy,
        }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      await streamSSE(res, evt => setTranslateLog(prev => [...prev, evt]));
      setTranslateLog(prev => [...prev, { item: '', status: 'done', message: 'Done.' }]);
      setTranslateDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setTranslating(false);
    }
  }

  const selectableRows = rows ? rows.filter(r => !r.isGroup) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selected.has(r.name));
  const someSelected = selectableRows.some(r => selected.has(r.name)) && !allSelected;

  const tableRows = rows ? rows.map(row => {
    const isMulti = row.languages.length > 1;

    if (row.isGroup) {
      const groupLabel = isMulti
        ? h(Stack, { gap: 2 }, row.languages.map(lang =>
            h(Group, { key: lang.iso, gap: 4, wrap: 'nowrap' },
              h(Badge, { size: 'xs', variant: 'outline', color: 'gray', style: { flexShrink: 0 } }, lang.iso.toUpperCase()),
              h(Text, { size: 'sm', fw: 500 }, lang.label)
            )
          ))
        : h(Text, { size: 'sm', fw: 500 }, row.languages[0]?.label ?? '');

      return [
        h(Table.Tr, { key: row.name, style: { background: '#f0f4ff' } },
          h(Table.Td, null),
          h(Table.Td, null,
            h(Group, { gap: 6, wrap: 'nowrap' },
              h(Badge, { size: 'xs', color: 'indigo', variant: 'filled' },
                row.type === 'begin_repeat' ? 'repeat' : 'group'
              ),
              h(Code, { style: { fontSize: '0.75rem' } }, row.name)
            )
          ),
          h(Table.Td, { colSpan: 3 }, groupLabel)
        ),
        null,
      ];
    }

    const rowAudioStatus = audioStatus[row.name] ?? {};

    const audioBadges = row.languages.map(lang =>
      h(Badge, {
        key: lang.iso,
        color: rowAudioStatus[lang.iso] ? 'green' : 'gray',
        variant: 'light',
      }, isMulti
        ? lang.iso.toUpperCase() + (rowAudioStatus[lang.iso] ? ' ✓' : ' —')
        : rowAudioStatus[lang.iso] ? '✓ has audio' : 'none'
      )
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

    const hasChoices = row.choices && row.choices.length > 0;
    const isExpanded = expanded.has(row.name);

    const choiceSubRow = hasChoices && isExpanded
      ? h(Table.Tr, { key: row.name + '__choices', style: { background: '#f8fafc' } },
          h(Table.Td, { colSpan: 5, style: { paddingLeft: '3rem', paddingTop: '0.5rem', paddingBottom: '0.75rem' } },
            h(Text, { size: 'xs', fw: 500, c: 'dimmed', mb: 4, tt: 'uppercase' }, 'Choices'),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              row.choices.map(choice =>
                h(Group, { key: choice.name, gap: 8, wrap: 'nowrap', align: 'flex-start' },
                  h(Code, { style: { flexShrink: 0, fontSize: '0.75rem' } }, choice.name),
                  isMulti
                    ? h(Stack, { gap: 1 }, choice.labels.map(l =>
                        h(Group, { key: l.iso, gap: 4, wrap: 'nowrap' },
                          h(Badge, { size: 'xs', variant: 'outline', color: 'gray', style: { flexShrink: 0 } }, l.iso.toUpperCase()),
                          h(Text, { size: 'sm' }, l.label)
                        )
                      ))
                    : h(Text, { size: 'sm' }, choice.labels[0]?.label ?? '')
                )
              )
            )
          )
        )
      : null;

    return [
      h(Table.Tr, { key: row.name },
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
        h(Table.Td, null,
          h(Group, { gap: 6, wrap: 'nowrap' },
            h(Code, null, row.name),
            hasChoices
              ? h(Button, {
                  size: 'compact-xs',
                  variant: 'subtle',
                  color: 'gray',
                  onClick: () => setExpanded(prev => {
                    const next = new Set(prev);
                    next.has(row.name) ? next.delete(row.name) : next.add(row.name);
                    return next;
                  }),
                  title: isExpanded ? 'Hide choices' : 'Show choices',
                }, isExpanded ? '▲' : '▼')
              : null
          )
        ),
        h(Table.Td, null, labelCell),
        h(Table.Td, null, hintCell),
        h(Table.Td, null, h(Group, { gap: 4, wrap: 'wrap' }, audioBadges))
      ),
      choiceSubRow,
    ];
  }).flat().filter(Boolean) : [];

  const audioLogEntries = audioLog.map((evt, i) => {
    if (evt.status === 'done') return h(Text, { key: i, size: 'sm', ff: 'monospace', c: 'gray.4' }, evt.message || 'Done.');
    const icon = evt.status === 'generated' ? '✅' : evt.status === 'error' ? '❌' : '⏭';
    const c = evt.status === 'generated' ? 'green.4' : evt.status === 'error' ? 'red.4' : 'yellow.4';
    const lbl = evt.iso ? evt.question + ' (' + evt.iso + ')' : evt.question;
    return h(Text, { key: i, size: 'sm', ff: 'monospace', c }, icon + ' ' + lbl + (evt.message ? ': ' + evt.message : ''));
  });

  const translateLogEntries = translateLog.map((evt, i) => {
    if (evt.status === 'done') return h(Text, { key: i, size: 'sm', ff: 'monospace', c: 'gray.4' }, evt.message || 'Done.');
    const icon = evt.status === 'translated' ? '✅' : evt.status === 'error' ? '❌' : '⏭';
    const c = evt.status === 'translated' ? 'green.4' : evt.status === 'error' ? 'red.4' : 'yellow.4';
    return h(Text, { key: i, size: 'sm', ff: 'monospace', c }, icon + ' ' + evt.item + (evt.message ? ': ' + evt.message : ''));
  });

  const { targetLangLabel } = getTranslateTarget();

  return h(Container, { size: 'md', py: 'xl' },
    h(Title, { order: 1, mb: 'xl' }, 'KoboTTS'),

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
        h(Group, { mt: 'xs' },
          h(Button, { onClick: loadQuestions, loading: loadingQuestions }, 'Load Questions')
        ),
        error ? h(Alert, { color: 'red', title: 'Error', mt: 'xs' }, error) : null
      )
    ),

    rows !== null
      ? h(Paper, { shadow: 'sm', p: 'lg', withBorder: true },

          h(Table.ScrollContainer, { minWidth: 600, mb: 'lg' },
            h(Table, { striped: true, highlightOnHover: true, withTableBorder: true, withColumnBorders: true },
              h(Table.Thead, null,
                h(Table.Tr, null,
                  h(Table.Th, null,
                    h(Checkbox, {
                      checked: allSelected,
                      indeterminate: someSelected,
                      onChange: e => setSelected(
                        e.target.checked ? new Set(selectableRows.map(r => r.name)) : new Set()
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

          h(Checkbox, {
            label: 'Redeploy form after changes',
            checked: redeploy,
            onChange: e => setRedeploy(e.target.checked),
            mb: 'md',
          }),

          h(Tabs, { value: activeTab, onChange: v => { setActiveTab(v); setError(''); } },
            h(Tabs.List, { mb: 'md' },
              h(Tabs.Tab, { value: 'audio' }, 'Generate Audio'),
              h(Tabs.Tab, { value: 'translate' }, 'Translate Form'),
            ),

            h(Tabs.Panel, { value: 'audio' },
              h(Stack, { gap: 'sm' },
                h(Select, {
                  label: 'Voice',
                  value: voice,
                  onChange: v => setVoice(v),
                  style: { maxWidth: 220 },
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
                h(Button, {
                  color: 'green',
                  onClick: generateAudio,
                  loading: generating,
                  disabled: selected.size === 0,
                  style: { alignSelf: 'flex-start' },
                }, 'Generate Audio'),
                h(LogPanel, { entries: audioLogEntries, logRef: audioLogRef })
              )
            ),

            h(Tabs.Panel, { value: 'translate' },
              h(Stack, { gap: 'sm' },
                h(Select, {
                  label: 'Target language',
                  value: targetLang,
                  onChange: v => { setTargetLang(v); setTranslateDone(false); },
                  searchable: true,
                  style: { maxWidth: 280 },
                  data: COMMON_LANGUAGES,
                }),
                targetLang === 'other'
                  ? h(Group, { grow: true },
                      h(TextInput, {
                        label: 'Language name',
                        placeholder: 'Yoruba',
                        value: targetCustomName,
                        onChange: e => setTargetCustomName(e.target.value),
                      }),
                      h(TextInput, {
                        label: 'ISO code',
                        placeholder: 'yo',
                        value: targetCustomIso,
                        onChange: e => setTargetCustomIso(e.target.value),
                        style: { maxWidth: 110 },
                      })
                    )
                  : null,
                h(Textarea, {
                  label: 'Additional instructions',
                  description: 'Optional guidance for the translator, e.g. "Use simple language. Use the tú form."',
                  placeholder: 'Use simple language suitable for low-literacy respondents.',
                  value: instructions,
                  onChange: e => setInstructions(e.target.value),
                  minRows: 2,
                  autosize: true,
                }),
                h(Button, {
                  color: 'blue',
                  onClick: translateForm,
                  loading: translating,
                  disabled: selected.size === 0,
                  style: { alignSelf: 'flex-start' },
                }, 'Translate Form'),
                h(LogPanel, { entries: translateLogEntries, logRef: translateLogRef }),
                translateDone
                  ? h(Alert, { color: 'teal', title: 'Translation complete', mt: 'xs' },
                      h(Stack, { gap: 'xs' },
                        h(Text, { size: 'sm' }, targetLangLabel + ' translation applied to the form.'),
                        h(Button, {
                          size: 'xs',
                          variant: 'light',
                          color: 'teal',
                          onClick: () => setActiveTab('audio'),
                        }, 'Generate audio for ' + targetLangLabel)
                      )
                    )
                  : null
              )
            )
          )
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
