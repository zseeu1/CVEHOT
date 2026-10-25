// The fetch guard: internal addresses stay unreachable in every spelling, and a name that resolves
// to one is refused at connect time too (DNS rebinding after the URL check).
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { after, mock, test } from "node:test";
import { Agent, fetch as undiciFetch } from "undici";
import { config } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { assertPublicUrl, guardedLookup, isBlockedAddress } from "@aihot/backend/lib/url";

let hits = 0;
const server = http.createServer((_req, res) => { hits++; res.end("public content"); });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const { port } = server.address() as { port: number };
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test("internal and reserved addresses are blocked in every spelling", () => {
  const blocked = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
    "198.18.0.0", "198.18.0.1", "198.19.255.255", "::ffff:198.18.0.1", "64:ff9b::c612:1", "2002:c612:1::1",
    "::1", "::", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:a9fe:a9fe", "::7f00:1", // IPv4-mapped and -compatible
    "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::1", "2001:0:4136:e378::1", // NAT64, 6to4, Teredo
    "not-an-ip",
  ];
  const allowed = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"];
  assert.deepEqual(blocked.filter((a) => !isBlockedAddress(a)), [], "not blocked");
  assert.deepEqual(allowed.filter((a) => isBlockedAddress(a)), [], "wrongly blocked");
});

test("URL literals that embed a loopback address are refused before any request", async () => {
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::127.0.0.1]/", "http://[64:ff9b::127.0.0.1]/", "http://localhost/"]) {
    await assert.rejects(assertPublicUrl(url), Error, url);
  }
  await assert.rejects(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`));
});

// Benchmark space is not public address space. Local proxy fake-IP routing must not make it a
// production exception; URL parsing also turns decimal/hex literals into the same destination.
test("benchmark literals are refused without a local-debug override", async () => {
  for (const host of ["198.18.0.1", "198.19.255.255", "3323068417", "0xc6120001", "[::ffff:198.18.0.1]"]) {
    await assert.rejects(assertPublicUrl(`http://${host}/`), /Blocked/, host);
  }
  assert.equal((await assertPublicUrl("http://198.18.0.1/", true)).hostname, "198.18.0.1");
});

test("blocked DNS names keep their boundary with a trailing root dot", async () => {
  const names = ["localhost", "child.localhost", "metadata.google.internal", "anything.internal"];
  for (const name of names) {
    await assert.rejects(assertPublicUrl(`http://${name}./`, false, async () => ["93.184.216.34"]), /Blocked host/, name);
  }
  assert.equal((await assertPublicUrl("https://example.org./", false, async () => ["93.184.216.34"])).hostname, "example.org.");
  let lookups = 0;
  mock.method(dns, "lookup", async () => { lookups++; return [{ address: "93.184.216.34", family: 4 }]; });
  syncBuiltinESMExports();
  try {
    for (const name of names) for (const all of [false, true]) {
      const error = await new Promise<NodeJS.ErrnoException | null>(resolve => guardedLookup(`${name.toUpperCase()}.`, { all }, err => resolve(err)));
      assert.equal(error?.code, "EBLOCKED", `${name}, all=${all}`);
    }
    assert.equal(lookups, 0, "blocked names are rejected before resolving an address");
  } finally {
    mock.restoreAll(); syncBuiltinESMExports();
  }
});

test("the connection guard refuses private, mixed, reserved and empty DNS answers, including a changed answer", async () => {
  const agent = new Agent({ connect: { lookup: guardedLookup as never } });
  const before = hits;
  const answers: Record<string, string[]> = { "public.invalid": ["93.184.216.34"], "private.invalid": ["127.0.0.1"],
    "mixed.invalid": ["93.184.216.34", "127.0.0.1"], "reserved.invalid": ["198.18.0.1"], "empty.invalid": [] };
  const savedLookup = dns.lookup;
  mock.method(dns, "lookup", async (host: string, options: unknown) => {
    if (!(host in answers)) return savedLookup(host, options as never);
    return answers[host]!.map(address => ({ address, family: 4 }));
  });
  const savedConnect = net.connect;
  mock.method(net, "connect", function (this: unknown, options: net.TcpNetConnectOpts, ...rest: unknown[]) {
    if (options.host && options.host in answers) {
      const lookup = options.lookup!;
      // Only an address already accepted by the real guard reaches the local fixture.
      options = { ...options, port, lookup(host, opts, done) {
        lookup(host, opts, (error, address, family) => {
          if (error) return done(error, address, family);
          done(null, Array.isArray(address) ? address.map(a => ({ ...a, address: "127.0.0.1" })) : "127.0.0.1", family);
        });
      } };
    }
    return Reflect.apply(savedConnect, this, [options, ...rest]);
  });
  syncBuiltinESMExports();
  try {
    const read = async (host: string, targetPort = port) => {
      const response = await undiciFetch(`http://${host}:${targetPort}/`, { dispatcher: agent });
      return response.text();
    };
    assert.equal(await read("public.invalid"), "public content");
    for (const host of ["private.invalid", "mixed.invalid", "reserved.invalid", "empty.invalid"]) {
      await assert.rejects(read(host));
    }
    answers["public.invalid"] = ["127.0.0.1"];
    await assert.rejects(read("public.invalid", port + 1), "a new connection cannot reuse the name's previous public DNS answer");
    assert.equal(hits, before + 1, "refused DNS answers never reach the destination");
  } finally {
    await agent.destroy();
    mock.restoreAll(); syncBuiltinESMExports();
  }
});

// PRIVATE_FEED_HOSTS: a self-hosted feed service (RSSHub in the same Docker network) on a listed name
// may use a private address, only as the configured listing address itself. Failures: a listed name
// opens link-local or cloud metadata; the exception reaches bodies, details, images, icons or another
// host through a redirect; the URL check allows it but the connection dials an unchecked answer; the
// listed service is sent through the egress proxy.
test("a listed private feed host may resolve to private service addresses, never to link-local or metadata", async () => {
  const answers: Record<string, string[]> = {};
  const resolve = async (host: string) => answers[host] ?? [];
  const listed = (url: string, hosts = ["rsshub"]) => assertPublicUrl(url, false, resolve, hosts);
  for (const address of ["10.0.0.5", "172.18.0.3", "192.168.1.9", "100.64.0.2", "127.0.0.1", "::1", "fd12:3456::5", "::ffff:172.18.0.3"]) {
    answers.rsshub = [address];
    assert.equal((await listed("http://RSSHub:1200/feed")).hostname, "rsshub", address);
    await assert.rejects(assertPublicUrl("http://rsshub:1200/feed", false, resolve), /Blocked/, `${address} without the list`);
  }
  for (const address of ["169.254.169.254", "169.254.170.2", "100.100.100.200", "::ffff:100.100.100.200", "::ffff:6464:64c8", "fd00:ec2::254", "fe80::1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "0.0.0.0", "198.18.0.1", "224.0.0.1", "2001:db8::1"]) {
    answers.rsshub = [address];
    await assert.rejects(listed("http://rsshub:1200/feed"), /Blocked/, address);
  }
  answers.rsshub = ["10.0.0.5", "169.254.169.254"];
  await assert.rejects(listed("http://rsshub:1200/feed"), /Blocked/, "mixed answer");
  // Whole names only: no suffix, prefix or wildcard match.
  answers["feeds.rsshub"] = answers["rsshub.evil"] = ["10.0.0.5"];
  for (const url of ["http://feeds.rsshub/", "http://rsshub.evil/"]) await assert.rejects(listed(url), /Blocked/, url);
  // A listed .internal name (Docker's host.docker.internal) passes the name check; metadata names still fail by address.
  answers["host.docker.internal"] = ["192.168.65.254"];
  assert.equal((await listed("http://host.docker.internal:1200/", ["host.docker.internal"])).hostname, "host.docker.internal");
  await assert.rejects(assertPublicUrl("http://host.docker.internal:1200/", false, resolve), /Blocked host/);
  answers["metadata.google.internal"] = ["169.254.169.254"];
  await assert.rejects(listed("http://metadata.google.internal/", ["metadata.google.internal"]), /Blocked/);
  // Listed address literals.
  assert.equal((await listed("http://172.18.0.3:1200/", ["172.18.0.3"])).hostname, "172.18.0.3");
  await assert.rejects(listed("http://169.254.169.254/", ["169.254.169.254"]), /Blocked/);
});

test("only the listing fetch of a listed host reaches a private service, directly, with every hop and connection checked", async () => {
  const feedHits: string[] = [];
  const feed = http.createServer((req, res) => {
    feedHits.push(`${req.headers.host}${req.url}`);
    const to = new URL(req.url!, "http://fixture").searchParams.get("to");
    if (to) { res.writeHead(302, { location: to }); res.end(); } else res.end("feed");
  });
  await new Promise<void>(resolve => feed.listen(0, "127.0.0.1", () => resolve()));
  const feedPort = (feed.address() as { port: number }).port;
  let proxyHits = 0;
  const proxy = http.createServer();
  proxy.on("connect", (_req, socket) => { proxyHits++; socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", () => resolve()));
  const answers: Record<string, () => string[]> = {
    "rsshub.invalid": () => ["127.0.0.1"], "other.invalid": () => ["127.0.0.1"], "unlisted.invalid": () => ["127.0.0.1"],
    "meta.invalid": () => ["169.254.169.254"],
  };
  const savedLookup = dns.lookup;
  mock.method(dns, "lookup", async (host: string, options: unknown) => {
    const answer = answers[host.toLowerCase()];
    return answer ? answer().map(address => ({ address, family: 4 })) : savedLookup(host, options as never);
  });
  syncBuiltinESMExports();
  const savedHosts = config.privateFeedHosts;
  const savedProxy = config.egressProxyUrl;
  config.privateFeedHosts = ["rsshub.invalid", "other.invalid", "meta.invalid", "rebind.invalid"];
  config.egressProxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const at = (host: string, path = "/feed") => `http://${host}:${feedPort}${path}`;
  try {
    assert.equal((await fetchListing(at("rsshub.invalid"))).text(), "feed");
    assert.equal((await fetchListing(at("RSSHub.invalid", "/upper"))).text(), "feed");
    assert.equal((await fetchListing(at("rsshub.invalid", `/move?to=${encodeURIComponent("/moved")}`))).url, at("rsshub.invalid", "/moved"));
    assert.equal(proxyHits, 0, "a listed host is connected directly");
    assert.deepEqual(feedHits, [`rsshub.invalid:${feedPort}/feed`, `rsshub.invalid:${feedPort}/upper`, `rsshub.invalid:${feedPort}/move?to=%2Fmoved`, `rsshub.invalid:${feedPort}/moved`]);
    feedHits.length = 0;

    // Bodies, details, images and icons call guardedFetch without the listing opt-in.
    await assert.rejects(guardedFetch(at("rsshub.invalid", "/image.png")));
    assert.ok(proxyHits > 0, "without the opt-in a listed name takes the normal egress route");
    config.egressProxyUrl = savedProxy;
    await assert.rejects(guardedFetch(at("rsshub.invalid", "/image.png")), /Blocked/);
    await assert.rejects(fetchListing(at("unlisted.invalid")), /Blocked/);
    await assert.rejects(fetchListing(at("meta.invalid")), /Blocked/);
    // A redirect leaves the exception behind, even to another listed host or a private literal.
    for (const to of [at("other.invalid"), at("unlisted.invalid"), at("localhost"), at("127.0.0.1"), "http://169.254.169.254/latest/meta-data/"]) {
      await assert.rejects(fetchListing(at("rsshub.invalid", `/hop?to=${encodeURIComponent(to)}`)), /Blocked/, to);
    }
    assert.equal(feedHits.filter(hit => !hit.startsWith(`rsshub.invalid:${feedPort}/hop?`)).length, 0, "refused destinations are never requested");
    feedHits.length = 0;

    // The URL check sees a private service, the connection is offered metadata: the connection refuses it.
    let rebindLookups = 0;
    answers["rebind.invalid"] = () => rebindLookups++ === 0 ? ["127.0.0.1"] : ["169.254.169.254"];
    await assert.rejects(fetchListing(at("rebind.invalid")), (error: Error & { cause?: { code?: string } }) => {
      assert.equal(error.cause?.code, "EBLOCKED"); return true;
    });
    assert.deepEqual(feedHits, []);
  } finally {
    config.privateFeedHosts = savedHosts;
    config.egressProxyUrl = savedProxy;
    mock.restoreAll(); syncBuiltinESMExports();
    feed.closeAllConnections();
    await new Promise<void>(resolve => feed.close(() => resolve()));
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
