import { ROUTE_CLARIFY_BODY, ROUTE_QUESTION_VARIABLE, type NodeData, type NodeKind } from '@wa/core/flow'

/** Starting data for a freshly dropped node, valid enough not to error at once. */
export function defaultData(kind: NodeKind): NodeData {
  switch (kind) {
    case 'trigger':
      return { kind, match: 'keyword', values: ['halo'], caseSensitive: false }
    case 'sendText':
      return { kind, body: '' }
    case 'sendMedia':
      return { kind, media: 'image', source: 'link', value: '', caption: '' }
    case 'sendButtons':
      return {
        kind,
        body: '',
        buttons: [
          { id: 'btn_1', title: 'Ya' },
          { id: 'btn_2', title: 'Tidak' },
        ],
      }
    case 'sendList':
      return {
        kind,
        body: '',
        buttonText: 'Lihat pilihan',
        sections: [{ title: 'Pilihan', rows: [{ id: 'row_1', title: 'Pilihan 1' }] }],
      }
    case 'sendTemplate':
      return { kind, templateName: '', language: 'id', bodyParams: [], headerParam: '' }
    case 'waitReply':
      return { kind, saveAs: 'jawaban', expect: 'any', maxRetries: 2, timeoutMinutes: 60 }
    case 'condition':
      return { kind, variable: 'jawaban', operator: 'eq', value: '', caseSensitive: false }
    case 'setVariable':
      return { kind, name: 'variabel', value: '' }
    case 'httpRequest':
      return { kind, method: 'GET', url: '', headers: '', body: '', saveAs: 'hasil', timeoutSeconds: 15 }
    case 'askAi':
      return { kind, endpointId: '', question: 'pertanyaan', sendAnswer: true, endButton: '', saveAs: 'jawaban_ai' }
    case 'aiRoute':
      return {
        kind,
        endpointId: '',
        question: ROUTE_QUESTION_VARIABLE,
        minScore: 0.7,
        clarify: true,
        clarifyMinScore: 0.5,
        clarifyBody: ROUTE_CLARIFY_BODY,
        saveAs: 'arah_ai',
      }
    case 'delay':
      return { kind, seconds: 60 }
    case 'assign':
      return { kind, userId: null }
    case 'tag':
      return { kind, action: 'add', tags: ['tertarik'] }
    case 'handover':
      return { kind }
    case 'end':
      return { kind }
  }
}

export const PALETTE: { group: string; kinds: NodeKind[] }[] = [
  { group: 'Mulai', kinds: ['trigger'] },
  { group: 'Kirim', kinds: ['sendText', 'sendMedia', 'sendButtons', 'sendList', 'sendTemplate'] },
  { group: 'Tunggu', kinds: ['waitReply', 'delay'] },
  { group: 'AI', kinds: ['askAi', 'aiRoute'] },
  { group: 'Logika', kinds: ['condition', 'setVariable'] },
  { group: 'Tindakan', kinds: ['assign', 'tag', 'handover', 'end'] },
  { group: 'Lanjutan', kinds: ['httpRequest'] },
]
