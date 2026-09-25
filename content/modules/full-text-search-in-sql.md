# Full-text search in SQL databases

Almost every CRUD app grows a search box, and the first version is always
`WHERE name LIKE '%' || $1 || '%'`. It works on 500 rows and falls over at a
million, and it never finds "running" when the user types "run". Interviewers
ask "how would you implement search?" to see whether you know the database
already has a proper tool before you reach for Elasticsearch. This guide covers
the built-in options in Postgres 17, SQL Server 2022 and SQLite.

## Why LIKE is not search

`LIKE '%term%'` has three problems:

1. **It cannot use a B-tree index.** A leading wildcard means every row is read
   and every string scanned.
2. **It matches characters, not words.** 'run' matches 'brunch' but not 'ran';
   'running shoes' does not match 'shoes for running'.
3. **It has no relevance.** Results come back in arbitrary order, with a title
   match no better than a passing mention in a footnote.

Also remember that `%` and `_` in the user's input are wildcards unless you
escape them.

## The concepts every engine shares

Full-text search (FTS) processes text into **tokens** at write time and
queries at read time:

| Step | Example |
| --- | --- |
| Tokenise | 'Runners run fast!' becomes runners, run, fast |
| Normalise case | Runners becomes runners |
| Stem to a root (lexeme) | runners and running become run |
| Drop stop words | 'the', 'a', 'for' are ignored |
| Index | An inverted index maps each lexeme to the rows containing it |

A query goes through the same pipeline, so 'running' finds 'runs'. Ranking
scores each match by how often and where terms appear. Stemming is
language-specific, so the configuration you choose ('english', 'german', or a
language-neutral 'simple') changes results.

## Postgres: tsvector, tsquery and GIN

Postgres builds FTS from two types: `tsvector` (the processed document) and
`tsquery` (the processed query), matched with `@@`.

```sql
ALTER TABLE articles ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,  '')), 'B')
  ) STORED;

CREATE INDEX ix_articles_search ON articles USING gin (search);
```

A stored generated column keeps the vector in sync on every write, and the GIN
index makes matching fast. Weights let a title hit outrank a body hit. Query
it:

```sql
SELECT id, title,
       ts_rank(search, q) AS rank,
       ts_headline('english', body, q) AS snippet
FROM articles, websearch_to_tsquery('english', $1) AS q
WHERE search @@ q
ORDER BY rank DESC
LIMIT 20;
```

Which query-parsing function you use matters, because user input is messy:

| Function | Accepts | Use for |
| --- | --- | --- |
| `to_tsquery` | Operator syntax: `run & !walk` | Queries you build in code; errors on stray symbols |
| `plainto_tsquery` | Plain words, ANDed | Simple boxes |
| `websearch_to_tsquery` | Quotes, `or`, `-exclude` | User-facing search; never errors |

Prefix search for as-you-type needs `to_tsquery('english', 'wat:*')`, built
from sanitised input. Compute `ts_headline` only on the rows you return; it is
expensive.

If you index an expression rather than a stored column, the query must use the
identical expression, including the configuration name, or the index is
ignored.

## Postgres: trigrams for fuzzy and substring matching

FTS matches words. For typos, partial codes and names, the `pg_trgm` extension
splits text into three-letter chunks and makes `ILIKE '%smith%'` indexable:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_customers_name_trgm ON customers USING gin (name gin_trgm_ops);

SELECT name FROM customers WHERE name ILIKE '%smit%';        -- uses the index
SELECT name FROM customers WHERE name % 'jonh smith'         -- similarity
ORDER BY similarity(name, 'jonh smith') DESC LIMIT 10;
```

Trigrams suit short fields (names, SKUs, email addresses); FTS suits prose. Many
apps use both.

## SQL Server: full-text indexes

SQL Server's FTS is a separate feature. The table needs a unique key index, and
you create a full-text catalogue and index:

```sql
CREATE FULLTEXT CATALOG ftc AS DEFAULT;
CREATE FULLTEXT INDEX ON dbo.Articles (Title, Body LANGUAGE 1033)
  KEY INDEX PK_Articles;
```

Then query with predicates:

| Predicate | Behaviour |
| --- | --- |
| `CONTAINS(Body, '"water*" AND boots')` | Precise: words, phrases, prefixes, `NEAR` |
| `FREETEXT(Body, @q)` | Loose: stems and thesaurus for natural-language input |
| `CONTAINSTABLE` / `FREETEXTTABLE` | Same, returning a `RANK` column to join and sort by |

Two operational differences from Postgres: the index is populated
asynchronously by default (change tracking AUTO), so a just-inserted row may not
be searchable for a moment; and `CONTAINS` syntax errors on raw user input, so
build the search condition carefully or use `FREETEXT`. FTS is available in
Azure SQL Database but must be installed as a feature on some on-premises
editions.

## SQLite: FTS5

SQLite ships FTS5 as a virtual table, which makes it good for local practice and
small apps. Node's built-in `node:sqlite` includes it:

```sql
CREATE VIRTUAL TABLE docs USING fts5(title, body, tokenize = 'porter');
INSERT INTO docs VALUES ('Running shoes', 'Lightweight shoes for runners');

SELECT title FROM docs WHERE docs MATCH 'run' ORDER BY bm25(docs);
SELECT title FROM docs WHERE docs MATCH 'water*';
SELECT snippet(docs, 1, '[', ']', '...', 8) FROM docs WHERE docs MATCH 'grip';
```

The `porter` tokeniser stems English, `bm25()` ranks (lower is better), and
`snippet()` highlights matches. An FTS table is usually kept in sync with the
real table by triggers or by using the external-content option.

## Search as you type

A live search box multiplies query volume, so combine database and client
techniques:

- Debounce input and cancel stale requests on the client (see
  [../../54-search-as-you-type/](../../54-search-as-you-type/)).
- Require two or three characters before searching.
- Use prefix matching on the last word only: 'waterproof bo' becomes
  `waterproof & bo:*`.
- Return a small `LIMIT` with a keyset cursor for "more results".
- Normalise input: trim, collapse spaces, and never interpolate it into SQL.
  Pass it as a parameter to `websearch_to_tsquery` or `FREETEXT`.

## When to use a dedicated search engine

Built-in FTS covers most CRUD needs: product catalogues, help articles,
customer lookup. Move to OpenSearch, Elasticsearch, Meilisearch or Typesense
when you need several of these:

- Typo tolerance and synonyms tuned per field.
- Faceted navigation with counts across many attributes at once.
- Relevance tuning, boosting and analytics as a product feature.
- Search across data from several databases or services.
- Query volumes that would compete with transactional load.

The cost is real: a second system to run, and an indexing pipeline that is
eventually consistent with your database (often fed by an outbox or change data
capture). Start in the database; move when a requirement forces it.

## What you should be able to answer

- Why is `LIKE '%term%'` a poor search implementation, beyond performance?
- What do tokenising, stemming and stop words do, and why does the language configuration matter?
- How do you set up indexed full-text search on a Postgres table, and how do you rank and highlight results?
- When would you use `pg_trgm` instead of `tsvector`?
- What does SQL Server need before `CONTAINS` works, and how does `FREETEXT` differ?
- When is it worth moving search out of the database into a dedicated engine?
