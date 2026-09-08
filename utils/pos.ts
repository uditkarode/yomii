export const POS_GROUPS = ['noun', 'verb', 'adjective', 'adverb', 'particle', 'auxiliary'] as const;

export type PosGroup = (typeof POS_GROUPS)[number];

const GROUP_BY_POS: Record<string, PosGroup> = {
  名詞: 'noun',
  代名詞: 'noun',
  動詞: 'verb',
  形容詞: 'adjective',
  形状詞: 'adjective',
  副詞: 'adverb',
  助詞: 'particle',
  助動詞: 'auxiliary',
};

export function posGroup(pos: string): PosGroup | undefined {
  return GROUP_BY_POS[pos];
}

/** Whether a JMdict part-of-speech code belongs to the same broad group as a Sudachi tag. */
export function jmdictPosMatches(group: PosGroup, code: string): boolean {
  switch (group) {
    case 'noun':
      return code === 'n' || code.startsWith('n-') || code === 'pn' || code === 'vs' || code === 'num' || code === 'ctr';
    case 'verb':
      return code.startsWith('v') && code !== 'vs';
    case 'adjective':
      return code.startsWith('adj');
    case 'adverb':
      return code.startsWith('adv');
    case 'particle':
      return code === 'prt';
    case 'auxiliary':
      return code.startsWith('aux') || code === 'cop';
  }
}
