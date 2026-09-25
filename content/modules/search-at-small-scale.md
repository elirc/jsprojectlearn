# Search at small scale

"Add a search box" is one of the most common tickets in a CRUD app, and one of the easiest to get wrong in both directions: a `LIKE '%term%'` that scans the whole table, or a search cluster added for 20,000 rows. Interviewers ask how you would build search to see whether you know what your database can already do, and when a dedicated engine is worth its cost. This guide goes from the simplest correct option to the point where you should reach for something else.

## Decide what "search" means first

Different features need different tools. Ask:

| The user wants to... | Example | Right tool |
| --- | --- | --- |
| Find a record by an exact value | Order number, email | A normal B-tree index and `=` |
| Find by the start of a value | Customer names as you type "Sm" | B-tree index with `LIKE 'Sm%'` |
| Find text anywhere inside short values | "smith" inside "Goldsmith Ltd" | Trigram index (`pg_trgm`) |
| Search documents by words, ranked | Help articles, product descriptions | Full-text search |
| Tolerate typos, synonyms, facets at scale | E-commerce catalogue of millions | A search engine |

Most admin screens only need the first three. Say which one you are solving before choosing.

## Why `LIKE '%term%'` is slow

A B-tree index is sorted by the start of the value, so it can answer `LIKE 'smi%'` quickly but not `LIKE '%smi%'`: with a leading wildcard, the database must read every row. On 5,000 rows nobody notices; on 5 million, the search box takes seconds and holds the database busy. `ILIKE` (case-insensitive) has the same problem. On SQL Server, `LIKE N'%smi%'` scans in the same way.

## Substring search with trigrams (Postgres)

The `pg_trgm` extension indexes every three-character sequence in a value, which lets `ILIKE '%smi%'` use an index and also enables fuzzy matching:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customer_name_trgm ON customer USING gin (name gin_trgm_ops);

-- Substring, case-insensitive, now index-assisted
SELECT id, name FROM customer WHERE name ILIKE '%' || $1 || '%' LIMIT 20;

-- Typo-tolerant: "jonson" finds "Johnson"
SELECT id, name FROM customer
WHERE name % $1
ORDER BY similarity(name, $1) DESC
LIMIT 10;
```

Trigrams are ideal for names, codes and short titles, and for a "did you mean" feature. Terms shorter than three characters get little help from the index, so require a minimum length in the UI.

## Full-text search in the database

For longer text, full-text search splits content into normalised words (stemming "running" to "run"), drops stop words, and ranks matches. Postgres stores this as a `tsvector`; a generated column keeps it up to date automatically:

```sql
ALTER TABLE article ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,  '')), 'B')
  ) STORED;
CREATE INDEX article_search_idx ON article USING gin (search);

SELECT id, title, ts_rank(search, q) AS rank
FROM article, websearch_to_tsquery('english', $1) AS q
WHERE search @@ q
ORDER BY rank DESC
LIMIT 20;
```

`websearch_to_tsquery` accepts what users actually type, including `"exact phrase"`, `or` and `-excluded`, without syntax errors. The weights make title matches rank above body matches. From EF Core with Npgsql, map the column as `NpgsqlTsVector` and query with `a.Search.Matches(EF.Functions.WebSearchToTsQuery("english", term))`.

SQL Server has its own full-text indexes with `CONTAINS` and `FREETEXT`, which cover the same ground; they live in a separate full-text catalogue and update asynchronously, so a just-saved row may not be searchable for a moment.

## Filters, facets and pagination

Search pages usually combine a text query with filters ("in stock", "category = shoes") and counts per filter ("Shoes (42)"). In the database these are ordinary `WHERE` clauses plus a `GROUP BY` for the counts. Keep the filter columns indexed, and paginate the results; for search, offset pagination is usually acceptable because nobody reads page 40 of search results. Put the query, filters and page in the URL so results are shareable and the back button works. [Pagination and filtering](api-pagination-filtering.md) covers the API shape.

## The frontend half

A search box that fires a request on every keystroke, and renders whichever response arrives last, has two bugs:

```ts
let controller: AbortController | undefined;
async function search(term: string) {
  controller?.abort();                       // cancel the previous request
  controller = new AbortController();
  const res = await fetch(`/api/articles?q=${encodeURIComponent(term)}`, { signal: controller.signal });
  return res.json();
}
```

- **Debounce** input by about 250 ms so you search when the user pauses, not on every key. See [the debounced value project](../../react/24-usedebouncedvalue/).
- **Cancel or ignore stale responses**, otherwise a slow response for "sm" can overwrite the fast one for "smith". [The fetch race project](../../react/19-fetch-race/) shows the bug and the fix; the aborted `fetch` rejects with an `AbortError` you should ignore.

[Search as you type](../../54-search-as-you-type/) and [the searchable table](../../react/45-searchable-table/) are good places to practise both halves.

## When to add a search engine

Meilisearch, Typesense, OpenSearch or Elasticsearch, or a hosted service such as Algolia, earn their place when you need several of these at once:

- typo tolerance and synonyms tuned for relevance across a large catalogue;
- fast faceted counts over millions of documents;
- search across several entity types in one ranked list;
- search traffic heavy enough that you want it off the primary database.

The cost is a second system that must be kept in sync, secured and operated. The database remains the source of truth; the engine holds a copy.

## Keeping a search index in sync

If you add an engine, you have the dual-write problem: saving the product and updating the index are two systems, and one can fail. Do not update the index inside the request after the database commit and hope. Instead:

1. Write an event (`ProductUpdated`) to an outbox table in the same transaction as the change.
2. A worker reads the outbox and upserts the document into the index, retrying on failure. Upserts by id are naturally idempotent.
3. A periodic full reindex from the database repairs any drift, and is also how you change the index's schema.

The index will lag by a second or two, which is acceptable for search. [Queues and event-driven design](event-driven-design.md) and [background jobs](background-jobs-and-queues.md) cover the outbox and the worker. In a multi-tenant app, include the tenant id in every document and every query filter ([multi-tenant SaaS](multi-tenant-saas.md)).

## What you should be able to answer

- Why is `WHERE name LIKE '%smith%'` slow on a large table, and what would you do about it in Postgres?
- What is the difference between trigram search and full-text search, and when would you use each?
- How do you make title matches rank higher than body matches?
- A search box shows results for "sm" after the user has typed "smith". What causes this, and how do you fix it?
- At what point would you add Meilisearch or OpenSearch, and what does it cost you?
- How do you keep a search index in sync with the database without losing updates?
