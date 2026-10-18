#!/usr/bin/env node
/**
 * Minimal zero-dependency company site used by samples/cases.sample.json and
 * the README walkthrough. Deliberately awkward, like real company sites:
 * the hiring page is buried in a handbook, robots.txt disallows /private/,
 * and there are dead links.
 *
 *   node samples/fixture-site.mjs [--port 4173]
 */
import http from "node:http";

const portArg = process.argv.indexOf("--port");
const PORT = Number(process.env.PORT || (portArg > -1 ? process.argv[portArg + 1] : 0)) || 4173;

const pages = {
  "/": `<!doctype html><html><head><title>Northwind Logistics</title></head><body>
    <h1>Northwind Logistics moves freight across Europe</h1>
    <p>We build route-planning software used by 400 carriers. Founded in 2016,
    we are a team of 60 engineers across Berlin and Lisbon.</p>
    <a href="/about">About us</a>
    <a href="/handbook/how-we-hire">How we hire</a>
    <a href="/blog/green-routes">Engineering blog</a>
    <a href="/pricing">Pricing</a>
    <a href="/private/roles">Private roles</a>
    <a href="https://external.example.com/jobs">Careers on our ATS</a>
  </body></html>`,

  "/about": `<!doctype html><html><head><title>About Northwind</title></head><body>
    <h1>Our story</h1>
    <p>Northwind was founded in Berlin in 2016 by two route-optimisation
    engineers. Our mission is to take a million empty truck-kilometres off
    the road every week.</p>
  </body></html>`,

  "/handbook/how-we-hire": `<!doctype html><html><head><title>How we hire</title></head><body>
    <h1>Our hiring process</h1>
    <p>Candidates do a 30-minute intro call, a practical coding session on a
    real codebase, a system-design interview about scaling our dispatcher, and
    a values conversation. We give an answer within one week.</p>
  </body></html>`,

  "/blog/green-routes": `<!doctype html><html><head><title>Engineering blog</title></head><body>
    <h1>How we cut empty miles by 12%</h1>
    <p>A walk-through of the constraint solver behind our dispatcher and the
    PostgreSQL partitioning that keeps two years of telemetry queryable.</p>
  </body></html>`,
};

const server = http.createServer((req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  if (path === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("User-agent: *\nDisallow: /private/\n");
    return;
  }
  const page = pages[path];
  if (page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }
  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><h1>Not found</h1></body></html>");
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Fixture company site listening on http://127.0.0.1:${PORT}\n`);
});
