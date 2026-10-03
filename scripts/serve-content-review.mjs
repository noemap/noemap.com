import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const html = await readFile(
  new URL("../content-review/index.html", import.meta.url),
);
createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(html);
}).listen(4332, "127.0.0.1", () =>
  console.log("NOEMAP content review: http://127.0.0.1:4332"),
);
