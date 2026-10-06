import { request } from 'node:http';

/** A GET with full control of the headers, since fetch will not let a test set Host. */
export function get({ headers = {}, path, port }: { headers?: Record<string, string>; path: string; port: number }) {
  return new Promise<{ body: string; status: number }>((resolve, reject) => {
    const req = request({ headers, host: '127.0.0.1', method: 'GET', path, port }, res => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ body, status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end();
  });
}
