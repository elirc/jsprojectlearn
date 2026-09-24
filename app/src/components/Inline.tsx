import { inlineCode } from '../lib/format.ts';

/**
 * Question text: plain text with the odd `code span`. inlineCode escapes
 * everything first, so the HTML it returns is safe to inject.
 */
export default function Inline({
  text,
  as: Tag = 'span',
  className,
  id,
}: {
  text: string;
  as?: 'span' | 'p' | 'strong' | 'h2';
  className?: string;
  id?: string;
}) {
  return <Tag id={id} className={className} dangerouslySetInnerHTML={{ __html: inlineCode(text) }} />;
}
