import type { NodeData, NodeKind } from '@wa/core/flow'

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
      return { kind, templateName: '', language: 'id', bodyParams: [] }
    case 'waitReply':
      return { kind, saveAs: 'jawaban', expect: 'any', maxRetries: 2, timeoutMinutes: 60 }
    case 'condition':
      return { kind, variable: 'jawaban', operator: 'eq', value: '', caseSensitive: false }
    case 'setVariable':
      return { kind, name: 'variabel', value: '' }
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
  { group: 'Logika', kinds: ['condition', 'setVariable'] },
  { group: 'Tindakan', kinds: ['assign', 'tag', 'handover', 'end'] },
]
