import http from "node:http";

const port = Number(process.env.PORT ?? 4100);
http.createServer((_request, response) => response.end("ok")).listen(port);
