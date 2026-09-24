import { createContext, use } from 'react';
import type { ContentIndex } from './types.ts';

/**
 * The generated content, loaded once by ContentGate and provided to the whole
 * tree. Every route needs it; threading it through props meant three levels
 * of drilling on the path page alone.
 */
export const ContentContext = createContext<ContentIndex | null>(null);

export function useContent(): ContentIndex {
  const content = use(ContentContext);
  if (!content) throw new Error('useContent() outside <ContentContext> — render inside ContentGate');
  return content;
}
