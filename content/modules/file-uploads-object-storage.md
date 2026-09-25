# File uploads and object storage

Profile photos, invoices, CSV imports, attachments: nearly every CRUD app accepts files, and the naive version (save to the server's disk, store the path) breaks the moment you run a second instance. Interviewers ask "how would you handle uploads?" to see whether you know about object storage, presigned URLs and the security problems files bring. This guide covers the design and the mechanics on Node and ASP.NET Core.

## Where files should live

| Option | Works with several instances? | Main problem |
| --- | --- | --- |
| Local disk on the web server | No | File exists on one instance; lost on redeploy or container restart |
| Database `bytea` / `varbinary(max)` | Yes | Bloats backups and the buffer cache; every download goes through the app |
| Object storage (S3, Azure Blob, Cloudflare R2, MinIO locally) | Yes | Needs access control you design deliberately |

The standard answer: **the bytes go to object storage, and a database row records the metadata.** Object storage is cheap, durable, effectively unlimited, and serves files without your app being in the data path.

```sql
CREATE TABLE attachment (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  owner_id     uuid NOT NULL,
  storage_key  text NOT NULL UNIQUE,     -- e.g. t/<tenant>/att/<uuid>
  file_name    text NOT NULL,            -- original name, for display only
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','ready','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Never use the user's file name as the storage key. It collides, it can contain `../`, and it leaks information. Generate a key (a UUID under a tenant prefix) and keep the original name only for display.

## Two ways to upload

**Through your API.** The browser posts `multipart/form-data` to your endpoint, which streams it to storage. Simple, lets you validate before storing, and fine for small files (avatars, documents up to a few MB). The cost is that every byte passes through your servers.

**Direct to storage with a presigned URL.** Your API issues a short-lived URL that allows exactly one upload to one key; the browser sends the file straight to the bucket; then it tells your API the upload finished.

```text
1. POST /attachments          {fileName, contentType, size}  -> API validates, inserts 'pending' row
                                                              <- {id, uploadUrl (expires in 5 min)}
2. PUT  <uploadUrl>           (bytes go straight to S3/Blob)
3. POST /attachments/{id}/complete                            -> API checks the object, marks 'ready'
```

Generating the URL in Node with the AWS SDK v3:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'eu-west-2' });
const key = `t/${tenantId}/att/${crypto.randomUUID()}`;
const uploadUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: 'app-uploads', Key: key, ContentType: contentType }),
  { expiresIn: 300 },
);
```

In .NET the Azure equivalent is a blob SAS URI with `Create | Write` permission and a short expiry (`BlobClient.GenerateSasUri`). Direct uploads scale much better and are the answer for large files, but your API never sees the bytes, which is why step 3 exists.

## Validate on the server, and not by extension

The client's `Content-Type` header and the file extension are both claims made by the uploader. Check:

- **Size**, before you accept the bytes. Kestrel rejects request bodies over about 28.6 MB by default (`MaxRequestBodySize` = 30,000,000 bytes); raise it per endpoint with `[RequestSizeLimit]` rather than globally. For presigned uploads, S3's presigned *POST* policy can enforce `content-length-range`; with a plain PUT, check the object's size in the complete step and reject it if too large.
- **Type**, from the file's first bytes (its "magic number"), against an allow-list:

  ```csharp
  static bool LooksLikePng(ReadOnlySpan<byte> h) =>
      h.Length >= 8 && h[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
  static bool LooksLikePdf(ReadOnlySpan<byte> h) =>
      h.Length >= 4 && h[..4].SequenceEqual("%PDF"u8);
  ```

- **Content**, for anything you will process: run a malware scan (ClamAV, or the cloud provider's scanning) asynchronously and keep the file `pending` until it passes. Re-encode images rather than serving the uploaded bytes, which strips metadata such as GPS coordinates and neutralises crafted files.

## Serving files safely

Keep the bucket **private**. To let a user download, check they are allowed (same tenant, right role), then redirect to a presigned GET URL that expires in a few minutes. For genuinely public assets (product images), serve them through a CDN from a separate public bucket.

Files uploaded by users can attack other users:

- An uploaded HTML or SVG file served from your own domain can run script in your origin: stored XSS. Serve user content from a separate domain (`usercontent.example.net`), send `Content-Disposition: attachment` for anything you do not intend to display inline, and set `X-Content-Type-Options: nosniff`.
- Set the `Content-Type` yourself from your validated type, not from what the uploader claimed.

[Web security basics](web-security-basics.md) covers XSS and the headers in more depth.

## Large files and processing

For files over roughly 100 MB, use **multipart upload**: the client splits the file into parts, uploads them in parallel with presigned URLs for each part, and completes the upload; failed parts can be retried alone. Libraries such as Uppy handle this on the frontend.

Processing (thumbnails, CSV imports, PDF text extraction, virus scans) belongs in a background worker triggered by a queue message or a storage event (S3 event notifications, Azure Event Grid), never in the upload request. The UI shows "processing" until the row flips to `ready`. See [background jobs and queues](background-jobs-and-queues.md).

## Receiving uploads through your API

When files do come through the app, stream them rather than buffering them in memory:

- **ASP.NET Core:** `IFormFile` buffers anything over 64 KB to a temporary file on disk, which is fine for modest sizes. For large files, read the multipart sections with `MultipartReader` and copy each section's stream straight to blob storage.
- **Node:** use a streaming parser (busboy, or multer with a storage engine that pipes to S3) and `stream.pipeline`, so a 2 GB upload does not become a 2 GB `Buffer`.

## Clean-up and deletion

Presigned flows leave debris: rows stuck in `pending` because the user closed the tab, and objects without rows. A nightly job deletes pending rows older than a day and their objects; a storage lifecycle rule can expire anything under a `tmp/` prefix automatically. When a record or a tenant is deleted, its files must go too, which is much easier when keys are prefixed by tenant. Enable bucket versioning or soft delete if accidental deletion is a bigger risk than storage cost.

## What you should be able to answer

- Why is saving uploads to the web server's disk a problem, and where should the bytes and the metadata live?
- Walk through a presigned-URL upload. What does the API do before and after the browser uploads?
- How do you check that an uploaded "image" really is an image and not too large?
- How would you let a user download a private file without making the bucket public?
- Why can a user-uploaded SVG or HTML file be dangerous, and how do you serve it safely?
- Where does thumbnail generation or a CSV import run, and how does the UI know it has finished?
