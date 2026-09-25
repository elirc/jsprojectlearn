# WebSockets and server-sent events in Node

Live dashboards, notifications, chat and collaborative editing all need the server
to push data. Job specs mention WebSockets often enough that you will be asked
"how would you add live updates?", and the follow-ups are always the same: which
transport, how do you authenticate it, and what happens with three instances behind
a load balancer. This guide answers those from the Node side. The protocol
comparison from the client's side is in [HTTP fundamentals](http-fundamentals.md).

## Choosing a transport

| | Polling | Server-sent events | WebSockets |
|---|---|---|---|
| Direction | Client asks | Server to client | Both ways |
| Protocol | Plain HTTP | Plain HTTP, long response | HTTP upgrade, then its own framing |
| Browser API | `fetch` | `EventSource` | `WebSocket` |
| Reconnect | N/A | Automatic, resumes with `Last-Event-ID` | You write it |
| Through proxies and CDNs | Always | Usually; watch buffering | Needs upgrade support |
| Good for | Rare changes, simplicity | Notifications, feeds, progress, LLM streaming | Chat, presence, games, collaborative editing |

The honest default: **if only the server talks, use SSE**. It is ordinary HTTP, so
your auth cookies, middleware, logging and load balancer work unchanged, and the
browser reconnects for you. Reach for WebSockets when the client sends frequent
messages too, or you need binary frames.

## SSE in Express

```js
const clients = new Set();

app.get('/events', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',            // ask nginx not to buffer this response
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');           // reconnect delay hint for EventSource

  const client = { userId: req.user.id, res };
  clients.add(client);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {                 // client went away: always clean up
    clearInterval(heartbeat);
    clients.delete(client);
  });
});

export function notify(userId, event, data, id) {
  for (const c of clients) {
    if (c.userId === userId) c.res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
```

The details that matter:

- **Wire format:** fields such as `event:`, `id:` and `data:`, one per line, and a
  blank line ends a message. Lines starting with `:` are comments, handy as
  heartbeats that stop proxies closing an idle connection.
- **Resuming:** if you send `id:`, the browser reconnects with a `Last-Event-ID`
  header, and you can replay what the client missed from a log or table.
- **Buffering:** compression middleware and reverse proxies collect bytes before
  sending, so events arrive in bursts. Call `res.flush()` (added by `compression`)
  after each write or skip compression on this route; disable proxy buffering.
- **Cleanup:** the `close` listener is what stops a slow leak of dead responses and
  intervals. Test it by closing the tab.
- **Connection limits:** over HTTP/1.1 browsers allow about six connections per
  origin, shared across tabs, so SSE in many tabs can starve normal requests.
  HTTP/2 removes that limit.

## WebSockets with ws

`ws` is the standard server library. Attach it to your existing HTTP server so the
same port serves both, and authenticate during the upgrade, before a socket exists:

```js
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  try {
    if (!allowedOrigins.has(req.headers.origin)) throw new Error('bad origin');
    const user = await sessionFromCookie(req.headers.cookie);   // same session as HTTP
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on('connection', (ws, user) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    const msg = ClientMessage.safeParse(JSON.parse(raw));      // validate like any input
    if (!msg.success) return ws.close(1008, 'invalid message');
    handle(user, msg.data, ws);
  });
});
```

**Authentication.** The browser `WebSocket` constructor cannot set an
`Authorization` header. It does send cookies with the upgrade request, so a session
cookie works; otherwise, issue a short-lived single-use ticket over normal HTTP and
pass it in the URL. **Check the `Origin` header**: cookies are sent even when a
malicious page opens the socket, so without the check you have cross-site WebSocket
hijacking.

**Messages are input.** `JSON.parse` can throw, and the shape is whatever the client
sent. Validate every message with a schema, cap `maxPayload`, and rate-limit
per connection. Authorisation applies per message too: being connected does not mean
being allowed to post to every room.

**Heartbeats.** A phone that loses signal does not send a close frame, so the
server keeps its socket and memory indefinitely. Ping every 30 seconds and
`terminate()` sockets that did not answer the previous ping:

```js
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(interval));
```

**Backpressure.** `ws.send()` never blocks; data for a slow client queues in memory
as `ws.bufferedAmount`. When broadcasting frequent updates, skip or drop clients
whose buffer passes a threshold rather than letting memory grow. It is the same
principle as [streams and backpressure](node-streams-and-backpressure.md).

## Scaling past one instance

Each Node process only knows its own connections. With three replicas, a message
that arrives on instance A must reach users connected to B and C.

- **Fan out through a broker.** Every instance subscribes to Redis pub/sub (or NATS,
  or Postgres `LISTEN/NOTIFY` for modest volume) and forwards messages to its local
  sockets. The publisher does not need to know where anyone is connected.
- **Sticky sessions** keep one client on one instance, which Socket.IO needs for
  its HTTP long-polling fallback. They do not solve fan-out.
- **State lives elsewhere.** Presence, room membership and message history belong in
  Redis or the database, not in a `Map` on one instance that vanishes on deploy.

Socket.IO bundles rooms, acknowledgements, reconnection and a Redis adapter on top of
its own protocol; a plain `WebSocket` client cannot talk to it. `ws` is lower-level
and speaks the standard protocol. Either is a reasonable choice; knowing the
difference is the point.

## Deploys and shutdown

Long-lived connections keep `server.close()` waiting forever. On SIGTERM, close
WebSockets with code 1001 ("going away") so clients reconnect to another instance,
end SSE responses (`EventSource` reconnects by itself), then close the server. Add
jitter to client reconnect delays so a deploy does not cause every client to
reconnect in the same second. See [graceful shutdown](node-graceful-shutdown.md).

## Testing

Node 24 has a global, browser-compatible `WebSocket` client, so integration tests
can open a real connection to the server started on port 0, send a message and
await the reply with `events.once(ws, 'message')`. For SSE, `fetch` the endpoint and
read `response.body` with a `TextDecoderStream`, then abort the request and assert
that the server's cleanup ran.

Build it yourself in [js/67](../../67-websocket-chat/), then add fan-out and
presence in [js/68](../../68-collab-todo/).

## What you should be able to answer

- When would you choose SSE over WebSockets, and what does SSE give you for free?
- How do you authenticate a WebSocket connection from a browser, and why check the Origin header?
- Why do servers send pings, and what happens without them?
- How do you broadcast a message to users connected to different instances?
- Why do SSE events sometimes arrive in bursts, and how do you fix it?
- What must happen to open WebSocket and SSE connections during a deploy?
