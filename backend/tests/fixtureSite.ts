import http from "http";
import { AddressInfo } from "net";

/**
 * A miniature company site with the shape that breaks naive crawlers:
 *  - hiring page buried at an unpredictable path (/handbook/how-we-hire)
 *  - a robots.txt that forbids /private/
 *  - a 404 trap link and an external link (must not be followed)
 *  - a PDF link (must be skipped by content type)
 * The crawler must find the hiring page via link ranking, not a hard-coded
 * path list.
 */
export const SITE_PAGES: Record<string, { title: string; body: string; type?: string }> = {
  "/": {
    title: "Acme Robotics",
    body: `<html><head><title>Acme Robotics</title></head><body>
      <nav><a href="/pricing">Pricing</a> <a href="/login">Log in</a></nav>
      <h1>Acme Robotics builds warehouse automation</h1>
      <p>Acme Robotics helps warehouses move goods with autonomous mobile robots.
      Founded in 2019, we ship fleet-management software and hardware.</p>
      <a href="/about">About us</a>
      <a href="/handbook/how-we-hire">How we hire</a>
      <a href="/blog/scaling-fleet">Engineering blog</a>
      <a href="/broken">Broken page</a>
      <a href="https://external.example.com/elsewhere">External</a>
      <a href="/benefits.pdf">Benefits PDF</a>
      <a href="/private/secrets">Private careers</a>
    </body></html>`,
  },
  "/about": {
    title: "About Acme",
    body: `<html><head><title>About Acme</title></head><body>
      <h1>Our story</h1>
      <p>Acme was founded in Rotterdam in 2019 by three logistics engineers.
      Our mission: make every warehouse autonomous within a decade.
      We are 85 people across engineering, ops and sales.</p>
    </body></html>`,
  },
  "/handbook/how-we-hire": {
    title: "How we hire",
    body: `<html><head><title>How we hire</title></head><body>
      <h1>Our hiring process</h1>
      <p>Every candidate goes through four stages: a 30-minute phone screen with
      recruiting, a paid take-home assignment (4 hours max), a technical interview
      walking through your take-home plus a system design round on distributed
      fleet scheduling, and finally a values conversation with the team.
      We aim to give an answer within five days of the final round.</p>
    </body></html>`,
  },
  "/blog/scaling-fleet": {
    title: "Scaling our robot fleet to 10,000 units",
    body: `<html><head><title>Scaling our fleet</title></head><body>
      <h1>How we scaled to 10,000 robots</h1>
      <p>Our fleet-management platform schedules tasks for thousands of
      autonomous mobile robots. This post covers the migration from a
      centralized planner to a distributed architecture using NATS and
      PostgreSQL partitioning, and the React dashboard our operators use.</p>
    </body></html>`,
  },
  "/pricing": {
    title: "Pricing",
    body: `<html><body><h1>Pricing</h1><p>Enterprise pricing on request.</p></body></html>`,
  },
  "/robots.txt": {
    title: "robots",
    type: "text/plain",
    body: "User-agent: *\nDisallow: /private/\n",
  },
  "/benefits.pdf": {
    title: "Benefits",
    type: "application/pdf",
    body: "%PDF-1.4 not really a pdf",
  },
};

export interface FixtureSite {
  url: string;
  requests: string[];
  close: () => Promise<void>;
}

export async function startFixtureSite(): Promise<FixtureSite> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    requests.push(path);
    const page = SITE_PAGES[path];
    if (!page) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>404 Not Found</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": page.type ?? "text/html; charset=utf-8" });
    res.end(page.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
