# Streams and backpressure in Node

Exports, imports, uploads, proxies and log processing all move more data than you
want in memory at once. Streams are how Node does that, and backpressure is the
part that makes them safe. Interviewers ask "how would you export a million rows?"
or "what is backpressure?" to see whether you have done this for real. This guide
goes past the overview in [the Node runtime guide](node-runtime-and-npm.md).

## Four kinds of stream

| Kind | You | Examples |
|---|---|---|
| Readable | Read from it | `fs.createReadStream`, an HTTP request body, a DB cursor |
| Writable | Write to it | `fs.createWriteStream`, an HTTP response, a socket |
| Duplex | Both, independently | A TCP socket |
| Transform | Write in, read out a changed version | `zlib.createGzip()`, a CSV parser, a hash |

Byte streams carry Buffers or strings. **Object mode** streams carry any JavaScript
value, such as parsed rows. The two do not mix: writing a plain object into an HTTP
response fails with `ERR_INVALID_ARG_TYPE`, so an object-mode pipeline needs a
serialising stage before it reaches a byte sink.

## Backpressure in one paragraph

A producer that is faster than its consumer must slow down, or the difference
piles up in memory. Every Writable has a buffer and a `highWaterMark`. When a
`write()` pushes the buffer past the mark, `write()` returns `false`: "accepted, but
stop now". The producer should wait for the `drain` event. The mark is a threshold,
not a cap: ignoring `false` does not lose data, it keeps buffering until the process
runs out of memory.

```js
import { Writable } from 'node:stream';

const slow = new Writable({
  highWaterMark: 4,
  write(chunk, _enc, cb) { setTimeout(cb, 10); },
});
console.log(slow.write('12345'), slow.write('678'), slow.writableLength);
// false false 8  -- both writes were buffered anyway
```

| Default `highWaterMark` in Node 24 | Value |
|---|---|
| Generic byte stream | 16 KiB |
| `fs.createReadStream` | 64 KiB |
| Object mode | 16 objects |

In object mode the mark counts items, so sixteen 5 MB rows is 80 MB. Size it for your
data.

## pipeline: the default you should reach for

`.pipe()` wires up backpressure but not errors: if the source fails, the destination
is left open, and an `error` event with no listener crashes the process.
`pipeline` from `node:stream/promises` handles backpressure, propagates the first
error, destroys every stage and returns a promise:

```js
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

try {
  await pipeline(createReadStream('orders.csv'), createGzip(), createWriteStream('orders.csv.gz'));
} catch (err) {
  // one place for ENOENT, disk full, corrupt input...
}
```

A stage can be an **async generator function**. It receives the previous stage as an
async iterable and whatever it yields becomes the next chunk, with backpressure
intact. This is usually clearer than a Transform class:

```js
await pipeline(
  createReadStream('orders.ndjson'),
  split('\n'),                           // any line-splitting transform
  async function* (lines) {
    for await (const line of lines) {
      if (line) yield JSON.stringify(normalise(JSON.parse(line))) + '\n';
    }
  },
  createWriteStream('clean.ndjson'),
);
```

## Consuming with for await

Readables are async iterable. The loop pulls the next chunk only after the body
finishes, so an awaited database insert paces the read, and a stream error becomes
an exception in the surrounding `try`:

```js
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const lines = createInterface({ input: createReadStream('big.log'), crlfDelay: Infinity });
let batch = [];
for await (const line of lines) {
  batch.push(parse(line));
  if (batch.length === 500) {
    await repo.insertMany(batch);   // reading waits while this runs
    batch = [];
  }
}
if (batch.length) await repo.insertMany(batch);
```

`readline` handles lines split across chunks, which a naive `chunk.split('\n')`
gets wrong. Batching turns 5 million inserts into 10,000, which is usually the
bigger performance win.

## Exporting a large query as a response

```js
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

app.get('/orders/export', async (req, res) => {
  res.type('application/x-ndjson');
  res.attachment('orders.ndjson');
  const rows = ordersRepo.streamAll();   // async generator backed by a DB cursor
  await pipeline(
    Readable.from(rows),
    async function* (src) { for await (const r of src) yield JSON.stringify(toOrderDto(r)) + '\n'; },
    res,
  );
});
```

Memory stays flat because `res` stops pulling whenever the client's connection is
full. If the client disconnects, `pipeline` destroys the stages and rejects, and the
generator's `finally` can close the cursor. Compare that with
`res.json(await repo.findAll())`, which builds every row and the whole JSON string
before sending a byte.

Two practical notes. Headers are sent with the first chunk, so an error halfway
through cannot become a 500; the best you can do is end the stream and log it (the
error handler's `res.headersSent` check exists for this). And a cursor needs the
database's streaming support: `pg-query-stream` or a `DECLARE CURSOR` with node-postgres,
or keyset-paginated batches with an ORM.

## Writing a Transform correctly

```js
import { Transform } from 'node:stream';

const toUpper = new Transform({
  transform(chunk, _enc, cb) {
    try {
      cb(null, chunk.toString().toUpperCase());
    } catch (err) {
      cb(err);
    }
  },
});
```

The callback is the contract. Forget to call it and the stream silently stops after
the first chunk. Call it with an error and the pipeline fails cleanly. `flush(cb)`
runs at the end, which is where a CSV parser emits its last partial row.

## Text, bytes and chunk boundaries

Chunks split wherever the OS delivered data, including in the middle of a multi-byte
UTF-8 character. `body += chunk` decodes each half separately and produces `�`.
Collect Buffers and `Buffer.concat` them once, or call `stream.setEncoding('utf8')`,
which holds partial characters back. The same logic applies to lines, JSON records
and CSV rows: never assume one chunk is one record.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Memory climbs during an export | `write()` return value ignored | `pipeline` or wait for `drain` |
| Process crashes on a missing file | `.pipe()` with no `error` listener | `pipeline` with try/catch |
| Pipeline hangs after one chunk | Transform never calls `cb` | Call it on every path |
| Garbled accented characters | String concatenation of chunks | `setEncoding` or `Buffer.concat` |
| Export slow, DB fine | One insert per line | Batch writes |
| Upload fills memory | `readFile` or memory storage for uploads | Stream to disk or object storage |

## Streams in the web platform

Node also supports WHATWG streams (`ReadableStream`, `TransformStream`), which is
what `fetch` returns as `response.body`. `Readable.fromWeb()` and `Readable.toWeb()`
convert between the two, so you can pipe a `fetch` body straight to a file with
`pipeline(Readable.fromWeb(res.body), createWriteStream(path))`.

Practise with [js/85](../../85-streaming-log-parser/), which parses a log file as a
stream, and [js/36](../../36-log-analyzer/), whose in-memory version is worth
converting.

## What you should be able to answer

- What is backpressure, and what does `write()` returning `false` mean?
- Why is `pipeline` preferred over `.pipe()` in production code?
- How would you export a million rows from Postgres as a download without running out of memory?
- How do you process a multi-gigabyte file line by line, and why not split each chunk?
- Why can an error halfway through a streamed response not become a 500?
- What is object mode, and what does its `highWaterMark` count?
