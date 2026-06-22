export interface WikiTopic {
  id: string;
  display: string;
}
export interface WikiGroup {
  label: string;
  topics: WikiTopic[];
}

// wiki(개념 정리) 사이드바 주제 트리 — blog 카테고리와 별개
export const wikiGroups: WikiGroup[] = [
  {
    label: 'language',
    topics: [{ id: 'java', display: 'Java' }],
  },
  {
    label: 'backend',
    topics: [
      { id: 'spring', display: 'Spring · JPA' },
      { id: 'database', display: 'Database' },
      { id: 'redis', display: 'Redis' },
    ],
  },
  {
    label: 'cs',
    topics: [
      { id: 'network', display: 'Network · HTTP' },
      { id: 'os', display: 'OS · 동시성' },
    ],
  },
  {
    label: 'ai',
    topics: [{ id: 'ai', display: 'AI · LLM' }],
  },
];

export const wikiTopics: WikiTopic[] = wikiGroups.flatMap((g) => g.topics);
export const wikiTopicMap: Record<string, WikiTopic> = Object.fromEntries(
  wikiTopics.map((t) => [t.id, t]),
);
